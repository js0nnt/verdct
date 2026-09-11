# Privacy

Verdct is a browser extension that shows RateMyProfessor ratings on ASU Class Search. This document describes exactly what it does with data. It is written to be checkable against the source rather than taken on trust — every claim below points at the code that implements it.

## What Verdct collects about you

Nothing. There is no analytics, no telemetry, no error reporting service, and no account.

Verdct has no server. There is nowhere for your data to be sent, because the developer operates no backend.

## What leaves your browser

One kind of request, to one destination:

- **To `ratemyprofessors.com`** — professor names read from the ASU Class Search page you are viewing, in order to look up their public ratings.

That is the complete list. You can verify it: the manifest grants `host_permissions` for `ratemyprofessors.com` only, so the browser itself will block a request anywhere else.

Requests are sent with `credentials: 'omit'` (`src/background/rmpClient.ts`), so your cookies are **not** sent to RateMyProfessor. Your lookups are not associated with any RateMyProfessor account you may have.

Professor names come from ASU's public class listings. Nothing identifying *you* is included in a request.

## What is stored, and where

Everything is stored locally in your own browser, using `chrome.storage`. None of it is transmitted anywhere.

| Data | Where | Why | Cleared by |
| --- | --- | --- | --- |
| Professor rating aggregates — score, difficulty, would-take-again, rating count, trend | `storage.local` | So a revisited page is instant instead of refetching | "Clear cached ratings" in Settings; also expires after the configured TTL (7 days by default) |
| Favorited professors — name only | `storage.local` | Your shortlist in the popup | Removing them individually in the popup |
| Planned sections — class number, term, course, instructor names, meeting times, location, units, seats | `storage.local` | Your schedule in the popup | "Clear all" in the Schedule tab, or removing them one at a time |
| Your settings — theme, TTL, badge thresholds | `storage.local` | To remember your preferences | Uninstalling |
| Rated professors on the current tab | `storage.session` | To draw the comparison chart | Automatically, when the tab navigates or closes, and when the browser closes |

**No review text is ever stored**, and nothing about the people who wrote reviews. Only aggregate numbers (`src/shared/types.ts`).

A planned section holds only what the ASU results row already displayed publicly. It never leaves your browser: the schedule is read and written by the popup and the content script, and no request carries it anywhere.

Verdct does not read your browsing history, your other tabs, or anything outside ASU Class Search. Its content script is scoped to `catalog.apps.asu.edu/catalog/classes/*`, and it requests only the `storage` permission — not the broad `tabs` permission, which would grant access to every tab's address.

## Permissions, and why each is needed

- **`storage`** — the local caching and settings described above.
- **`host_permissions: ratemyprofessors.com`** — to fetch public ratings.
- **Content script on `catalog.apps.asu.edu/catalog/classes/*`** — to read professor names on the page and draw badges next to them.

There is no `tabs` permission, no `<all_urls>`, and no remote code execution: everything runs from code shipped in the extension.

## Third parties

RateMyProfessor receives the professor-name lookups described above and is subject to its own privacy policy. Verdct sends no data to anyone else.

## Data deletion

Uninstalling the extension removes everything, since all storage is local to the extension. You can also clear cached ratings at any time from the Settings tab.

## A note on the data source

Verdct reads RateMyProfessor's public GraphQL endpoint, which is undocumented and unofficial. It may change or stop working without notice. Verdct does not attempt to bypass any rate limiting or bot detection: requests are capped at four concurrent, spaced at least 120ms apart, and cached aggressively so a professor is fetched at most once per cache window regardless of how often their name appears.

## Changes

Material changes to this document will be noted in the repository's commit history.
