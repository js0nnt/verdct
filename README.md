# Verdct

Verdct is a Manifest V3 Chrome extension that shows RateMyProfessor summaries directly in ASU Class Search.

## Install (unpacked)

1. Install dependencies with `npm install`.
2. Build the unpacked extension with `npm run build`.
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist` directory.
4. Open ASU Class Search and run a course search. A colored badge appears next to each instructor.

## Phase 1 (shipped)

The MVP is complete and verified against the live ASU Class Search:

- **Scanning** — `src/content/domScanner.ts` extracts `{ professorName, courseId }` per result row. A debounced `MutationObserver` re-scans on paginated and lazy-loaded results, and ignores Verdct's own injected DOM so rendering cannot retrigger a scan.
- **Badges** — `src/content/badgeRenderer.ts` injects a Shadow DOM badge after each instructor link: a neutral pill whose only colour is a 5px tone dot — green at or above 4.0, amber 2.5–3.9, red below 2.5, and a quiet dashed outline when no confident match was found. A small patch of colour reads as a signal where a filled pill, times seventeen rows, reads as noise. Hovering or focusing a badge opens a popover with the rating, difficulty and would-take-again bars, and the rating count. Popover content is built from DOM nodes rather than `innerHTML`, since professor names come from untrusted page and API text.
- **Sample size is visible** — a rating resting on fewer than 5 reviews keeps its color but is drawn with a dashed border and labelled *provisional* in the popover. A 4.7 from 3 students should not read as confidently as a 4.7 from 150.
- **Lookups** — `src/background/rmpClient.ts` queries RateMyProfessor's GraphQL endpoint scoped to ASU's school ID, with defensive parsing and a minimum interval between requests. `src/background/nameMatcher.ts` reconciles ASU's "Last, First" formatting with RMP's "First Last" and returns an explicit no-match rather than guessing.
- **Caching** — `src/background/cache.ts` stores aggregates in `chrome.storage.local` keyed by normalized name, with a 7-day TTL, a shorter 1-day TTL for no-match results, an LRU cap of 500 entries, and serialized writes. Identical in-flight lookups share one request, so a page listing the same professor eight times costs one fetch. A revisited page is effectively instant.
- **Request concurrency** — up to 4 RMP requests in flight, 120ms apart. Strict serialization at 750ms made a cold page take ~16 seconds: seventeen rows resolve to sixteen requests, each waiting for the previous to finish before its own delay even began. The same page now settles in under 4 seconds.
- **Click through to RateMyProfessor** — the badge is an anchor to `ratemyprofessors.com/professor/<legacyId>`, so middle-click, open-in-new-tab and copy-link all behave normally. Only a matched professor gets an href; an unmatched badge stays focusable for the popover but does not pretend to link anywhere.
- **Graceful degradation** — network failures, schema changes, corrupt cache records, and missing matches all fall back to a neutral gray badge. Nothing throws into ASU's page.

## Phase 2 (shipped)

- **Best-section highlight** — `src/content/bestSection.ts` groups rows by course and marks the section(s) taught by the highest-rated professor with a green accent and a "Best rated" label. Winning takes stronger evidence than a badge does: only high-confidence name matches with at least 5 ratings are eligible, so a 4.7 from 3 students never outranks a 4.5 from 200. A course showing only one rated professor is left unmarked, since there is no choice to make. Ties all win rather than picking arbitrarily.

- **Popup** — two tabs. **Overview** carries the comparison chart and favorites; **Settings** carries the theme toggle, cache TTL, badge thresholds on live sliders that preview the real badge styling, the cached-professor count, and a clear-cache button. Threshold changes restyle open Class Search tabs immediately via `chrome.storage.onChanged`. Stored settings are user-editable and survive upgrades, so every field is re-validated on read; the two thresholds are bounded by each other so the band can never invert.

- **Quality-vs-difficulty scatter** — lives in the popup's Overview tab. The content script reports rated professors per course to the background worker, which keeps them per tab in `chrome.storage.session`; the popup charts the active tab's course, with pills when a result set spans several. Layout maths sits in `src/shared/scatterGeometry.ts`: dot size reflects how many reviews back each point, corners are captioned so the axes need no decoding, and labels prefer above a dot, fall back to below, and are dropped rather than printed over a neighbour or outside the plot.
- **Toolbar badge** — the extension icon shows how many rated professors the current tab has to compare. This is the attention signal, because Chrome does not let an extension open its own popup in response to page activity (see Known constraints).

- **Rating trend** — `src/background/trend.ts` compares the recent half of a professor's reviews against the older half and shows ▲ or ▼ on the badge. RMP does expose per-review dates, so this is real rather than best-effort, but it is deliberately conservative: it needs at least 12 usable reviews, looks at the 20 most recent, and requires a half-point gap before calling a direction. "Steady" gets no arrow, since most professors are steady and an arrow on every badge would be noise. The reviews are re-sorted by date rather than trusting RMP's ordering, so a change in their default order cannot silently invert every arrow.

- **Favorites** — the popover carries a save toggle, and the popup lists shortlisted professors joined to their cached ratings. Saving in one place updates open Class Search tabs through `chrome.storage.onChanged`. Adding this required making the popover interactive rather than a pure hover tooltip: it now stays open while the pointer is inside it, with a short close delay so moving from badge to panel does not dismiss it.

- **Theme** — light / dark / auto, chosen in Settings, over one neutral palette shared between `src/content/theme.ts` and the Tailwind config. Auto follows `prefers-color-scheme` and tracks it live. The popup and the on-page popover honour the choice; badges stay light whatever the setting, since they sit inside ASU's page, which is always light, and a dark chip in a white results table would read as broken rather than as dark mode.

Only aggregate numbers are stored. No review text, reviewer data, or browsing activity is collected or transmitted.

## Verification

| Command | What it proves |
| --- | --- |
| `npm test` | 156 unit tests across the scanner, matcher, RMP parser, cache, and badge renderer. |
| `npm run typecheck` | Strict TypeScript across all entry points. |
| `npm run validate:chrome` | Loads the built extension in a disposable headless Chrome profile: the service worker starts, the popup renders without errors, a live RMP lookup succeeds, and a repeat lookup in ASU's `"Last, First"` format is served from cache without a second fetch, the settings controls render, and a saved favorite is listed with the rating joined from cache, the Settings tab renders its controls, the theme override beats the OS setting, and the Overview chart plots every seeded professor. Set `VERDCT_SCREENSHOT=<path>` to capture the popup for design review. |
| `npm run validate:asu` | Drives the live ASU Class Search and asserts every result row receives a badge that resolves out of its loading state, including a dynamically inserted row. |
| `npm run preview:badges` | Opens a design harness at `localhost:5199` rendering the real badge module against mock ASU rows in every state — rated, provisional, unmatched, loading, failed. Use it to iterate on badge styling without a live search. |
| `npm run inspect:rmp` | Reproduces the first-party GraphQL request inspection used to maintain the RMP client when its undocumented schema changes. |

Set `CHROME_PATH` when Chrome is installed outside its default Windows location. `validate:asu` defaults to Fall 2026 MAT 243; set `ASU_TEST_URL` to target a different current result page.

Latest `validate:asu` run: 17 of 17 rows badged in **3.9s cold-cache** (was 15.8s), 0 unresolved, 7 trend arrows, 14 of 14 rated badges linked to RMP, 1 best section highlighted, 0 page errors. `validate:asu` reports `secondsToAllBadges`, so a performance regression shows up as a number rather than a feeling.

## Known constraints

- **Both upstreams are undocumented and unstable.** ASU's selectors live only in `domScanner.ts`; RMP's query and response parsing live only in `rmpClient.ts`. Either can be repaired without touching the rest of the codebase.
- **The popup cannot open itself when you run a search.** `chrome.action.openPopup()` requires a user gesture, and per Chrome's own guidance a message from a content script does not carry one, so page activity cannot open the popup. The toolbar badge count is the supported substitute: it needs no gesture and marks the icon when a comparison is ready.
- **A trend costs a second request.** Individual reviews are not in the search response, so a confident match with at least 12 reviews triggers one extra throttled query. Thinly-rated professors and no-match names still cost a single request, and the result is cached with the rating.
- **ASU's school ID on RMP is hardcoded** (`ASU_RMP_SCHOOL_ID`) rather than re-searched per lookup.
- **Instructors not on RateMyProfessor render gray.** In the reference MAT 243 run, 3 of 17 rows had no confident match. This is deliberate: a low-confidence guess is worse than no answer.

## Not yet built

Phase 3 (sentiment tags, seat alerts, alternate-section recommender)..

## Privacy

Verdct has no server, no analytics, and no account. The only outbound request is a professor-name lookup to RateMyProfessor, sent without cookies; everything else is stored locally in your browser. See [PRIVACY.md](PRIVACY.md) for the full accounting, including what is stored and how to clear it.

## License

[MIT](LICENSE).
