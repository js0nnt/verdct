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
- **Badges** — `src/content/badgeRenderer.ts` injects a Shadow DOM badge after each instructor link: green at or above 4.0, amber 2.5–3.9, red below 2.5, and a quiet dashed outline when no confident match was found. Hovering or focusing a badge opens a popover with the rating, difficulty and would-take-again bars, and the rating count. Popover content is built from DOM nodes rather than `innerHTML`, since professor names come from untrusted page and API text.
- **Sample size is visible** — a rating resting on fewer than 5 reviews keeps its color but is drawn with a dashed border and labelled *provisional* in the popover. A 4.7 from 3 students should not read as confidently as a 4.7 from 150.
- **Lookups** — `src/background/rmpClient.ts` queries RateMyProfessor's GraphQL endpoint scoped to ASU's school ID, with defensive parsing and a minimum interval between requests. `src/background/nameMatcher.ts` reconciles ASU's "Last, First" formatting with RMP's "First Last" and returns an explicit no-match rather than guessing.
- **Caching** — `src/background/cache.ts` stores aggregates in `chrome.storage.local` keyed by normalized name, with a 7-day TTL, a shorter 1-day TTL for no-match results, an LRU cap of 500 entries, and serialized writes. Identical in-flight lookups share one request, so a page listing the same professor eight times costs one fetch.
- **Graceful degradation** — network failures, schema changes, corrupt cache records, and missing matches all fall back to a neutral gray badge. Nothing throws into ASU's page.

## Phase 2 (shipped)

- **Best-section highlight** — `src/content/bestSection.ts` groups rows by course and marks the section(s) taught by the highest-rated professor with a green accent and a "Best rated" label. Winning takes stronger evidence than a badge does: only high-confidence name matches with at least 5 ratings are eligible, so a 4.7 from 3 students never outranks a 4.5 from 200. A course showing only one rated professor is left unmarked, since there is no choice to make. Ties all win rather than picking arbitrarily.

- **Popup settings** — cache TTL, plus the green and yellow thresholds on live sliders that preview the real badge styling. Changes restyle open Class Search tabs immediately via `chrome.storage.onChanged`. Stored settings are user-editable and survive upgrades, so every field is re-validated on read; the two thresholds are bounded by each other so the yellow band can never invert. Also shows the cached-professor count and a clear-cache button.

- **Quality-vs-difficulty scatter** — `src/content/scatterWidget.ts` plots every rated professor teaching a course on rating against difficulty, with dot size reflecting how many reviews back each point and the corners captioned so the axes need no decoding. Point labels fall back from above to below a dot and are dropped rather than printed over a neighbour; the hover tooltip still names every point. Appears once a course has at least three rated professors, with course pills when a result set spans several.

- **Rating trend** — `src/background/trend.ts` compares the recent half of a professor's reviews against the older half and shows ▲ or ▼ on the badge. RMP does expose per-review dates, so this is real rather than best-effort, but it is deliberately conservative: it needs at least 12 usable reviews, looks at the 20 most recent, and requires a half-point gap before calling a direction. "Steady" gets no arrow, since most professors are steady and an arrow on every badge would be noise. The reviews are re-sorted by date rather than trusting RMP's ordering, so a change in their default order cannot silently invert every arrow.

- **Favorites** — the popover carries a save toggle, and the popup lists shortlisted professors joined to their cached ratings. Saving in one place updates open Class Search tabs through `chrome.storage.onChanged`. Adding this required making the popover interactive rather than a pure hover tooltip: it now stays open while the pointer is inside it, with a short close delay so moving from badge to panel does not dismiss it.

Only aggregate numbers are stored. No review text, reviewer data, or browsing activity is collected or transmitted.

## Verification

| Command | What it proves |
| --- | --- |
| `npm test` | 133 unit tests across the scanner, matcher, RMP parser, cache, and badge renderer. |
| `npm run typecheck` | Strict TypeScript across all entry points. |
| `npm run validate:chrome` | Loads the built extension in a disposable headless Chrome profile: the service worker starts, the popup renders without errors, a live RMP lookup succeeds, and a repeat lookup in ASU's `"Last, First"` format is served from cache without a second fetch, the settings controls render, and a saved favorite is listed with the rating joined from cache. Set `VERDCT_SCREENSHOT=<path>` to capture the popup for design review. |
| `npm run validate:asu` | Drives the live ASU Class Search and asserts every result row receives a badge that resolves out of its loading state, including a dynamically inserted row. |
| `npm run preview:badges` | Opens a design harness at `localhost:5199` rendering the real badge module against mock ASU rows in every state — rated, provisional, unmatched, loading, failed. Use it to iterate on badge styling without a live search. |
| `npm run inspect:rmp` | Reproduces the first-party GraphQL request inspection used to maintain the RMP client when its undocumented schema changes. |

Set `CHROME_PATH` when Chrome is installed outside its default Windows location. `validate:asu` defaults to Fall 2026 MAT 243; set `ASU_TEST_URL` to target a different current result page.

Latest `validate:asu` run: 17 of 17 rows badged, 0 unresolved, 7 trend arrows, 1 best section highlighted, 9 professors offered for comparison, 0 page errors.

## Known constraints

- **Both upstreams are undocumented and unstable.** ASU's selectors live only in `domScanner.ts`; RMP's query and response parsing live only in `rmpClient.ts`. Either can be repaired without touching the rest of the codebase.
- **The scatter opens from a floating launcher, not a course header.** The spec asked for a course header, but ASU's results are a flat list of sections with no per-course header element to attach to. The launcher is discoverable regardless of markup and still handles multi-course result sets.
- **A trend costs a second request.** Individual reviews are not in the search response, so a confident match with at least 12 reviews triggers one extra throttled query. Thinly-rated professors and no-match names still cost a single request, and the result is cached with the rating.
- **ASU's school ID on RMP is hardcoded** (`ASU_RMP_SCHOOL_ID`) rather than re-searched per lookup.
- **Instructors not on RateMyProfessor render gray.** In the reference MAT 243 run, 3 of 17 rows had no confident match. This is deliberate: a low-confidence guess is worse than no answer.

## Not yet built

Phase 3 (sentiment tags, seat alerts, alternate-section recommender)..
