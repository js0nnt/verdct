import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Drives lecture and recitation pairing end to end against the live ASU Class
 * Search, using CHM 113: its Tempe lectures need one recitation and one lab,
 * and its Downtown Phoenix sections are tied to their own lectures.
 *
 * - Plan on a lecture opens the picker and saves nothing until one of each
 *   component is chosen; confirming saves the three sections together.
 * - Plan on another recitation of that lecture swaps it in.
 * - Plan on a recitation that belongs to a different lecture saves nothing.
 * - Pressing the lecture again removes the whole group.
 * - The popup lists the recitation and lab under their lecture.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = process.env.VERDCT_EXTENSION_DIR
  ? path.resolve(process.env.VERDCT_EXTENSION_DIR)
  : path.join(projectRoot, 'dist');
const chromePath = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const asuUrl = process.env.ASU_TEST_URL ??
  'https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&catalogNbr=113&honors=F&promod=F&searchType=all&subject=CHM&term=2267';
const LECTURE = process.env.VERDCT_TEST_LECTURE ?? '60104';

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
    // Awaited, so a check can read chrome.storage, which only answers with a promise.
    value = await evaluate(sessionId, expression, { awaitPromise: true });
    if (isReady(value)) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(value)}`);
}

function clickControl(classNumber) {
  return `(() => {
    const host = document.querySelector('[data-verdct-schedule="${classNumber}"]');
    const button = host?.shadowRoot?.querySelector('button');
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

function controlLabel(classNumber) {
  return `document.querySelector('[data-verdct-schedule="${classNumber}"]')
    ?.shadowRoot?.querySelector('button')?.textContent ?? null`;
}

/** The picker's groups and options, read out of its shadow root. */
const PICKER_STATE = `(() => {
  const root = document.querySelector('[data-verdct-picker]')?.shadowRoot;
  if (!root) return null;
  const confirm = root.querySelector('.confirm');
  return {
    title: root.querySelector('h2')?.textContent ?? '',
    groups: [...root.querySelectorAll('[role="radiogroup"]')].map((group) => ({
      component: group.getAttribute('aria-label'),
      options: [...group.querySelectorAll('.option')].map((option) => option.dataset.classNumber),
    })),
    confirmDisabled: confirm?.disabled ?? null,
    confirmLabel: confirm?.textContent ?? '',
  };
})()`;

function stored(popupSession) {
  return evaluate(
    popupSession,
    `chrome.storage.local.get('verdct:schedule').then((all) =>
      (all['verdct:schedule'] ?? []).map((entry) => ({
        classNumber: entry.classNumber,
        component: entry.component,
        pairedWith: entry.pairedWith,
      })))`,
    { awaitPromise: true },
  );
}

const report = {};

try {
  const { id } = await connection.send('Extensions.loadUnpacked', { path: extensionDirectory });

  const popupSession = await openTab(`chrome-extension://${id}/popup.html`);
  await waitFor(
    popupSession,
    `document.readyState === 'complete' && document.body.innerText.length > 0`,
    Boolean,
    40,
  );
  await evaluate(popupSession, `chrome.storage.local.set({ 'verdct:schedule': [] })`, {
    awaitPromise: true,
  });

  const asuSession = await openTab(asuUrl);
  await waitFor(
    asuSession,
    `document.querySelectorAll('[data-verdct-schedule]').length`,
    (count) => count > 20,
  );

  // Which recitations belong to whom, asked of the same API the page uses, so
  // the test does not go stale when ASU renumbers sections next term.
  const layout = await evaluate(
    asuSession,
    `fetch('https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes?' +
        new URLSearchParams({ refine: 'Y', searchType: 'all', term: '2267', classNbr: '${LECTURE}', campusOrOnlineSelection: 'A' }),
        { headers: { Authorization: 'Bearer null' } })
      .then((response) => response.json())
      .then(async (found) => {
        const lecture = found.classes[0].CLAS;
        const all = await fetch('https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes?' +
            new URLSearchParams({ refine: 'Y', searchType: 'all', term: '2267', course_id: lecture.CRSEID, campusOrOnlineSelection: 'A' }),
            { headers: { Authorization: 'Bearer null' } }).then((response) => response.json());
        const onPage = new Set([...document.querySelectorAll('[data-verdct-schedule]')].map((host) => host.getAttribute('data-verdct-schedule')));
        const rows = all.classes.map((entry) => entry.CLAS).filter((entry) => onPage.has(entry.CLASSNBR));
        const pairs = (entry) => entry.CLASSTYPE === 'N' && entry.CRSEOFFERNBR === lecture.CRSEOFFERNBR &&
          (!entry.ASSOCIATEDCLASS || entry.ASSOCIATEDCLASS === '0' || entry.ASSOCIATEDCLASS === lecture.ASSOCIATEDCLASS);
        return {
          ownRecitations: rows.filter((entry) => entry.COMPONENTPRIMARY === 'REC' && pairs(entry)).map((entry) => entry.CLASSNBR),
          foreignRecitation: rows.find((entry) => entry.COMPONENTPRIMARY === 'REC' && !pairs(entry))?.CLASSNBR ?? null,
        };
      })`,
    { awaitPromise: true },
  );
  report.layout = { own: layout.ownRecitations.length, foreign: layout.foreignRecitation };
  if (layout.ownRecitations.length < 2 || !layout.foreignRecitation) {
    throw new Error(`CHM 113 no longer has the shape this test needs: ${JSON.stringify(layout)}`);
  }

  // 1. Plan on the lecture opens the picker and saves nothing yet.
  await evaluate(asuSession, clickControl(LECTURE));
  const picker = await waitFor(asuSession, PICKER_STATE, (value) => value?.groups.length > 0, 80);
  report.picker = {
    title: picker.title,
    groups: picker.groups.map((group) => `${group.component}: ${group.options.length}`),
    confirmDisabled: picker.confirmDisabled,
  };
  if (!picker.confirmDisabled) {
    throw new Error('The picker allowed planning before anything was chosen.');
  }
  const recitationGroup = picker.groups.find((group) => group.component === 'Recitation');
  if (!recitationGroup || !layout.ownRecitations.every((number) => recitationGroup.options.includes(number))) {
    throw new Error(`The picker did not offer the lecture's recitations: ${JSON.stringify(picker.groups)}`);
  }
  if (recitationGroup.options.includes(layout.foreignRecitation)) {
    throw new Error(`The picker offered a recitation tied to another lecture: ${layout.foreignRecitation}`);
  }
  if ((await stored(popupSession)).length !== 0) {
    throw new Error('The lecture was saved before its recitation was chosen.');
  }

  if (process.env.VERDCT_SCREENSHOT) {
    const base = path.resolve(process.env.VERDCT_SCREENSHOT);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 2, mobile: false,
    }, asuSession);
    // Re-open so the panel is placed against the resized page.
    await evaluate(asuSession, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await waitFor(asuSession, PICKER_STATE, (value) => value === null, 40);
    await evaluate(asuSession, clickControl(LECTURE));
    await waitFor(asuSession, PICKER_STATE, (value) => value?.groups.length > 0, 80);
    await delay(400);
    const { data } = await connection.send('Page.captureScreenshot', { format: 'png' }, asuSession);
    const file = path.join(path.dirname(base), `${path.basename(base, '.png')}-picker.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    report.pickerScreenshot = file;
  }

  // 2. Choose the first of each, then confirm.
  await evaluate(
    asuSession,
    `(() => {
      const root = document.querySelector('[data-verdct-picker]').shadowRoot;
      for (const group of root.querySelectorAll('[role="radiogroup"]')) {
        group.querySelector('.option').click();
      }
      return root.querySelector('.confirm').disabled;
    })()`,
  );
  const ready = await evaluate(asuSession, PICKER_STATE);
  if (ready.confirmDisabled) throw new Error('Choosing one of each did not enable planning.');
  await evaluate(
    asuSession,
    `document.querySelector('[data-verdct-picker]').shadowRoot.querySelector('.confirm').click()`,
  );
  const planned = await waitFor(
    popupSession,
    `chrome.storage.local.get('verdct:schedule').then((all) => (all['verdct:schedule'] ?? []).length)`,
    (count) => count === 1 + picker.groups.length,
    80,
  ).then(() => stored(popupSession));
  report.planned = planned;
  const lecture = planned.find((entry) => entry.classNumber === LECTURE);
  const companions = planned.filter((entry) => entry.pairedWith === LECTURE);
  if (!lecture || lecture.pairedWith !== null || companions.length !== picker.groups.length) {
    throw new Error(`The group was not saved together: ${JSON.stringify(planned)}`);
  }
  const chosenRecitation = companions.find((entry) => entry.component === 'Recitation')?.classNumber;

  await waitFor(asuSession, controlLabel(chosenRecitation), (label) => label === '✓Paired', 40);

  // 3. Plan on a different recitation of the same lecture swaps it in.
  const swapTo = layout.ownRecitations.find((number) => number !== chosenRecitation);
  await evaluate(asuSession, clickControl(swapTo));
  const swapped = await waitFor(
    popupSession,
    `chrome.storage.local.get('verdct:schedule').then((all) =>
      (all['verdct:schedule'] ?? []).filter((entry) => entry.component === 'Recitation').map((entry) => entry.classNumber))`,
    (numbers) => numbers?.length === 1 && numbers[0] === swapTo,
    80,
  );
  report.swapped = { from: chosenRecitation, to: swapped[0] };

  // 4. A recitation that belongs to another lecture is refused.
  const before = await stored(popupSession);
  await evaluate(asuSession, clickControl(layout.foreignRecitation));
  await waitFor(asuSession, controlLabel(layout.foreignRecitation), (label) => label === '+Plan', 80);
  await delay(1_500);
  const afterForeign = await stored(popupSession);
  if (JSON.stringify(afterForeign) !== JSON.stringify(before)) {
    throw new Error(`A recitation from another lecture was planned: ${JSON.stringify(afterForeign)}`);
  }
  const tip = await evaluate(
    asuSession,
    `document.querySelector('[data-verdct-tooltip]')?.shadowRoot?.querySelector('.tip')?.textContent ?? ''`,
  );
  report.foreignRefusal = tip;
  if (!/different lecture/i.test(tip)) {
    throw new Error(`Refusing the recitation did not explain why: ${tip}`);
  }

  // 5. The popup lists the companions under their lecture.
  await evaluate(popupSession, 'location.reload()');
  await waitFor(popupSession, `document.querySelectorAll('[role="tab"]').length`, (count) => count === 3, 40);
  await evaluate(popupSession, `document.querySelectorAll('[role="tab"]')[1].click()`);
  const popupText = await waitFor(
    popupSession,
    `document.querySelector('#verdct-panel-schedule')?.innerText ?? ''`,
    (text) => /RECITATION/i.test(text) && /LABORATORY/i.test(text),
    40,
  );
  report.popupMentions = popupText.split('\n').filter((line) => /recitation|laboratory|CHM 113/i.test(line)).slice(0, 8);

  if (process.env.VERDCT_SCREENSHOT) {
    const base = path.resolve(process.env.VERDCT_SCREENSHOT);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 360, height: 560, deviceScaleFactor: 2, mobile: false,
    }, popupSession);
    const { data } = await connection.send('Page.captureScreenshot', { format: 'png' }, popupSession);
    const file = path.join(path.dirname(base), `${path.basename(base, '.png')}-popup.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    report.popupScreenshot = file;
  }

  // 6. Pressing the lecture again removes the whole group.
  await evaluate(asuSession, clickControl(LECTURE));
  await waitFor(
    popupSession,
    `chrome.storage.local.get('verdct:schedule').then((all) => (all['verdct:schedule'] ?? []).length)`,
    (count) => count === 0,
    80,
  );
  report.removedAsGroup = true;

  console.log(JSON.stringify(report, null, 2));
  console.log('\nRecitation pairing validated against the live ASU Class Search.');
} finally {
  connection.close();
  chromeProcess.kill();
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
}
