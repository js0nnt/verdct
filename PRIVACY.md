# Privacy

Verdct is a browser extension that shows RateMyProfessor ratings on ASU Class Search. This document describes exactly what it does with data. It is written to be checkable against the source rather than taken on trust — every claim below points at the code that implements it.

## What Verdct collects about you

Nothing. There is no analytics, no telemetry, no error reporting service, and no account.

Verdct has no server. There is nowhere for your data to be sent, because the developer operates no backend.

## What leaves your browser

Two kinds of request, to two destinations:

- **To `ratemyprofessors.com`** — professor names read from the ASU Class Search page you are viewing, in order to look up their public ratings.
- **To ASU's own class search API (`eadvs-cscc-catalog-api.apps.asu.edu`)** — only when you press **+ Plan** (or hover it), the class number, term and course of that section, to find which recitations and labs it must be taken with. This is the same public API, asked the same question, as the Select button on ASU's own page. The results page does not print the pairing, so it cannot be read from the page.

That is the complete list. The RateMyProfessor requests come from the extension's background worker, which the manifest's `host_permissions` limit to `ratemyprofessors.com`. The ASU requests come from the content script running on Class Search; they need no permission because Class Search's own API already accepts requests from that page.

Both are sent with `credentials: 'omit'` (`src/background/rmpClient.ts`, `src/content/asuCatalog.ts`), so your cookies are **not** sent. Your lookups are not associated with any RateMyProfessor account, and not with your ASU sign-in.

Professor names and class numbers come from ASU's public class listings. Nothing identifying *you* is included in a request.

## What is stored, and where

Everything is stored locally in your own browser, using `chrome.storage`. None of it is transmitted anywhere.

| Data | Where | Why | Cleared by |
| --- | --- | --- | --- |
| Professor rating aggregates — score, difficulty, would-take-again, rating count, trend | `storage.local` | So a revisited page is instant instead of refetching | "Clear cached ratings" in Settings; also expires after the configured TTL (7 days by default) |
| Favorited professors — name only | `storage.local` | Your shortlist in the popup | Removing them individually in the popup |
| Planned sections — class number, term, course, instructor names, meeting times, location, units, seats, and which lecture a recitation or lab was planned with | `storage.local` | Your schedule in the popup | "Clear all" in the Schedule tab, or removing them one at a time |
| Your settings — theme, TTL, badge thresholds | `storage.local` | To remember your preferences | Uninstalling |
| Rated professors on the current tab | `storage.session` | To draw the comparison chart | Automatically, when the tab navigates or closes, and when the browser closes |

**No review text is ever stored**, and nothing about the people who wrote reviews. Only aggregate numbers (`src/shared/types.ts`).

A planned section holds only public catalog information about that section. Your schedule never leaves your browser: it is read and written by the popup and the content script, and no request carries it anywhere. The lookup to ASU's catalog sends one class number at a time, never the schedule itself.

Verdct does not read your browsing history, your other tabs, or anything outside ASU Class Search. Its content script is scoped to `catalog.apps.asu.edu/catalog/classes/*`, and it requests only the `storage` permission — not the broad `tabs` permission, which would grant access to every tab's address.

## Permissions, and why each is needed

- **`storage`** — the local caching and settings described above.
- **`host_permissions: ratemyprofessors.com`** — to fetch public ratings.
- **Content script on `catalog.apps.asu.edu/catalog/classes/*`** — to read professor names on the page, draw badges next to them, and ask ASU's class search API which recitations and labs a lecture is paired with.

There is no `tabs` permission, no `<all_urls>`, and no remote code execution: everything runs from code shipped in the extension.

## Third parties

RateMyProfessor receives the professor-name lookups described above and is subject to its own privacy policy. ASU receives the class-number lookups described above, through the same API its Class Search page uses. Verdct sends no data to anyone else.

## Data deletion

Uninstalling the extension removes everything, since all storage is local to the extension. You can also clear cached ratings at any time from the Settings tab.

## A note on the data source

Verdct reads RateMyProfessor's public GraphQL endpoint, which is undocumented and unofficial. It may change or stop working without notice. Verdct does not attempt to bypass any rate limiting or bot detection: requests are capped at four concurrent, spaced at least 120ms apart, and cached aggressively so a professor is fetched at most once per cache window regardless of how often their name appears.

## Changes

Material changes to this document will be noted in the repository's commit history.
