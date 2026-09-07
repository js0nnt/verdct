import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = path.join(projectRoot, 'dist');
const chromePath = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDirectory = await mkdtemp(path.join(projectRoot, '.tmp-chrome-'));

await access(path.join(extensionDirectory, 'manifest.json'));
await access(chromePath);

const chromeProcess = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    '--remote-debugging-pipe',
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ],
  {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let chromeDiagnostics = '';
chromeProcess.stderr.setEncoding('utf8');
chromeProcess.stderr.on('data', (chunk) => {
  chromeDiagnostics += chunk;
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createPipeConnection() {
  const input = chromeProcess.stdio[3];
  const output = chromeProcess.stdio[4];
  const pendingMessages = new Map();
  const events = [];
  let nextMessageId = 1;
  let bufferedOutput = Buffer.alloc(0);

  output.on('data', (chunk) => {
    bufferedOutput = Buffer.concat([bufferedOutput, chunk]);

    let separatorIndex = bufferedOutput.indexOf(0);
    while (separatorIndex >= 0) {
      const rawMessage = bufferedOutput.subarray(0, separatorIndex).toString('utf8');
      bufferedOutput = bufferedOutput.subarray(separatorIndex + 1);

      if (rawMessage) {
        const message = JSON.parse(rawMessage);
        const pending = pendingMessages.get(message.id);
        if (pending) {
          pendingMessages.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        } else if (message.method) {
          events.push(message);
        }
      }

      separatorIndex = bufferedOutput.indexOf(0);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextMessageId;
      nextMessageId += 1;

      const response = new Promise((resolve, reject) => {
        pendingMessages.set(id, { resolve, reject });
      });

      input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
      return response;
    },
    close() {
      input.end();
      output.destroy();
    },
    getEvents() {
      return [...events];
    },
  };
}

const connection = createPipeConnection();

try {
  const { id } = await connection.send('Extensions.loadUnpacked', {
    path: extensionDirectory,
  });
  const { extensions } = await connection.send('Extensions.getExtensions');
  const verdct = extensions.find((extension) => extension.id === id);

  if (!verdct || verdct.name !== 'Verdct' || !verdct.enabled) {
    throw new Error(`Chrome reported an unhealthy extension: ${JSON.stringify(verdct)}`);
  }

  const { targetId } = await connection.send('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await connection.send('Runtime.enable', {}, sessionId);
  await connection.send('Log.enable', {}, sessionId);
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Page.navigate', {
    url: `chrome-extension://${id}/popup.html`,
  }, sessionId);

  let popup;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const evaluation = await connection.send('Runtime.evaluate', {
      expression: `({
        title: document.title,
        text: document.body?.innerText ?? '',
        readyState: document.readyState,
      })`,
      returnByValue: true,
    }, sessionId);

    if (evaluation.exceptionDetails) {
      throw new Error(`The popup raised an exception: ${evaluation.exceptionDetails.text}`);
    }

    popup = evaluation.result?.value;
    if (popup?.readyState === 'complete' && popup.text.includes('See the verdict before you register.')) {
      break;
    }

    await delay(100);
  }

  if (!popup?.text.includes('See the verdict before you register.')) {
    throw new Error(`The Verdct popup did not render as expected: ${JSON.stringify(popup)}`);
  }

  const healthEvaluation = await connection.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'verdct:background-health-check' },
        (response) => resolve({
          response,
          error: chrome.runtime.lastError?.message ?? null,
        }),
      );
    })`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const backgroundHealth = healthEvaluation.result?.value;

  if (healthEvaluation.exceptionDetails || backgroundHealth?.error || !backgroundHealth?.response?.ok) {
    throw new Error(
      `The background service worker health check failed: ${JSON.stringify(backgroundHealth)}`,
    );
  }

  const lookupEvaluation = await connection.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'verdct:lookup-professor',
          professorName: 'Hedvig Mohacsy',
        },
        (response) => resolve({
          response,
          error: chrome.runtime.lastError?.message ?? null,
        }),
      );
    })`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const lookup = lookupEvaluation.result?.value;
  const rating = lookup?.response?.rating;

  if (
    lookupEvaluation.exceptionDetails ||
    lookup?.error ||
    !lookup?.response?.ok ||
    rating?.displayName !== 'Hedvig Mohacsy' ||
    rating?.matchConfidence !== 'high' ||
    typeof rating?.overallRating !== 'number' ||
    rating?.numRatings < 1
  ) {
    throw new Error(`The live RMP lookup failed validation: ${JSON.stringify(lookup)}`);
  }

  // Repeat the lookup with different casing and spacing. The cache is keyed by
  // normalized name, so this must be served from storage: an identical
  // fetchedAt proves no second RMP request was made.
  const cachedEvaluation = await connection.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'verdct:lookup-professor',
          professorName: '  MOHACSY,  Hedvig  ',
        },
        (response) => {
          const error = chrome.runtime.lastError?.message ?? null;
          chrome.storage.local.get('verdct:ratings').then((stored) => resolve({
            response,
            error,
            cacheKeys: Object.keys(stored['verdct:ratings'] ?? {}),
          }));
        },
      );
    })`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const cached = cachedEvaluation.result?.value;
  const cachedRating = cached?.response?.rating;

  if (
    cachedEvaluation.exceptionDetails ||
    cached?.error ||
    !cached?.response?.ok ||
    cachedRating?.fetchedAt !== rating.fetchedAt ||
    cachedRating?.displayName !== rating.displayName ||
    !cached.cacheKeys.includes('hedvig mohacsy')
  ) {
    throw new Error(`The rating cache did not serve a repeat lookup: ${JSON.stringify(cached)}`);
  }

  await delay(100);
  const browserErrors = connection.getEvents().filter((event) =>
    event.sessionId === sessionId && (
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
    ),
  );

  if (browserErrors.length > 0) {
    throw new Error(`Chrome reported popup errors: ${JSON.stringify(browserErrors)}`);
  }

  console.log(JSON.stringify({
    name: verdct.name,
    version: verdct.version,
    id: verdct.id,
    enabled: verdct.enabled,
    popupTitle: popup.title,
    popupReadyState: popup.readyState,
    backgroundHealthy: backgroundHealth.response.ok,
    liveLookup: {
      displayName: rating.displayName,
      overallRating: rating.overallRating,
      difficulty: rating.difficulty,
      wouldTakeAgainPct: rating.wouldTakeAgainPct,
      numRatings: rating.numRatings,
      matchConfidence: rating.matchConfidence,
    },
    cacheServedRepeatLookup: true,
    cachedProfessors: cached.cacheKeys.length,
    popupErrors: browserErrors.length,
  }, null, 2));
} catch (error) {
  if (chromeDiagnostics.trim()) {
    console.error(chromeDiagnostics.trim());
  }
  throw error;
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
