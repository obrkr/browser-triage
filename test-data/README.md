# Test data

Synthetic browser artifacts for exercising Browser Triage end to end — one folder per browser,
using the real file names/schemas described in the main README's
["Where to find the source files"](../README.md#where-to-find-the-source-files) table.
None of this is real browsing data; every URL, domain, and file path is fabricated.

```
test-data/
├── chrome/
│   ├── History          Chromium history + downloads (sqlite)
│   └── Bookmarks         Chromium bookmarks (JSON, not sqlite)
├── firefox/
│   └── places.sqlite     Firefox history + downloads + bookmarks (sqlite)
└── safari/
    ├── History.db        Safari history (sqlite)
    ├── Downloads.plist    Safari downloads (XML plist)
    └── Bookmarks.plist    Safari bookmarks (XML plist)
```

Load `chrome/History` + `chrome/Bookmarks` together (and likewise the two Safari files) to see
Downloads/Bookmarks join up with the matching History rows in one merged timeline.

## What's deliberately planted

Each file mixes ordinary browsing with a few intentionally suspicious entries so every heuristic,
plus the search-term and bookmark features, has something to catch:

- **Search-engine queries** — Google, Bing, DuckDuckGo, and Startpage searches across all three
  browsers, to exercise the History tab's "Search Term" column.
- **Suspicious TLDs** — `.tk`, `.top` domains (medium severity).
- **IP-literal URL** — a bare `185.220.101.5` address (medium severity).
- **Punycode/IDN domains** — `xn--pple-43d.com`, `xn--80ak6aa92e.com` homograph lookalikes (medium severity).
- **URL shortener** — a `bit.ly` link (low severity).
- **Dangerous/disguised downloads** — `invoice.pdf.exe` (double extension, high severity),
  `setup_updater.ps1`, `icloud_verify_tool.scr` (dangerous extensions, medium severity).
- **A flagged bookmark** — a `.tk`/`.top` URL saved to bookmarks in each browser, so the new
  Bookmarks tab's flag column has something to show too.

Regenerate all six files with `python3` (uses only the standard library — `sqlite3` and `json`):

```bash
python3 test-data/gen_testdata.py
```
