/**
 * Captures Chrome Web Store screenshots at exactly 1280x800.
 *
 * The pages under promo/ mount the real badge renderer and the real popup, so
 * what ends up in the store listing is the shipping UI rather than a mockup.
 * Only the surrounding page and the seeded section data are staged.
 */
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'promo-out');
const chromePath = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.PROMO_URL ?? 'http://localhost:5300/';

const WIDTH = 1280;
const HEIGHT = 800;

const SHOTS = [
  { name: '01-inline-ratings', query: 'shot=1' },
  { name: '02-hover-detail', query: 'shot=2' },
  { name: '03-compare-sections', query: 'shot=3' },
  { name: '04-settings-dark', query: 'shot=4&dark=1', scheme: 'dark' },
];

await access(chromePath);
await mkdir(outDir, { recursive: true });
const profileDirectory = await mkdtemp(path.join(projectRoot, '.tmp-chrome-'));

const chromeProcess = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-pipe',
    `--user-data-dir=${profileDirectory}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true },
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPipeConnection() {
  const input = chromeProcess.stdio[3];
  const output = chromeProcess.stdio[4];
  const pending = new Map();
  let nextId = 1;
  let buffered = Buffer.alloc(0);

  output.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    let index = buffered.indexOf(0);
    while (index >= 0) {
      const raw = buffered.subarray(0, index).toString('utf8');
      buffered = buffered.subarray(index + 1);
      if (raw) {
        const message = JSON.parse(raw);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
        }
      }
      index = buffered.indexOf(0);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
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
const captured = [];

try {
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);

  // Pinned so the output is exactly the size the store requires, whatever the
  // host window manager decides to do.
  await connection.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  for (const shot of SHOTS) {
    // Headless Chrome's default scheme varies; pin it so the popup and the
    // surrounding page never disagree.
    await connection.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: shot.scheme ?? 'light' }],
    }, sessionId);
    await connection.send('Page.navigate', { url: `${baseUrl}?${shot.query}` }, sessionId);

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const evaluation = await connection.send('Runtime.evaluate', {
        expression: `document.body.dataset.ready === 'true' && document.querySelectorAll('[data-verdct-badge], .popup-frame').length > 0`,
        returnByValue: true,
      }, sessionId);
      if (evaluation.result?.value) { ready = true; break; }
      await delay(150);
    }
    if (!ready) throw new Error(`${shot.name} never finished rendering.`);

    // Let fonts settle and entry animations finish before capturing.
    await connection.send('Runtime.evaluate', {
      expression: 'document.fonts ? document.fonts.ready.then(() => true) : true',
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    await delay(600);

    const image = await connection.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
    }, sessionId);

    const file = path.join(outDir, `${shot.name}.png`);
    await writeFile(file, Buffer.from(image.data, 'base64'));
    captured.push({ file: path.basename(file), bytes: Buffer.from(image.data, 'base64').length });
  }

  console.log(JSON.stringify({ size: `${WIDTH}x${HEIGHT}`, outDir, captured }, null, 2));
} finally {
  connection.close();
  if (chromeProcess.exitCode === null) {
    chromeProcess.kill();
    await delay(250);
  }
  try {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Chrome briefly retains profile files on Windows; leftovers are ignored by Git.
  }
}
