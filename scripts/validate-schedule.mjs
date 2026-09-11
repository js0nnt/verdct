import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Drives the schedule builder end to end in a real browser: the controls appear
 * on the live ASU results, a stored section makes the rows it overlaps warn,
 * clicking Add writes the section, and the popup draws the week from it.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = process.env.VERDCT_EXTENSION_DIR
  ? path.resolve(process.env.VERDCT_EXTENSION_DIR)
  : path.join(projectRoot, 'dist');
const chromePath = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const asuUrl = process.env.ASU_TEST_URL ??
  'https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&catalogNbr=243&honors=F&promod=F&searchType=all&subject=MAT&term=2267';

/** A section of the live results page, and one that deliberately clashes with it. */
const TERM = '2267';
const TARGET_CLASS_NUMBER = process.env.VERDCT_TEST_CLASS_NUMBER ?? '60678';
const CLASHING_SECTION = {
  classNumber: '99999',
  term: TERM,
  courseId: 'CSE 110',
  courseTitle: 'Principles of Programming',
  instructors: [],
  // The same Monday/Wednesday afternoon as MAT 243 section 60678.
  meetings: [{ days: ['Mon', 'Wed'], startMinutes: 900, endMinutes: 975 }],
  location: 'Tempe',
  dates: { start: '8/20', end: '12/4', sessionCode: 'C' },
  units: 3,
  unitsMax: null,
  seatsOpen: 5,
  seatsTotal: 60,
  addedAt: 1,
};

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
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true },
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createPipeConnection() {
  const input = chromeProcess.stdio[3];
  const output = chromeProcess.stdio[4];
  const pendingMessages = new Map();
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
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
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
  };
}

const connection = createPipeConnection();

async function openTab(url) {
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await connection.send('Runtime.enable', {}, sessionId);
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Page.navigate', { url }, sessionId);
  return sessionId;
}

async function evaluate(sessionId, expression, { awaitPromise = false } = {}) {
  const evaluation = await connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);

  if (evaluation.exceptionDetails) {
    throw new Error(`Evaluation failed: ${evaluation.exceptionDetails.text}`);
  }
  return evaluation.result?.value;
}

async function waitFor(sessionId, expression, isReady, attempts = 200) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    value = await evaluate(sessionId, expression);
    if (isReady(value)) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(value)}`);
}

/** Every schedule control on the page, read out of its shadow root. */
const CONTROL_STATE = `(() => {
  const hosts = [...document.querySelectorAll('[data-verdct-schedule]')];
  return {
    rowCount: document.querySelectorAll('#class-results .class-accordion').length,
    controls: hosts.map((host) => {
      const button = host.shadowRoot?.querySelector('button');
      return {
        classNumber: host.getAttribute('data-verdct-schedule'),
        label: button?.textContent ?? '',
        tone: button?.className ?? 'no-shadow-root',
        aria: button?.getAttribute('aria-label') ?? '',
      };
    }),
  };
})()`;

function controlFor(state, classNumber) {
  const control = state.controls.find((entry) => entry.classNumber === classNumber);
  if (!control) {
    throw new Error(`No schedule control for class number ${classNumber}`);
  }
  return control;
}

const report = {};

try {
  const { id } = await connection.send('Extensions.loadUnpacked', { path: extensionDirectory });

  // The popup page is the only context with chrome.storage, so it seeds the
  // clashing section and later proves the schedule renders.
  const popupSession = await openTab(`chrome-extension://${id}/popup.html`);
  await waitFor(
    popupSession,
    `({ ready: document.readyState === 'complete' && document.body.innerText.length > 0 })`,
    (value) => value?.ready,
    40,
  );

  await evaluate(
    popupSession,
    `chrome.storage.local.set({ 'verdct:schedule': ${JSON.stringify([CLASHING_SECTION])} })`,
    { awaitPromise: true },
  );

  const asuSession = await openTab(asuUrl);
  const initial = await waitFor(
    asuSession,
    CONTROL_STATE,
    (value) => value?.rowCount > 0 && value.controls.length === value.rowCount,
  );

  report.rowCount = initial.rowCount;
  report.controlCount = initial.controls.length;

  const unlabelled = initial.controls.filter(
    (control) => !/^(\+Plan|✓Planned)$/.test(control.label),
  );
  if (unlabelled.length > 0) {
    throw new Error(`Controls rendered without a label: ${JSON.stringify(unlabelled)}`);
  }

  // The seeded section shares its hour with the target row, so that row must
  // warn before anything is added, and the rest must not.
  const warned = initial.controls.filter((control) => control.tone.includes('clash'));
  report.warnedBeforeAdding = warned.map((control) => control.classNumber);

  const target = controlFor(initial, TARGET_CLASS_NUMBER);
  if (!target.tone.includes('clash')) {
    throw new Error(`Section ${TARGET_CLASS_NUMBER} did not warn about the seeded clash: ${JSON.stringify(target)}`);
  }
  if (!target.aria.includes('Overlaps CSE 110 (99999)')) {
    throw new Error(`The clash warning did not name the section it clashes with: ${target.aria}`);
  }
  if (warned.length === initial.controls.length) {
    throw new Error('Every row warned, so the overlap test proves nothing.');
  }

  await evaluate(
    asuSession,
    `document.querySelector('[data-verdct-schedule="${TARGET_CLASS_NUMBER}"]')
      .shadowRoot.querySelector('button').click()`,
  );

  const afterAdd = await waitFor(
    asuSession,
    CONTROL_STATE,
    (value) => controlFor(value, TARGET_CLASS_NUMBER).tone.includes('scheduled'),
    40,
  );
  report.afterAdding = controlFor(afterAdd, TARGET_CLASS_NUMBER);

  const stored = await evaluate(
    popupSession,
    `chrome.storage.local.get('verdct:schedule').then((all) => all['verdct:schedule'])`,
    { awaitPromise: true },
  );
  report.storedClassNumbers = stored.map((section) => section.classNumber);

  const added = stored.find((section) => section.classNumber === TARGET_CLASS_NUMBER);
  if (!added) {
    throw new Error(`Clicking Add did not store the section: ${JSON.stringify(stored)}`);
  }
  if (added.meetings.length === 0 || !added.courseId || added.units === null) {
    throw new Error(`The stored section is missing what the row showed: ${JSON.stringify(added)}`);
  }
  report.addedSection = added;

  // Clicking again has to remove it, or the control is a one-way door.
  await evaluate(
    asuSession,
    `document.querySelector('[data-verdct-schedule="${TARGET_CLASS_NUMBER}"]')
      .shadowRoot.querySelector('button').click()`,
  );
  const afterRemove = await waitFor(
    asuSession,
    CONTROL_STATE,
    (value) => !controlFor(value, TARGET_CLASS_NUMBER).tone.includes('scheduled'),
    40,
  );
  report.afterRemoving = controlFor(afterRemove, TARGET_CLASS_NUMBER);

  // Put it back, so the popup has a real overlap to draw.
  await evaluate(
    asuSession,
    `document.querySelector('[data-verdct-schedule="${TARGET_CLASS_NUMBER}"]')
      .shadowRoot.querySelector('button').click()`,
  );
  await waitFor(
    asuSession,
    CONTROL_STATE,
    (value) => controlFor(value, TARGET_CLASS_NUMBER).tone.includes('scheduled'),
    40,
  );

  await connection.send('Page.reload', {}, popupSession);
  await waitFor(
    popupSession,
    `({ ready: document.readyState === 'complete' && document.body.innerText.includes('Schedule') })`,
    (value) => value?.ready,
    40,
  );

  await evaluate(
    popupSession,
    `[...document.querySelectorAll('[role="tab"]')]
      .find((button) => button.textContent === 'Schedule').click()`,
  );

  const scheduleTab = await waitFor(
    popupSession,
    `(() => {
      const text = document.body.innerText;
      const blocks = [...document.querySelectorAll('[title]')].map((node) => node.getAttribute('title'));
      return {
        text,
        blocks,
        sections: document.querySelectorAll('ul li').length,
      };
    })()`,
    (value) => value?.blocks.length > 0,
    40,
  );

  report.popupBlocks = scheduleTab.blocks.length;
  report.popupText = scheduleTab.text.split('\n').filter(Boolean).slice(0, 12);

  if (!/overlap/i.test(scheduleTab.text)) {
    throw new Error(`The popup did not report the overlap: ${scheduleTab.text}`);
  }
  if (!scheduleTab.text.includes('MAT 243') || !scheduleTab.text.includes('CSE 110')) {
    throw new Error(`The popup did not list both sections: ${scheduleTab.text}`);
  }
  if (!/units/.test(scheduleTab.text)) {
    throw new Error(`The popup did not total the units: ${scheduleTab.text}`);
  }

  const conflictedBlocks = scheduleTab.blocks.filter((title) =>
    title.includes('Overlaps another section'),
  );
  if (conflictedBlocks.length < 2) {
    throw new Error(`The week grid did not mark the clash: ${JSON.stringify(scheduleTab.blocks)}`);
  }

  // Design review needs to see the real thing, both on ASU's page and in the popup.
  if (process.env.VERDCT_SCREENSHOT) {
    const base = path.resolve(process.env.VERDCT_SCREENSHOT);
    for (const [session, name, width, height] of [
      [popupSession, 'popup-schedule', 320, 900],
      [asuSession, 'asu-controls', 1280, 900],
    ]) {
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 2, mobile: false,
      }, session);
      const { data } = await connection.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
      }, session);
      const file = path.join(path.dirname(base), `${path.basename(base, '.png')}-${name}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      report.screenshots = [...(report.screenshots ?? []), file];
    }
  }

  console.log(JSON.stringify(report, null, 2));
  console.log('\nSchedule builder validated against the live ASU Class Search.');
} finally {
  connection.close();
  chromeProcess.kill();
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
}
