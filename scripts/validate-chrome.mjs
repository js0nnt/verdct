import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    if (popup?.readyState === 'complete' && /quality vs difficulty/i.test(popup.text)) {
      break;
    }

    await delay(100);
  }

  // The Overview tab is the default, and it leads with the comparison chart.
  if (!/quality vs difficulty/i.test(popup?.text ?? '') || !/settings/i.test(popup.text)) {
    throw new Error(`The Verdct popup did not render as expected: ${JSON.stringify(popup)}`);
  }

  // Settings now live behind their own tab, so the controls only exist once it
  // is opened.
  const controlsEvaluation = await connection.send('Runtime.evaluate', {
    expression: `(async () => {
      const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Settings');
      if (!tab) return { openedSettings: false };
      tab.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const themeButtons = [...document.querySelectorAll('[role="group"][aria-label="Theme"] button')]
        .map((b) => b.textContent.trim());
      return {
        openedSettings: true,
        themeChoices: themeButtons,
        activeTheme: document.documentElement.getAttribute('data-theme'),
        ttlOptions: document.querySelector('#verdct-ttl')?.options?.length ?? 0,
        sliders: document.querySelectorAll('input[type="range"]').length,
        hasClearButton: [...document.querySelectorAll('button')].some((b) => /Clear cached/i.test(b.textContent)),
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const controls = controlsEvaluation.result?.value;

  if (
    !controls?.openedSettings ||
    controls.ttlOptions !== 5 ||
    controls.sliders !== 2 ||
    !controls.hasClearButton
  ) {
    throw new Error(`The popup settings controls did not render: ${JSON.stringify(controls)}`);
  }

  if (String(controls.themeChoices) !== 'Light,Dark,Auto') {
    throw new Error(`The theme toggle is missing an option: ${JSON.stringify(controls.themeChoices)}`);
  }

  // An explicit choice must beat the OS setting.
  const themeEvaluation = await connection.send('Runtime.evaluate', {
    expression: `(async () => {
      const pick = (label) => [...document.querySelectorAll('[role="group"][aria-label="Theme"] button')]
        .find((b) => b.textContent.trim() === label);
      pick('Dark').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const dark = document.documentElement.getAttribute('data-theme');
      pick('Light').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const light = document.documentElement.getAttribute('data-theme');
      pick('Auto').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { dark, light, auto: document.documentElement.getAttribute('data-theme') };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const themes = themeEvaluation.result?.value;

  if (themes?.dark !== 'dark' || themes?.light !== 'light') {
    throw new Error(`The theme override did not apply: ${JSON.stringify(themes)}`);
  }

  // Optional visual capture for design review: VERDCT_SCREENSHOT=path npm run validate:chrome
  const screenshotPath = process.env.VERDCT_SCREENSHOT;
  if (screenshotPath) {
    const shot = await connection.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    }, sessionId);
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
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

  // 150 reviews is far above the trend floor, so this must resolve to a
  // direction rather than null.
  if (!['rising', 'falling', 'steady'].includes(rating.trend)) {
    throw new Error(
      `A heavily-reviewed professor returned no trend verdict: ${JSON.stringify(rating.trend)}`,
    );
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

  // Favorite the professor just looked up, reload, and confirm the popup joins
  // the favorite to its cached rating rather than showing a bare name.
  await connection.send('Runtime.evaluate', {
    expression: `chrome.storage.local.set({
      'verdct:favorites': [{
        normalizedName: 'hedvig mohacsy',
        displayName: 'Hedvig Mohacsy',
        addedAt: Date.now(),
      }],
    })`,
    awaitPromise: true,
  }, sessionId);
  await connection.send('Page.reload', {}, sessionId);

  let favorites;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const evaluation = await connection.send('Runtime.evaluate', {
      expression: `(() => {
        const items = [...document.querySelectorAll('li')].map((li) => li.innerText.trim());
        return { count: items.length, items };
      })()`,
      returnByValue: true,
    }, sessionId);
    favorites = evaluation.result?.value;
    if (favorites?.items?.some((item) => item.includes('Hedvig Mohacsy'))) break;
    await delay(100);
  }

  const favoriteRow = favorites?.items?.find((item) => item.includes('Hedvig Mohacsy'));
  if (!favoriteRow || !/\d\.\d/.test(favoriteRow)) {
    throw new Error(
      `The popup did not list the favorite with its cached rating: ${JSON.stringify(favorites)}`,
    );
  }

  // Seed this tab's course data so the Overview chart has something to draw.
  // The popup resolves data by active tab id, which in a plain tab is itself.
  await connection.send('Page.reload', {}, sessionId);
  await delay(400);

  const chartEvaluation = await connection.send('Runtime.evaluate', {
    expression: `(async () => {
      const tab = await chrome.tabs.getCurrent();
      await chrome.storage.session.set({
        ['verdct:tab:' + tab.id]: {
          courses: {
            'MAT 243': [
              { name: 'Jay Barraza', rating: 4.6, difficulty: 2.4, numRatings: 128 },
              { name: 'Phong Chau', rating: 4.4, difficulty: 4.1, numRatings: 63 },
              { name: 'Chandrani Banerjee', rating: 3.6, difficulty: 3.4, numRatings: 44 },
              { name: 'Frank Arthur', rating: 3.5, difficulty: 3.5, numRatings: 150 },
              { name: 'Sukitha Adappa', rating: 2.9, difficulty: 3.9, numRatings: 22 },
              { name: 'Adam Leighton', rating: 2.1, difficulty: 4.4, numRatings: 37 },
            ],
          },
          updatedAt: Date.now(),
        },
      });
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);

  if (!chartEvaluation.result?.value) {
    throw new Error('Could not seed course data for the chart check.');
  }

  let chart;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const evaluation = await connection.send('Runtime.evaluate', {
      expression: `(() => ({
        dots: document.querySelectorAll('svg circle').length,
        labels: document.querySelectorAll('svg text').length,
      }))()`,
      returnByValue: true,
    }, sessionId);
    chart = evaluation.result?.value;
    if (chart?.dots > 0) break;
    await delay(100);
  }

  if (chart?.dots !== 6) {
    const diag = await connection.send('Runtime.evaluate', {
      expression: `(async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const current = await chrome.tabs.getCurrent();
        const all = await chrome.storage.session.get(null);
        const reply = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'verdct:get-course-data', tabId: tabs[0]?.id },
            (r) => resolve({ r, err: chrome.runtime.lastError?.message ?? null }),
          );
        });
        return {
          queriedTabId: tabs[0]?.id ?? null,
          currentTabId: current?.id ?? null,
          sessionKeys: Object.keys(all),
          reply,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    throw new Error(
      `The popup chart did not plot every professor: ${JSON.stringify(chart)} :: ${JSON.stringify(diag.result?.value)}`,
    );
  }

  // Capture both themes, since the popup follows prefers-color-scheme.
  if (screenshotPath) {
    for (const scheme of ['light', 'dark']) {
      await connection.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      }, sessionId);
      await delay(200);
      const shot = await connection.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      }, sessionId);
      await writeFile(
        screenshotPath.replace(/\.png$/, `.${scheme}.png`),
        Buffer.from(shot.data, 'base64'),
      );
    }
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
      trend: rating.trend,
    },
    settingsControls: controls,
    themeOverride: themes,
    chart,
    screenshot: screenshotPath ?? null,
    favoriteRow,
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
