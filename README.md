# Verdct

Verdct is a Chrome extension that shows RateMyProfessor ratings right inside ASU Class Search.

## What it does

- **Rating badges** next to each professor. Green is good, amber is okay, red is low. Grey means there are too few reviews to trust, or no match was found.
- **Hover a badge** to see rating, difficulty, would-take-again, and review count. Click it to open the professor's RateMyProfessor page.
- **Best section labels** mark the best sections of each course: "Best rated" (highest rating) and "Best overall" (good rating, not too hard).
- **Trend arrows** (▲ ▼) show if a professor's recent reviews are better or worse than older ones.
- **Favorites** let you save professors to a shortlist.
- **Schedule builder**: click **+ Plan** on a class to add it to a weekly calendar in the popup. Classes that overlap turn amber.
- **Popup** with a rating vs. difficulty chart, your favorites, your schedule, and settings (theme, colors, cache).

## Install

1. Download `verdct-<version>.zip` from [Releases](https://github.com/js0nnt/verdct/releases) and unzip it.
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. Search for classes on [ASU Class Search](https://catalog.apps.asu.edu/catalog/classes).

## Build from source

Needs Node.js 20 or newer.

```bash
npm install
npm run build
```

Then load the `dist/` folder with **Load unpacked**. Run `npm run package` to make a zip.

## Tests

```bash
npm test
```

`npm run typecheck` checks types. `npm run validate:chrome`, `validate:asu`, and `validate:schedule` test the extension in a real Chrome.

## Privacy

No server, no tracking, no account. The only request it sends is a professor name to RateMyProfessor. Everything else stays in your browser. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
