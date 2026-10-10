# Verdct

Verdct is a Chrome extension that shows RateMyProfessor ratings right inside ASU Class Search.

## What it does

- **Rating badges** next to each professor. Green is good, amber is okay, red is low. Grey means there are too few reviews to trust, or no match was found.
- **Hover a badge** to see rating, difficulty, would-take-again, and review count. Click it to open the professor's RateMyProfessor page.
- **Best section labels** mark the best sections of each course: "Best rated" (highest rating) and "Best overall" (good rating, not too hard).
- **Trend arrows** (▲ ▼) show if a professor's recent reviews are better or worse than older ones.
- **Favorites** let you save professors to a shortlist.
- **Schedule builder**: click **+ Plan** on a class to add it to a weekly calendar in the popup. Classes that overlap turn red. **Copy class #s** puts every class number on your clipboard, ready to paste into registration, or click one number to copy just that one.
- **Recitations and labs**: a class that needs a recitation or lab can only be planned with one. **+ Plan** on the lecture lists the ones ASU allows with it, with times, open seats and overlaps, and saves them together. Removing the lecture removes them too.
- **Popup** with a rating vs. difficulty chart, your favorites, your schedule, and settings (theme, colors, cache).

## Install

Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/verdct/gobbgdoekbingholbokfkhfnfbaojfbj).

## Privacy

No server, no tracking, no account. It sends professor names to RateMyProfessor, and when you plan a class, that class number to ASU's own class search API to find its recitation and lab. Everything else stays in your browser. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
