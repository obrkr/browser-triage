#!/usr/bin/env python3
"""Generates synthetic browser history/downloads/bookmarks test files for Browser Triage.
Covers Chrome (Chromium), Firefox, and Safari — history, downloads, and bookmarks —
with a mix of benign and deliberately-flaggable content (bad TLD, IP-literal URL,
punycode domain, URL shortener, dangerous/double-extension downloads, search-engine
queries) so every heuristic and the new search-term/bookmarks features can be
exercised end to end.
"""
import sqlite3
import os
import json
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))

# Reference "now" for the synthetic case: 2026-08-09 12:00:00 UTC, spread over the prior week.
NOW = datetime(2026, 8, 9, 12, 0, 0, tzinfo=timezone.utc)

def t(days_ago=0, hours_ago=0, minutes_ago=0):
    return NOW - timedelta(days=days_ago, hours=hours_ago, minutes=minutes_ago)

def chrome_micros(dt):
    epoch_1601 = datetime(1601, 1, 1, tzinfo=timezone.utc)
    return int((dt - epoch_1601).total_seconds() * 1_000_000)

def firefox_micros(dt):
    epoch_1970 = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return int((dt - epoch_1970).total_seconds() * 1_000_000)

def safari_seconds(dt):
    epoch_2001 = datetime(2001, 1, 1, tzinfo=timezone.utc)
    return (dt - epoch_2001).total_seconds()

def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')

# ---------------------------------------------------------------------
# Chrome: History (sqlite) — urls, visits, downloads, downloads_url_chains
# ---------------------------------------------------------------------
def build_chrome_history():
    path = os.path.join(BASE, 'chrome', 'History')
    if os.path.exists(path):
        os.remove(path)
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE urls(
        id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
        visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)''')
    cur.execute('''CREATE TABLE visits(
        id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, from_visit INTEGER,
        transition INTEGER, segment_id INTEGER, visit_duration INTEGER)''')
    cur.execute('''CREATE TABLE downloads(
        id INTEGER PRIMARY KEY, guid VARCHAR, current_path LONGVARCHAR, target_path LONGVARCHAR,
        start_time INTEGER, received_bytes INTEGER, total_bytes INTEGER, state INTEGER,
        danger_type INTEGER, interrupt_reason INTEGER, end_time INTEGER, opened INTEGER,
        last_access_time INTEGER, referrer VARCHAR, site_url VARCHAR, tab_url VARCHAR,
        mime_type VARCHAR, original_mime_type VARCHAR)''')
    cur.execute('''CREATE TABLE downloads_url_chains(
        id INTEGER, chain_index INTEGER, url LONGVARCHAR)''')

    urls = [
        # (id, url, title, visit_count)
        (1, 'https://www.google.com/search?q=how+to+wipe+a+hard+drive', 'how to wipe a hard drive - Google Search', 2),
        (2, 'https://support.example.com/articles/disk-cleanup', 'Disk Cleanup Guide', 1),
        (3, 'https://mail.example.com/inbox', 'Inbox — Example Mail', 5),
        (4, 'http://185.220.101.5/panel/login.php', 'Login', 1),
        (5, 'https://free-invoice-tool.tk/download', 'Free Invoice Tool', 1),
        (6, 'https://bit.ly/3xAmpleShortlink', '', 1),
        (7, 'https://xn--pple-43d.com/reset-password', 'Account Security', 1),
        (8, 'https://en.wikipedia.org/wiki/Disk_formatting', 'Disk formatting - Wikipedia', 1),
        (9, 'https://www.bing.com/search?q=confidential+merger+documents', 'confidential merger documents - Bing', 1),
        (10, 'https://news.ycombinator.com/', 'Hacker News', 3),
    ]
    cur.executemany('INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, 0, 0, 0)', urls)

    # visits: build a navigation chain for url 1 -> url 2 (search result -> clicked link)
    visits = [
        (1, 1, chrome_micros(t(days_ago=6, hours_ago=2)), 0, 1),   # typed search
        (2, 2, chrome_micros(t(days_ago=6, hours_ago=1, minutes_ago=58)), 1, 0),  # link from search
        (3, 3, chrome_micros(t(days_ago=5, hours_ago=9)), 0, 1),
        (4, 4, chrome_micros(t(days_ago=4, hours_ago=22)), 0, 0),
        (5, 5, chrome_micros(t(days_ago=4, hours_ago=21, minutes_ago=50)), 0, 5),  # generated (redirect-ish)
        (6, 6, chrome_micros(t(days_ago=3, hours_ago=14)), 0, 0),
        (7, 7, chrome_micros(t(days_ago=3, hours_ago=13, minutes_ago=40)), 0, 1),
        (8, 8, chrome_micros(t(days_ago=2, hours_ago=10)), 0, 0),
        (9, 9, chrome_micros(t(days_ago=1, hours_ago=8)), 0, 1),
        (10, 10, chrome_micros(t(hours_ago=6)), 0, 0),
        (11, 10, chrome_micros(t(hours_ago=1)), 0, 8),
    ]
    cur.executemany('INSERT INTO visits (id, url, visit_time, from_visit, transition) VALUES (?, ?, ?, ?, ?)', visits)

    downloads = [
        # id, current_path, target_path, start_time, received, total, state(1=complete), danger(0=safe,6=validated), end_time, opened, last_access, referrer, tab_url, mime, final_url
        (1, '/Users/analyst/Downloads/quarterly-report.pdf', '/Users/analyst/Downloads/quarterly-report.pdf',
         chrome_micros(t(days_ago=5, hours_ago=9, minutes_ago=1)), 245678, 245678, 1, 0,
         chrome_micros(t(days_ago=5, hours_ago=8, minutes_ago=59)), 1, chrome_micros(t(days_ago=5, hours_ago=8, minutes_ago=50)),
         'https://mail.example.com/inbox', 'https://mail.example.com/attachments/quarterly-report.pdf',
         'application/pdf', 'https://mail.example.com/attachments/quarterly-report.pdf'),
        (2, '/Users/analyst/Downloads/invoice.pdf.exe', '/Users/analyst/Downloads/invoice.pdf.exe',
         chrome_micros(t(days_ago=4, hours_ago=21, minutes_ago=49)), 88213, 88213, 1, 5,
         chrome_micros(t(days_ago=4, hours_ago=21, minutes_ago=47)), 1, chrome_micros(t(days_ago=4, hours_ago=21, minutes_ago=40)),
         'https://free-invoice-tool.tk/download', 'https://free-invoice-tool.tk/files/invoice.pdf.exe',
         'application/x-msdownload', 'https://free-invoice-tool.tk/files/invoice.pdf.exe'),
        (3, '/Users/analyst/Downloads/setup_updater.ps1', '/Users/analyst/Downloads/setup_updater.ps1',
         chrome_micros(t(days_ago=3, hours_ago=13, minutes_ago=39)), 4096, 4096, 1, 6,
         chrome_micros(t(days_ago=3, hours_ago=13, minutes_ago=38)), 0, None,
         'https://xn--pple-43d.com/reset-password', 'https://xn--pple-43d.com/tools/setup_updater.ps1',
         'text/plain', 'https://xn--pple-43d.com/tools/setup_updater.ps1'),
        (4, '/Users/analyst/Downloads/vacation-photos.zip', '/Users/analyst/Downloads/vacation-photos.zip',
         chrome_micros(t(days_ago=2, hours_ago=10, minutes_ago=5)), 15728640, 15728640, 1, 0,
         chrome_micros(t(days_ago=2, hours_ago=9, minutes_ago=58)), 0, None,
         'https://en.wikipedia.org/wiki/Disk_formatting', 'https://cdn.example.com/files/vacation-photos.zip',
         'application/zip', 'https://cdn.example.com/files/vacation-photos.zip'),
        (5, '/Users/analyst/Downloads/budget.xlsx', '/Users/analyst/Downloads/budget.xlsx',
         chrome_micros(t(hours_ago=5, minutes_ago=30)), 51200, 51200, 3, 0,
         None, 0, None,
         'https://mail.example.com/inbox', 'https://mail.example.com/attachments/budget.xlsx',
         'application/vnd.ms-excel', 'https://mail.example.com/attachments/budget.xlsx'),
    ]
    cur.executemany('''INSERT INTO downloads
        (id, current_path, target_path, start_time, received_bytes, total_bytes, state, danger_type,
         end_time, opened, last_access_time, referrer, tab_url, mime_type, guid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        [(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8], d[9], d[10], d[11], d[12], d[13], f'guid-{d[0]}') for d in downloads])

    chains = []
    for d in downloads:
        chains.append((d[0], 0, d[14]))
    cur.executemany('INSERT INTO downloads_url_chains (id, chain_index, url) VALUES (?, ?, ?)', chains)

    conn.commit()
    conn.close()
    print(f'wrote {path}')

# ---------------------------------------------------------------------
# Chrome: Bookmarks (JSON, not sqlite)
# ---------------------------------------------------------------------
def build_chrome_bookmarks():
    path = os.path.join(BASE, 'chrome', 'Bookmarks')
    data = {
        'checksum': 'testchecksum',
        'version': 1,
        'roots': {
            'bookmark_bar': {
                'id': '1', 'name': 'Bookmarks bar', 'type': 'folder',
                'date_added': str(chrome_micros(t(days_ago=30))),
                'children': [
                    {'id': '2', 'name': 'Work', 'type': 'folder', 'date_added': str(chrome_micros(t(days_ago=29))),
                     'children': [
                         {'id': '3', 'name': 'Example Mail', 'type': 'url', 'url': 'https://mail.example.com/inbox',
                          'date_added': str(chrome_micros(t(days_ago=28)))},
                         {'id': '4', 'name': 'Quarterly Reports', 'type': 'url', 'url': 'https://support.example.com/articles/disk-cleanup',
                          'date_added': str(chrome_micros(t(days_ago=20)))},
                     ]},
                    {'id': '5', 'name': 'Free Invoice Tool (unverified)', 'type': 'url', 'url': 'https://free-invoice-tool.tk/download',
                     'date_added': str(chrome_micros(t(days_ago=4, hours_ago=21)))},
                ],
            },
            'other': {
                'id': '6', 'name': 'Other bookmarks', 'type': 'folder',
                'date_added': str(chrome_micros(t(days_ago=30))),
                'children': [
                    {'id': '7', 'name': 'Hacker News', 'type': 'url', 'url': 'https://news.ycombinator.com/',
                     'date_added': str(chrome_micros(t(days_ago=10)))},
                    {'id': '8', 'name': 'Wikipedia: Disk formatting', 'type': 'url', 'url': 'https://en.wikipedia.org/wiki/Disk_formatting',
                     'date_added': str(chrome_micros(t(days_ago=2)))},
                ],
            },
            'synced': {
                'id': '9', 'name': 'Mobile bookmarks', 'type': 'folder',
                'date_added': str(chrome_micros(t(days_ago=30))),
                'children': [],
            },
        },
    }
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'wrote {path}')

# ---------------------------------------------------------------------
# Firefox: places.sqlite — moz_places, moz_historyvisits, moz_bookmarks,
# moz_annotations (+moz_anno_attributes) for downloads
# ---------------------------------------------------------------------
def build_firefox_places():
    path = os.path.join(BASE, 'firefox', 'places.sqlite')
    if os.path.exists(path):
        os.remove(path)
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE moz_places(
        id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER, last_visit_date INTEGER)''')
    cur.execute('''CREATE TABLE moz_historyvisits(
        id INTEGER PRIMARY KEY, from_visit INTEGER, place_id INTEGER, visit_date INTEGER, visit_type INTEGER)''')
    cur.execute('''CREATE TABLE moz_bookmarks(
        id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title LONGVARCHAR, dateAdded INTEGER, lastModified INTEGER)''')
    cur.execute('''CREATE TABLE moz_anno_attributes(id INTEGER PRIMARY KEY, name VARCHAR)''')
    cur.execute('''CREATE TABLE moz_annotations(
        id INTEGER PRIMARY KEY, place_id INTEGER, anno_attribute_id INTEGER, content LONGVARCHAR)''')

    places = [
        (1, 'https://duckduckgo.com/?q=secure+file+deletion+tools', 'secure file deletion tools at DuckDuckGo', 1),
        (2, 'https://addons.mozilla.org/en-US/firefox/', 'Firefox Add-ons', 2),
        (3, 'ftp://185.199.108.153/pub/release-notes.txt', '', 1),
        (4, 'https://totally-legit-updates.top/patch.exe', 'Critical Update', 1),
        (5, 'https://www.startpage.com/sp/search?query=offshore+account+setup', 'offshore account setup - Startpage', 1),
        (6, 'https://developer.mozilla.org/en-US/docs/Web/API', 'Web APIs | MDN', 4),
    ]
    cur.executemany('INSERT INTO moz_places (id, url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?, ?)',
                     [(p[0], p[1], p[2], p[3], firefox_micros(t(days_ago=6))) for p in places])

    visits = [
        (1, 0, 1, firefox_micros(t(days_ago=6, hours_ago=5)), 1),
        (2, 0, 2, firefox_micros(t(days_ago=5, hours_ago=16)), 1),
        (3, 0, 3, firefox_micros(t(days_ago=4, hours_ago=3)), 1),
        (4, 0, 4, firefox_micros(t(days_ago=3, hours_ago=20)), 7),  # 'download' transition
        (5, 0, 5, firefox_micros(t(days_ago=2, hours_ago=12)), 1),
        (6, 5, 6, firefox_micros(t(days_ago=2, hours_ago=11, minutes_ago=55)), 1),  # follow-on from the search
    ]
    cur.executemany('INSERT INTO moz_historyvisits (id, from_visit, place_id, visit_date, visit_type) VALUES (?, ?, ?, ?, ?)', visits)

    # Bookmarks: root folders (2=toolbar, typically ids 2-6 are Firefox's fixed roots; we keep it simple)
    bookmarks = [
        (100, 2, None, 0, 'Bookmarks Toolbar', firefox_micros(t(days_ago=30)), firefox_micros(t(days_ago=30))),
        (101, 2, None, 100, 'Dev', firefox_micros(t(days_ago=25)), firefox_micros(t(days_ago=25))),
        (102, 1, 6, 101, 'MDN Web APIs', firefox_micros(t(days_ago=25)), firefox_micros(t(days_ago=25))),
        (103, 1, 2, 100, 'Firefox Add-ons', firefox_micros(t(days_ago=18)), firefox_micros(t(days_ago=18))),
        (104, 1, 4, 100, 'Critical Update (suspicious)', firefox_micros(t(days_ago=3, hours_ago=20)), firefox_micros(t(days_ago=3, hours_ago=20))),
    ]
    cur.executemany('INSERT INTO moz_bookmarks (id, type, fk, parent, title, dateAdded, lastModified) VALUES (?, ?, ?, ?, ?, ?, ?)', bookmarks)

    cur.execute("INSERT INTO moz_anno_attributes (id, name) VALUES (1, 'downloads/destinationFileURI')")
    cur.execute("INSERT INTO moz_anno_attributes (id, name) VALUES (2, 'downloads/metaData')")
    cur.execute('''INSERT INTO moz_annotations (place_id, anno_attribute_id, content) VALUES
        (4, 1, 'file:///Users/analyst/Downloads/patch.exe')''')
    meta = json.dumps({'state': 1, 'endTime': firefox_micros(t(days_ago=3, hours_ago=19, minutes_ago=58)), 'fileSize': 733184})
    cur.execute('INSERT INTO moz_annotations (place_id, anno_attribute_id, content) VALUES (4, 2, ?)', (meta,))

    conn.commit()
    conn.close()
    print(f'wrote {path}')

# ---------------------------------------------------------------------
# Safari: History.db — history_items, history_visits
# ---------------------------------------------------------------------
def build_safari_history():
    path = os.path.join(BASE, 'safari', 'History.db')
    if os.path.exists(path):
        os.remove(path)
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute('CREATE TABLE history_items(id INTEGER PRIMARY KEY, url LONGVARCHAR, visit_count INTEGER)')
    cur.execute('CREATE TABLE history_visits(id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title LONGVARCHAR)')

    items = [
        (1, 'https://www.apple.com/mac/', 3),
        (2, 'https://www.google.com/search?q=recover+deleted+photos+iphone', 1),
        (3, 'http://phishing-kit.tk/verify-icloud', 1),
        (4, 'https://news.ycombinator.com/', 2),
        (5, 'https://xn--80ak6aa92e.com/login', 1),  # punycode lookalike domain
    ]
    cur.executemany('INSERT INTO history_items (id, url, visit_count) VALUES (?, ?, ?)', items)

    visits = [
        (1, 1, safari_seconds(t(days_ago=5, hours_ago=4)), 'Mac - Apple'),
        (2, 2, safari_seconds(t(days_ago=4, hours_ago=15)), 'recover deleted photos iphone - Google Search'),
        (3, 3, safari_seconds(t(days_ago=4, hours_ago=14, minutes_ago=50)), 'Verify Your iCloud Account'),
        (4, 4, safari_seconds(t(days_ago=2, hours_ago=8)), 'Hacker News'),
        (5, 4, safari_seconds(t(hours_ago=3)), 'Hacker News'),
        (6, 5, safari_seconds(t(days_ago=1, hours_ago=6)), 'Sign In'),
    ]
    cur.executemany('INSERT INTO history_visits (id, history_item, visit_time, title) VALUES (?, ?, ?, ?)', visits)

    conn.commit()
    conn.close()
    print(f'wrote {path}')

# ---------------------------------------------------------------------
# Safari: Downloads.plist (XML plist)
# ---------------------------------------------------------------------
def xml_escape(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))

def build_safari_downloads_plist():
    path = os.path.join(BASE, 'safari', 'Downloads.plist')
    entries = [
        dict(url='https://www.apple.com/downloads/macos-update.pkg', path='/Users/analyst/Downloads/macos-update.pkg',
             origin='https://www.apple.com/mac/', added=t(days_ago=5, hours_ago=4, minutes_ago=1), finished=t(days_ago=5, hours_ago=3, minutes_ago=58),
             so_far=482344960, total=482344960),
        dict(url='http://phishing-kit.tk/files/icloud_verify_tool.scr', path='/Users/analyst/Downloads/icloud_verify_tool.scr',
             origin='http://phishing-kit.tk/verify-icloud', added=t(days_ago=4, hours_ago=14, minutes_ago=49), finished=t(days_ago=4, hours_ago=14, minutes_ago=47),
             so_far=61440, total=61440),
        dict(url='https://xn--80ak6aa92e.com/tools/session_helper.dmg', path='/Users/analyst/Downloads/session_helper.dmg',
             origin='https://xn--80ak6aa92e.com/login', added=t(days_ago=1, hours_ago=6, minutes_ago=1), finished=None,
             so_far=1024000, total=8388608),
    ]
    items_xml = []
    for e in entries:
        finished_xml = f"<key>DownloadEntryDateFinishedKey</key><date>{iso(e['finished'])}</date>" if e['finished'] else ''
        items_xml.append(f'''\t\t<dict>
\t\t\t<key>DownloadEntryURL</key>
\t\t\t<string>{xml_escape(e['url'])}</string>
\t\t\t<key>DownloadEntryPath</key>
\t\t\t<string>{xml_escape(e['path'])}</string>
\t\t\t<key>DownloadEntryOriginURL</key>
\t\t\t<string>{xml_escape(e['origin'])}</string>
\t\t\t<key>DownloadEntryDateAddedKey</key>
\t\t\t<date>{iso(e['added'])}</date>
\t\t\t{finished_xml}
\t\t\t<key>DownloadEntryProgressBytesSoFar</key>
\t\t\t<integer>{e['so_far']}</integer>
\t\t\t<key>DownloadEntryProgressTotalToLoad</key>
\t\t\t<integer>{e['total']}</integer>
\t\t</dict>''')
    plist = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>DownloadHistory</key>
\t<array>
{chr(10).join(items_xml)}
\t</array>
</dict>
</plist>
'''
    with open(path, 'w') as f:
        f.write(plist)
    print(f'wrote {path}')

# ---------------------------------------------------------------------
# Safari: Bookmarks.plist (XML plist) — folder tree with WebBookmarkType leaves
# ---------------------------------------------------------------------
def build_safari_bookmarks_plist():
    path = os.path.join(BASE, 'safari', 'Bookmarks.plist')
    plist = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Title</key>
\t<string>com.apple.ReadingList</string>
\t<key>WebBookmarkType</key>
\t<string>WebBookmarkTypeList</string>
\t<key>Children</key>
\t<array>
\t\t<dict>
\t\t\t<key>Title</key>
\t\t\t<string>BookmarksBar</string>
\t\t\t<key>WebBookmarkType</key>
\t\t\t<string>WebBookmarkTypeList</string>
\t\t\t<key>Children</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>Title</key>
\t\t\t\t\t<string>Work</string>
\t\t\t\t\t<key>WebBookmarkType</key>
\t\t\t\t\t<string>WebBookmarkTypeList</string>
\t\t\t\t\t<key>Children</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<dict>
\t\t\t\t\t\t\t<key>URLString</key>
\t\t\t\t\t\t\t<string>https://www.apple.com/mac/</string>
\t\t\t\t\t\t\t<key>WebBookmarkType</key>
\t\t\t\t\t\t\t<string>WebBookmarkTypeLeaf</string>
\t\t\t\t\t\t\t<key>URIDictionary</key>
\t\t\t\t\t\t\t<dict>
\t\t\t\t\t\t\t\t<key>title</key>
\t\t\t\t\t\t\t\t<string>Mac - Apple</string>
\t\t\t\t\t\t\t</dict>
\t\t\t\t\t\t</dict>
\t\t\t\t\t\t<dict>
\t\t\t\t\t\t\t<key>URLString</key>
\t\t\t\t\t\t\t<string>http://phishing-kit.tk/verify-icloud</string>
\t\t\t\t\t\t\t<key>WebBookmarkType</key>
\t\t\t\t\t\t\t<string>WebBookmarkTypeLeaf</string>
\t\t\t\t\t\t\t<key>URIDictionary</key>
\t\t\t\t\t\t\t<dict>
\t\t\t\t\t\t\t\t<key>title</key>
\t\t\t\t\t\t\t\t<string>Verify Your iCloud Account (saved by mistake)</string>
\t\t\t\t\t\t\t</dict>
\t\t\t\t\t\t</dict>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<dict>
\t\t\t\t\t<key>URLString</key>
\t\t\t\t\t<string>https://news.ycombinator.com/</string>
\t\t\t\t\t<key>WebBookmarkType</key>
\t\t\t\t\t<string>WebBookmarkTypeLeaf</string>
\t\t\t\t\t<key>URIDictionary</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>title</key>
\t\t\t\t\t\t<string>Hacker News</string>
\t\t\t\t\t</dict>
\t\t\t\t</dict>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
'''
    with open(path, 'w') as f:
        f.write(plist)
    print(f'wrote {path}')

if __name__ == '__main__':
    os.makedirs(os.path.join(BASE, 'chrome'), exist_ok=True)
    os.makedirs(os.path.join(BASE, 'firefox'), exist_ok=True)
    os.makedirs(os.path.join(BASE, 'safari'), exist_ok=True)
    build_chrome_history()
    build_chrome_bookmarks()
    build_firefox_places()
    build_safari_history()
    build_safari_downloads_plist()
    build_safari_bookmarks_plist()
    print('done')
