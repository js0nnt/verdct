import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDirectory = await mkdtemp(path.join(projectRoot, '.tmp-chrome-'));
const rmpUrl = process.env.RMP_INSPECTION_URL ??
  'https://www.ratemyprofessors.com/search/professors/15723?q=*';

const chromeProcess = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-pipe',
  `--user-data-dir=${profileDirectory}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createPipeConnection() {
  const input = chromeProcess.stdio[3];
  const output = chromeProcess.stdio[4];
  const pending = new Map();
  const events = [];
  let nextId = 1;
  let buffer = Buffer.alloc(0);

  output.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let separator = buffer.indexOf(0);
    while (separator >= 0) {
      const raw = buffer.subarray(0, separator).toString('utf8');
      buffer = buffer.subarray(separator + 1);
      if (raw) {
        const message = JSON.parse(raw);
        const request = pending.get(message.id);
        if (request) {
          pending.delete(message.id);
          message.error
            ? request.reject(new Error(message.error.message))
            : request.resolve(message.result);
        } else if (message.method) {
          events.push(message);
        }
      }
      separator = buffer.indexOf(0);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId;
      nextId += 1;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
      return response;
    },
    events,
    close() {
      input.end();
      output.destroy();
    },
  };
}

const connection = createPipeConnection();

try {
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await connection.send('Network.enable', {}, sessionId);
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);
  await connection.send('Page.navigate', { url: rmpUrl }, sessionId);

  let showMoreClicked = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const clickResult = await connection.send('Runtime.evaluate', {
      expression: `(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find((candidate) => candidate.textContent?.trim() === 'Show More');
        if (!button) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
    }, sessionId);
    showMoreClicked = Boolean(clickResult.result?.value);
    if (showMoreClicked) break;
    await delay(100);
  }

  if (!showMoreClicked) {
    throw new Error('RateMyProfessor loaded, but its Show More control was not available.');
  }

  let graphqlRequests = [];
  let expansionCount = 1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await delay(750);
    graphqlRequests = connection.events.filter((event) =>
      event.sessionId === sessionId &&
      event.method === 'Network.requestWillBeSent' &&
      event.params.request.url.includes('/graphql'),
    );
    if (graphqlRequests.length > 0) break;

    const clickResult = await connection.send('Runtime.evaluate', {
      expression: `(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find((candidate) => candidate.textContent?.trim() === 'Show More');
        if (!button) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
    }, sessionId);
    if (!clickResult.result?.value) break;
    expansionCount += 1;
  }

  const page = await connection.send('Runtime.evaluate', {
    expression: `({
      title: document.title,
      text: document.body?.innerText?.slice(0, 500) ?? '',
      professorLinkCount: document.querySelectorAll('a[href^="/professor/"]').length,
      showMorePresent: Array.from(document.querySelectorAll('button'))
        .some((button) => button.textContent?.trim() === 'Show More'),
    })`,
    returnByValue: true,
  }, sessionId);

  if (graphqlRequests.length === 0) {
    const requestSummary = connection.events
      .filter((event) =>
        event.sessionId === sessionId && event.method === 'Network.requestWillBeSent',
      )
      .map((event) => ({
        type: event.params.type,
        method: event.params.request.method,
        url: event.params.request.url,
        hasPostData: Boolean(event.params.request.postData),
      }))
      .filter(({ type, url }) =>
        (type === 'Fetch' || type === 'XHR') && url.startsWith('https://www.ratemyprofessors.com/'),
      );
    throw new Error(
      `No /graphql request was observed. Page: ${JSON.stringify(page.result?.value)} ` +
      `Expansions: ${expansionCount} Same-origin Fetch/XHR: ${JSON.stringify(requestSummary)}`,
    );
  }

  const summaries = [];
  for (const event of graphqlRequests) {
    const request = event.params.request;
    let body = request.postData;
    try {
      body = JSON.parse(request.postData);
    } catch {
      // Preserve non-JSON request bodies for schema inspection.
    }
    const response = connection.events.find((candidate) =>
      candidate.sessionId === sessionId &&
      candidate.method === 'Network.responseReceived' &&
      candidate.params.requestId === event.params.requestId,
    );
    let responseBody = null;
    if (response) {
      const rawResponse = await connection.send('Network.getResponseBody', {
        requestId: event.params.requestId,
      }, sessionId);
      try {
        responseBody = JSON.parse(rawResponse.body);
      } catch {
        responseBody = rawResponse.body;
      }
    }
    summaries.push({
      url: request.url,
      method: request.method,
      contentType: request.headers['Content-Type'] ?? request.headers['content-type'],
      authorizationHeader: (request.headers.Authorization ?? request.headers.authorization) === 'null'
        ? 'literal-null'
        : 'present',
      body,
      responseStatus: response?.params.response.status ?? null,
      responseMimeType: response?.params.response.mimeType ?? null,
      responseBody,
    });
  }

  console.log(JSON.stringify({ page: page.result?.value, requests: summaries }, null, 2));
} finally {
  connection.close();
  if (chromeProcess.exitCode === null) {
    chromeProcess.kill();
    await delay(250);
  }
  try {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Chrome can briefly retain files on Windows; leftover profiles are ignored by Git.
  }
}
