# Browser Triage

A single-page, fully client-side browser forensics tool. Load a browser's history and downloads database directly, and get a normalized, searchable, UTC-first timeline — with automatic flagging of suspicious domains and downloads. Nothing ever leaves your machine.

![Browsing history with suspicious-domain flags](docs/screenshot-history.png)

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Where to find the source files](#where-to-find-the-source-files)
- [Using the tool](#using-the-tool)
- [Suspicious-domain flagging](#suspicious-domain-flagging)
- [How timestamps work](#how-timestamps-work)
- [Screenshots](#screenshots)
- [Privacy & offline operation](#privacy--offline-operation)
- [Known limitations](#known-limitations)
- [Project structure](#project-structure)
- [How it's built](#how-its-built)

---

## Features

- **Multi-browser history parsing** — Chrome, Edge, Brave, Opera (all Chromium `History` files), Firefox (`places.sqlite`), and Safari (`History.db`), auto-detected from the file's schema.
- **Downloads tab** with file name, full target path, source URL, referrer, size, state, MIME type, Chrome's own danger classification, and whether the user actually opened the file afterward (Chromium only).
- **Safari `Downloads.plist` support** — a hand-written binary/XML plist parser, since Safari downloads live in a property list rather than the history SQLite database.
- **UTC-first timestamps**, converted from each browser's native epoch, with a **display timezone selector** (defaults to UTC, supports the full IANA timezone list) that re-renders every timestamp — including custom range inputs and CSV exports — without changing what's stored.
- **Time range filtering** — quick presets (1h / 24h / 7d / 30d) or a custom from/to range in whatever timezone you've selected.
- **Suspicious-domain & indicator flagging** — built-in heuristics plus an optional pasted/uploaded IOC list, matched entirely offline. See [below](#suspicious-domain-flagging).
- **Search, per-file source filtering, sortable columns**, and a "flagged rows only" toggle.
- **Summary tab** with per-file SHA-256 hashes, row counts, and earliest/latest activity — useful for chain-of-custody notes.
- **CSV export** of whatever's currently filtered and visible.
- **Dark theme**, no build step, no dependencies beyond one bundled library.
- **100% offline-capable** — everything, including the SQLite engine, is bundled locally. No file, hash, or URL is ever sent anywhere.

---

## Quick start

This is a static site, but it loads a WebAssembly SQLite engine, and Chromium browsers block WASM loaded from `file://` via CORS. So run a tiny local server rather than double-clicking `index.html`:

```bash
# from inside the Browser-Triage folder
python -m http.server 8000
```

Then open **http://localhost:8000/index.html**.

(Firefox doesn't have the `file://` restriction, so double-clicking `index.html` works there directly — but a local server is the reliable option across all browsers.)

No installation, no accounts, no internet connection required after the initial download of this folder.

---

## Where to find the source files

History and download data live in different files per browser/OS. The browser usually needs to be **closed** first (or the file copied elsewhere) since it's locked while running.

| Browser | Platform | File to load |
|---|---|---|
| Chrome | Windows | `%LocalAppData%\Google\Chrome\User Data\Default\History` |
| Chrome | macOS | `~/Library/Application Support/Google/Chrome/Default/History` |
| Chrome | Linux | `~/.config/google-chrome/Default/History` |
| Edge | Windows | `%LocalAppData%\Microsoft\Edge\User Data\Default\History` |
| Brave | Windows | `%LocalAppData%\BraveSoftware\Brave-Browser\User Data\Default\History` |
| Firefox | Windows | `%AppData%\Mozilla\Firefox\Profiles\<profile>\places.sqlite` |
| Firefox | macOS | `~/Library/Application Support/Firefox/Profiles/<profile>/places.sqlite` |
| Firefox | Linux | `~/.mozilla/firefox/<profile>/places.sqlite` |
| Safari (history) | macOS | `~/Library/Safari/History.db` |
| Safari (downloads) | macOS | `~/Library/Safari/Downloads.plist` |

Each Chromium `History` file already contains **both** browsing history and downloads — one file gets you both tabs. Safari is split across two separate files; load both if you want full coverage.

---

## Using the tool

1. **Load files** — drag and drop, or click "Choose file(s)". You can load several profiles/browsers at once; they merge into one timeline, each row tagged with its source file and browser.
2. **Pick a display timezone** — defaults to UTC (recommended for reporting). Switching it re-renders every timestamp on screen and in CSV exports; the underlying data is always stored as UTC, so switching back and forth never loses precision.
3. **Filter by time** — use a quick preset or "Custom range…" to set an exact from/to window in the currently selected timezone.
4. **Search** — the filter box matches title/URL for history, and file name/path/URL for downloads.
5. **Narrow by source file** if you've loaded multiple profiles and want to isolate one.
6. **Sort** any table by clicking its column header.
7. **Check the Summary tab** for per-file SHA-256 hashes and the overall earliest/latest activity — handy for a report or chain-of-custody note.
8. **Export CSV** to save whatever's currently filtered and visible on the active tab.

---

## Suspicious-domain flagging

A "Flags" column appears on both History and Downloads, populated by three layers that all run **entirely locally**:

**Built-in heuristics** (always on, no setup):
- Suspicious/high-abuse TLDs (`.tk`, `.xyz`, `.top`, `.icu`, `.zip`, etc.)
- IP-literal URLs (no domain name at all)
- Punycode/IDN domains (possible homograph spoofing, e.g. a lookalike of a real brand)
- URL shorteners (destination hidden)
- Dangerous download file types (`.exe`, `.scr`, `.ps1`, `.hta`, `.lnk`, …)
- Disguised double extensions (`invoice.pdf.exe`, `photo.jpg.scr`)

**Optional indicator (IOC) list** — expand "Flag suspicious domains & keywords" above the toolbar. In the **Domains / IPs** box, paste or upload a list of known-bad domains/IPs from whatever threat-intel source you're using for the case (one per line; full URLs, `www.`, and `#` comments are all handled). Matching is suffix-aware — an indicator for `evil.com` also catches `sub.evil.com`, but never partial lookalikes like `notevil.com`.

**Optional keyword list** — the second box, **Keywords**, does free-text substring matching against page titles, URLs, and download filenames/paths (e.g. `wire transfer`, `confidential`, a case-specific project codename). This is deliberately separate from the domain list: keyword matching is far noisier (a keyword like "invoice" will hit legitimately all the time), so keyword hits render in a distinct blue badge rather than being conflated with a real domain/IOC reputation hit.

Both lists are matched against already-loaded data in your browser; neither is ever transmitted anywhere.

Flags are color-coded by severity/type — **red** = IOC domain/IP match, **amber** = medium-confidence built-in heuristic, **grey** = low-confidence/informational heuristic, **blue** = keyword match — and stack, so a single row can carry several at once. Use the "Flagged rows only" toggle to filter down to just what's been flagged, and check the Summary tab for flagged-row counts.

**These are leads, not verdicts.** A `.tk` domain, a URL shortener, or a keyword hit isn't automatically malicious, and this tool has no live reputation lookups — sending a case's visited domains to a third-party API mid-investigation is an OPSEC problem the design deliberately avoids. Treat flags as a fast way to triage a large timeline, not as ground truth.

---

## How timestamps work

Each browser stores time in a different native epoch. Everything is converted to milliseconds since the Unix epoch (UTC) on load, then rendered in whichever display timezone is selected:

| Browser | Native format |
|---|---|
| Chrome / Edge / Brave / Opera | Microseconds since 1601-01-01 00:00:00 UTC (WebKit/Chrome time) |
| Firefox | Microseconds since 1970-01-01 00:00:00 UTC |
| Safari | Seconds since 2001-01-01 00:00:00 UTC (Core Data / Mac absolute time) |

Rendered timestamps always show their UTC offset explicitly (e.g. `2026-08-01 08:15:00 UTC-4`), so there's never ambiguity about which timezone you're looking at.

---

## Screenshots

**Downloads, with file state, danger classification, and source/referrer URLs:**

![Downloads tab](docs/screenshot-downloads.png)

---

## Privacy & offline operation

- All parsing — SQLite (via a locally bundled WebAssembly build of SQLite), the custom plist parser, timestamp conversion, and indicator matching — happens in your browser tab.
- No network requests are made once the page and its bundled `vendor/sql-wasm.wasm` are loaded — you can disconnect from the internet entirely and it keeps working.
- No file, hash, URL, or indicator you load or paste is ever transmitted anywhere. There is no backend.
- Per-file SHA-256 hashes are computed client-side for reference (e.g. for a chain-of-custody note), not sent anywhere.

---

## Known limitations

- **Firefox downloads** are read from the `moz_annotations` scheme Firefox has used since ~v26. Very old or unusual profiles may not have this data; the tool will say so rather than fail silently.
- **Safari downloads** require the separate `Downloads.plist` file — `History.db` alone only yields browsing history. Key names in `Downloads.plist` have shifted slightly across macOS/Safari versions; the parser checks the common variants but an unusual version may yield partial fields.
- **Locked database files**: if the source browser is still running, its history file may be locked by the OS and fail to load. Close the browser (or work from a copy) first.
- Tables render up to 5,000 rows at a time for performance; filtering and sorting still operate over the full loaded dataset, so narrow your search/time range to see more of a very large history.
- Heuristic flags are intentionally simple, local, pattern-based checks — not a substitute for actual threat intelligence or reputation services.

---

## Project structure

```
Browser-Triage/
├── index.html          Page structure & UI
├── style.css            Dark theme
├── app.js                All parsing, heuristics, filtering, and rendering logic
├── vendor/
│   ├── sql-wasm.js       sql.js (SQLite compiled to WebAssembly)
│   └── sql-wasm.wasm
└── docs/                  Screenshots used in this README
```

## How it's built

- **[sql.js](https://sql.js.org/)** (SQLite compiled to WebAssembly) is bundled locally in `vendor/` so the tool works fully offline — no CDN dependency.
- The **binary and XML plist parser** for Safari's `Downloads.plist` is hand-written from the Apple bplist format spec — no external plist library exists for the browser, so this was implemented from scratch in `app.js`.
- No framework, no build step, no package manager. Three files (`index.html`, `style.css`, `app.js`) plus one bundled dependency.
