import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = path.join(projectRoot, 'dist');
const chromePath = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const asuUrl = process.env.ASU_TEST_URL ??
  'https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&catalogNbr=243&honors=F&promod=F&searchType=all&subject=MAT&term=2267';
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
    getEvents() {
      return [...events];
    },
    close() {
      input.end();
      output.destroy();
    },
  };
}

/**
 * Reads the injected badges out of their shadow roots. Badges are the observable
 * end of the whole pipeline: a resolved one means scan, lookup, cache, and
 * render all worked against the live page.
 */
const BADGE_STATE_EXPRESSION = `(() => {
  const hosts = [...document.querySelectorAll('[data-verdct-badge]')];
  const badges = hosts.map((host) => {
    // The badge is an anchor so it links to the professor's RMP page.
    const badge = host.shadowRoot?.querySelector('a');
    return {
      professor: host.getAttribute('data-verdct-badge'),
      tone: badge?.className ?? 'no-shadow-root',
      text: badge?.textContent ?? '',
      href: badge?.getAttribute('href') ?? '',
    };
  });
  const bestRows = [...document.querySelectorAll('[data-verdct-best]')].filter(
    (node) => node.tagName !== 'STYLE',
  );
  return {
    bestRowCount: bestRows.length,
    bestLabelled: bestRows.filter((row) => row.querySelector('[data-verdct-best-chip]')).length,
    bestAwards: bestRows.map((row) => row.getAttribute('data-verdct-best')),
    bestProfessors: bestRows.map((row) => {
      const host = row.querySelector('[data-verdct-badge]');
      return host?.getAttribute('data-verdct-badge') ?? '';
    }),
    readyState: document.readyState,
    rowCount: document.querySelectorAll('#class-results .class-accordion').length,
    instructorCount: document.querySelectorAll('#class-results .class-accordion .class-results-cell.instructor').length,
    sampleCourse: document.querySelector('#class-results .class-accordion .class-results-cell.course .bold-hyperlink')?.textContent?.trim() ?? '',
    badgeCount: badges.length,
    resolvedBadges: badges.filter((badge) => badge.tone !== 'loading'),
    ratedBadges: badges.filter((badge) => ['good', 'fair', 'poor'].includes(badge.tone)),
  };
})()`;

async function readBadgeState(connection, sessionId) {
  const evaluation = await connection.send('Runtime.evaluate', {
    expression: BADGE_STATE_EXPRESSION,
    returnByValue: true,
  }, sessionId);

  if (evaluation.exceptionDetails) {
    throw new Error(`Badge inspection failed: ${evaluation.exceptionDetails.text}`);
  }
  return evaluation.result?.value;
}

const connection = createPipeConnection();

try {
  await connection.send('Extensions.loadUnpacked', { path: extensionDirectory });
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });

  await connection.send('Runtime.enable', {}, sessionId);
  await connection.send('Log.enable', {}, sessionId);
  await connection.send('Page.enable', {}, sessionId);
  const navigationStartedAt = Date.now();
  await connection.send('Page.navigate', { url: asuUrl }, sessionId);

  // Live RMP lookups are throttled, so allow generous time for the first batch
  // of badges to settle out of their loading state.
  let pageState;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    pageState = await readBadgeState(connection, sessionId);
    if (
      pageState?.rowCount > 0 &&
      pageState.badgeCount > 0 &&
      pageState.ratedBadges.length > 0 &&
      pageState.resolvedBadges.length === pageState.badgeCount
    ) {
      break;
    }
    await delay(200);
  }

  // Cold-cache wall clock: the profile is disposable, so nothing is cached.
  const secondsToAllBadges = Number(((Date.now() - navigationStartedAt) / 1000).toFixed(1));

  if (!pageState?.rowCount) {
    throw new Error(`Verdct found no live ASU rows: ${JSON.stringify(pageState)}`);
  }
  if (!pageState.badgeCount) {
    throw new Error(`Verdct rendered no badges on the live page: ${JSON.stringify(pageState)}`);
  }
  if (!pageState.ratedBadges.length) {
    throw new Error(
      `No badge resolved to a rating; lookups may be failing: ${JSON.stringify(pageState)}`,
    );
  }

  const initialBadgeCount = pageState.badgeCount;

  const mutation = await connection.send('Runtime.evaluate', {
    expression: `(() => {
      const row = document.querySelector('#class-results .class-accordion');
      if (!row) return false;
      const clone = row.cloneNode(true);
      clone.dataset.verdctValidationClone = 'true';
      row.parentElement.append(clone);
      return true;
    })()`,
    returnByValue: true,
  }, sessionId);

  if (!mutation.result?.value) {
    throw new Error('Could not create the temporary mutation-observer validation row.');
  }

  // The clone carries a copy of the badge host element but not its shadow root,
  // so this also exercises the orphan-replacement path in the renderer.
  let mutationObserved = false;
  let mutationState;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    mutationState = await readBadgeState(connection, sessionId);
    if (
      mutationState.badgeCount > initialBadgeCount &&
      mutationState.resolvedBadges.length === mutationState.badgeCount
    ) {
      mutationObserved = true;
      break;
    }
    await delay(200);
  }

  await connection.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-verdct-validation-clone]')?.remove()`,
  }, sessionId);

  if (!mutationObserved) {
    throw new Error(
      `The MutationObserver did not badge an inserted result row: ${JSON.stringify(mutationState)}`,
    );
  }

  const finalState = await readBadgeState(connection, sessionId);

  // The chart now lives in the popup, so the page's job is to report what it
  // found. Verify from an extension page that the per-tab record was written
  // and the toolbar badge — the only gesture-free attention signal Chrome
  // allows — reflects it.
  const { extensions } = await connection.send('Extensions.getExtensions');
  const verdctId = extensions.find((extension) => extension.name === 'Verdct')?.id;
  const { targetId: popupTarget } = await connection.send('Target.createTarget', {
    url: `chrome-extension://${verdctId}/popup.html`,
  });
  const { sessionId: popupSession } = await connection.send('Target.attachToTarget', {
    targetId: popupTarget,
    flatten: true,
  });
  await connection.send('Runtime.enable', {}, popupSession);

  let reported;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const evaluation = await connection.send('Runtime.evaluate', {
      expression: `(async () => {
        const all = await chrome.storage.session.get(null);
        const entry = Object.entries(all).find(([key]) => key.startsWith('verdct:tab:'));
        if (!entry) return { found: false };
        const tabId = Number(entry[0].slice('verdct:tab:'.length));
        const courses = entry[1]?.courses ?? {};
        return {
          found: true,
          courses: Object.fromEntries(
            Object.entries(courses).map(([id, points]) => [id, points.length]),
          ),
          badgeText: await chrome.action.getBadgeText({ tabId }),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, popupSession);
    reported = evaluation.result?.value;
    if (reported?.found && reported.badgeText) break;
    await delay(250);
  }

  if (!reported?.found || !reported.badgeText) {
    throw new Error(
      `The page did not report its courses to the background: ${JSON.stringify(reported)}`,
    );
  }

  // The reference page lists many distinct professors, so exactly one course
  // group should win and every winning row should carry its explanatory chip.
  const unlinked = finalState.ratedBadges.filter((badge) => !badge.href.includes('/professor/'));
  if (unlinked.length > 0) {
    throw new Error(`Rated badges are missing their RMP link: ${JSON.stringify(unlinked)}`);
  }

  if (!finalState.bestRowCount) {
    throw new Error(
      `No best section was highlighted: ${JSON.stringify({
        trendArrows: finalState.ratedBadges.filter((badge) => /[▲▼]/.test(badge.text)).length,
    linkedBadges: finalState.ratedBadges.filter((badge) => badge.href.includes('/professor/')).length,
    reportedCourses: reported.courses,
    toolbarBadge: reported.badgeText,
    bestRowCount: finalState.bestRowCount,
        ratedBadges: finalState.ratedBadges.length,
      })}`,
    );
  }
  if (finalState.bestLabelled !== finalState.bestRowCount) {
    throw new Error(
      `A highlighted row is missing its "Best rated" label: ${JSON.stringify(finalState)}`,
    );
  }
  const toneBreakdown = finalState.resolvedBadges.reduce((totals, badge) => {
    totals[badge.tone] = (totals[badge.tone] ?? 0) + 1;
    return totals;
  }, {});

  const browserErrors = connection.getEvents().filter((event) =>
    event.sessionId === sessionId && (
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (
        event.method === 'Log.entryAdded' &&
        event.params.entry?.level === 'error' &&
        event.params.entry?.url?.startsWith('chrome-extension://')
      )
    ),
  );

  if (browserErrors.length > 0) {
    throw new Error(`Chrome reported live-page errors: ${JSON.stringify(browserErrors)}`);
  }

  console.log(JSON.stringify({
    url: asuUrl,
    secondsToAllBadges,
    rowCount: pageState.rowCount,
    instructorCount: pageState.instructorCount,
    sampleCourse: pageState.sampleCourse,
    badgeCount: finalState.badgeCount,
    unresolvedBadges: finalState.badgeCount - finalState.resolvedBadges.length,
    toneBreakdown,
    trendArrows: finalState.ratedBadges.filter((badge) => /[▲▼]/.test(badge.text)).length,
    linkedBadges: finalState.ratedBadges.filter((badge) => badge.href.includes('/professor/')).length,
    reportedCourses: reported.courses,
    toolbarBadge: reported.badgeText,
    bestRowCount: finalState.bestRowCount,
    bestAwards: [...new Set(finalState.bestAwards)],
    bestProfessors: [...new Set(finalState.bestProfessors)],
    sampleBadges: finalState.ratedBadges.slice(0, 5),
    mutationObserved,
    browserErrors: browserErrors.length,
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
