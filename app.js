'use strict';

/* ---------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------- */
const state = {
  files: [],
  history: [],
  downloads: [],
  bookmarks: [],
  filtered: { history: [], downloads: [], bookmarks: [] },
  sort: {
    history: { key: 'visitTime', dir: 'desc' },
    downloads: { key: 'startTime', dir: 'desc' },
    bookmarks: { key: 'dateAdded', dir: 'desc' },
  },
  range: { from: null, to: null },
  displayTz: 'UTC',
  iocSet: new Set(),
  keywordList: [],
  flaggedOnly: false,
  pageSize: 100,
  page: { history: 1, downloads: 1, bookmarks: 1 },
  defangUrls: true,
  visitIndex: new Map(),
};

let SQLPromise = null;
function initSql() {
  if (!SQLPromise) {
    SQLPromise = initSqlJs({ locateFile: (file) => 'vendor/' + file });
  }
  return SQLPromise;
}

/* ---------------------------------------------------------------------
 * Timestamp conversion — everything normalized to ms since Unix epoch (UTC)
 * ------------------------------------------------------------------- */
function chromeTimeToMs(chromeMicros) {
  // WebKit/Chrome time: microseconds since 1601-01-01 00:00:00 UTC
  if (!chromeMicros) return null;
  return Math.round(chromeMicros / 1000) - 11644473600000;
}
function firefoxTimeToMs(ffMicros) {
  // Firefox time: microseconds since 1970-01-01 00:00:00 UTC
  if (!ffMicros) return null;
  return Math.round(ffMicros / 1000);
}
function safariTimeToMs(safariSeconds) {
  // Safari / Core Data time: seconds since 2001-01-01 00:00:00 UTC
  if (safariSeconds === null || safariSeconds === undefined) return null;
  return Math.round((safariSeconds + 978307200) * 1000);
}
/* ---------------------------------------------------------------------
 * Timezone-aware display formatting
 * Storage is always UTC ms; only rendering respects state.displayTz.
 * ------------------------------------------------------------------- */
function getUtcOffsetLabel(date, tz) {
  if (tz === 'UTC') return 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (!tzPart) return 'UTC';
    return tzPart.value.replace('GMT', 'UTC') || 'UTC';
  } catch (e) {
    return tz;
  }
}
function fmtTime(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  const d = new Date(ms);
  const tz = state.displayTz || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    let hour = get('hour');
    if (hour === '24') hour = '00';
    const datePart = `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
    return `${datePart} ${getUtcOffsetLabel(d, tz)}`;
  } catch (e) {
    return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }
}
// Offset (ms) such that localWallClock = utcInstant + offset, for the given IANA zone at approximately utcMs.
function getTzOffsetMs(utcMs, tz) {
  const d = new Date(utcMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const asUtc = Date.UTC(+get('year'), +get('month') - 1, +get('day'), +hour, +get('minute'), +get('second'));
  return asUtc - utcMs;
}
// Interprets a "YYYY-MM-DDTHH:MM:SS" wall-clock string as local time in `tz` and returns UTC ms.
function zonedTimeToUtc(dateTimeLocalStr, tz) {
  if (!dateTimeLocalStr) return null;
  const naiveUtcMs = Date.parse(dateTimeLocalStr + 'Z');
  if (isNaN(naiveUtcMs)) return null;
  return naiveUtcMs - getTzOffsetMs(naiveUtcMs, tz);
}

const COMMON_TZ_FALLBACK = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage',
  'America/Sao_Paulo', 'America/Mexico_City', 'America/Toronto', 'Europe/London', 'Europe/Dublin', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Athens', 'Europe/Moscow', 'Africa/Cairo',
  'Africa/Johannesburg', 'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu',
];
function getTimezoneList() {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      const list = Intl.supportedValuesOf('timeZone');
      if (list && list.length) return list;
    } catch (e) { /* fall through to fallback list */ }
  }
  return COMMON_TZ_FALLBACK;
}
function populateTzSelect() {
  const sel = document.getElementById('tzSelect');
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = getTimezoneList();
  sel.innerHTML = '';

  const optUtc = document.createElement('option');
  optUtc.value = 'UTC';
  optUtc.textContent = 'UTC (recommended for reporting)';
  sel.appendChild(optUtc);

  if (localTz && localTz !== 'UTC') {
    const optLocal = document.createElement('option');
    optLocal.value = localTz;
    optLocal.textContent = `${localTz} (this device's local time)`;
    sel.appendChild(optLocal);
  }

  const group = document.createElement('optgroup');
  group.label = 'All timezones';
  for (const z of zones) {
    if (z === 'UTC' || z === localTz) continue;
    const o = document.createElement('option');
    o.value = z;
    o.textContent = z;
    group.appendChild(o);
  }
  sel.appendChild(group);
  sel.value = 'UTC';
}
function updateTzLabels() {
  const label = state.displayTz;
  document.getElementById('thVisitTime').textContent = `Visit Time (${label})`;
  document.getElementById('thStartTime').textContent = `Start Time (${label})`;
  document.getElementById('thEndTime').textContent = `End Time (${label})`;
  document.getElementById('thLastAccess').textContent = `Last Opened (${label})`;
  document.getElementById('thBookmarkDateAdded').textContent = `Date Added (${label})`;
  document.getElementById('thFilesEarliest').textContent = `Earliest activity (${label})`;
  document.getElementById('thFilesLatest').textContent = `Latest activity (${label})`;
  document.getElementById('quickRangeLabel').textContent = `Time range (${label})`;
  document.getElementById('fromLabel').textContent = `From (${label})`;
  document.getElementById('toLabel').textContent = `To (${label})`;
}

/* ---------------------------------------------------------------------
 * File loading & parsing
 * ------------------------------------------------------------------- */
async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function log(msg, cls) {
  const div = document.getElementById('loadLog');
  const line = document.createElement('div');
  if (cls === 'error') line.className = 'log-error';
  else if (cls === 'ok') line.className = 'log-ok';
  line.textContent = msg;
  div.appendChild(line);
  div.scrollTop = div.scrollHeight;
}

function getTableNames(db) {
  const set = new Set();
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  if (res.length) for (const row of res[0].values) set.add(row[0]);
  return set;
}

function getColumnNames(db, table) {
  const set = new Set();
  try {
    const res = db.exec(`PRAGMA table_info(${table})`);
    if (res.length) for (const row of res[0].values) set.add(row[1]);
  } catch (e) { /* table missing */ }
  return set;
}

function browserLabel(t) {
  return (
    { chromium: 'Chromium (Chrome/Edge/Brave/Opera)', firefox: 'Firefox', safari: 'Safari', unknown: 'Unknown' }[t] || t
  );
}

async function handleFiles(fileList) {
  if (!fileList.length) return;
  await initSql();
  for (const file of fileList) {
    await processFile(file);
  }
  onDataChanged();
}

function newFileId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `f${Date.now()}${Math.random()}`;
}

async function processFile(file) {
  log(`Loading ${file.name}…`);
  try {
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    const bytes = new Uint8Array(buf);
    const header = new TextDecoder().decode(bytes.slice(0, 16));

    if (header.startsWith('SQLite format 3')) {
      await processSqliteFile(file.name, bytes, hash);
      return;
    }

    const magic = new TextDecoder().decode(bytes.slice(0, 8));
    const textHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 256)).trimStart();
    if (magic.startsWith('bplist') || textHead.startsWith('<?xml') || textHead.startsWith('<plist')) {
      processPlistFile(file.name, bytes, hash);
      return;
    }

    if (textHead.startsWith('{')) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* not valid JSON — falls through to the error below */ }
      if (json && typeof json === 'object' && json.roots && typeof json.roots === 'object') {
        processChromiumBookmarksFile(file.name, json, hash);
        return;
      }
      log(`✗ ${file.name}: looks like JSON but isn't a recognizable Chromium "Bookmarks" file (expected a "roots" object). Skipped.`, 'error');
      return;
    }

    log(`✗ ${file.name}: unrecognized file format (not a SQLite database, plist, or Chromium bookmarks JSON). Skipped.`, 'error');
  } catch (e) {
    log(`✗ ${file.name}: failed to parse — ${e.message}`, 'error');
  }
}

async function processSqliteFile(name, bytes, hash) {
  const SQLmod = await initSql();
  const db = new SQLmod.Database(bytes);
  try {
    const tables = getTableNames(db);
    const fileId = newFileId();
    let browserType = 'unknown';
    let hCount = 0;
    let dCount = 0;
    let bCount = 0;

    if (tables.has('urls') && tables.has('visits')) {
      browserType = 'chromium';
      hCount = extractChromiumHistory(db, name, fileId);
      dCount = extractChromiumDownloads(db, name, fileId);
      log(`ℹ ${name}: Chromium bookmarks live in a separate "Bookmarks" JSON file (same profile folder) — load it too if you need bookmarks.`, 'info');
    } else if (tables.has('moz_places')) {
      browserType = 'firefox';
      hCount = extractFirefoxHistory(db, name, fileId);
      dCount = extractFirefoxDownloads(db, name, fileId);
      bCount = extractFirefoxBookmarks(db, name, fileId);
    } else if (tables.has('history_items') && tables.has('history_visits')) {
      browserType = 'safari';
      hCount = extractSafariHistory(db, name, fileId);
      log(`ℹ ${name}: Safari downloads live in a separate Downloads.plist file — load it too if you need download history.`, 'info');
      log(`ℹ ${name}: Safari bookmarks live in a separate Bookmarks.plist file — load it too if you need bookmarks.`, 'info');
    } else {
      const sample = [...tables].slice(0, 6).join(', ');
      log(`✗ ${name}: unrecognized schema (tables: ${sample}${tables.size > 6 ? ', …' : ''}). No known history/download tables found.`, 'error');
      return;
    }

    state.files.push({ id: fileId, name, browserType, hash, historyCount: hCount, downloadsCount: dCount, bookmarksCount: bCount });
    const bSuffix = bCount ? `, ${bCount.toLocaleString()} bookmark rows` : '';
    log(`✓ ${name}: detected ${browserLabel(browserType)} — ${hCount.toLocaleString()} history rows, ${dCount.toLocaleString()} download rows${bSuffix}.`, 'ok');
  } finally {
    db.close();
  }
}

function processPlistFile(name, bytes, hash) {
  const fileId = newFileId();
  let root;
  try {
    root = parsePlist(bytes);
  } catch (e) {
    log(`✗ ${name}: failed to parse as a plist — ${e.message}`, 'error');
    return;
  }

  const dCount = extractSafariDownloadsFromPlist(root, name, fileId);
  if (dCount > 0) {
    state.files.push({ id: fileId, name, browserType: 'safari', hash, historyCount: 0, downloadsCount: dCount, bookmarksCount: 0 });
    log(`✓ ${name}: detected Safari Downloads.plist — ${dCount.toLocaleString()} download rows.`, 'ok');
    return;
  }

  const bCount = extractSafariBookmarksFromPlist(root, name, fileId);
  if (bCount > 0) {
    state.files.push({ id: fileId, name, browserType: 'safari', hash, historyCount: 0, downloadsCount: 0, bookmarksCount: bCount });
    log(`✓ ${name}: detected Safari Bookmarks.plist — ${bCount.toLocaleString()} bookmark rows.`, 'ok');
    return;
  }

  log(`✗ ${name}: parsed as a plist but no recognizable download or bookmark entries were found (expected a Safari Downloads.plist or Bookmarks.plist).`, 'error');
}

function processChromiumBookmarksFile(name, json, hash) {
  const fileId = newFileId();
  const bCount = extractChromiumBookmarksJson(json, name, fileId);
  if (bCount === 0) {
    log(`✗ ${name}: parsed as JSON but no bookmark entries were found (expected a Chromium "Bookmarks" file with a "roots" object).`, 'error');
    return;
  }
  state.files.push({ id: fileId, name, browserType: 'chromium', hash, historyCount: 0, downloadsCount: 0, bookmarksCount: bCount });
  log(`✓ ${name}: detected Chromium Bookmarks file — ${bCount.toLocaleString()} bookmark rows.`, 'ok');
}

/* ---------------------------------------------------------------------
 * Chromium (Chrome / Edge / Brave / Opera)
 * ------------------------------------------------------------------- */
const CHROMIUM_TRANSITIONS = {
  0: 'link', 1: 'typed', 2: 'auto_bookmark', 3: 'auto_subframe', 4: 'manual_subframe',
  5: 'generated', 6: 'start_page', 7: 'form_submit', 8: 'reload', 9: 'keyword', 10: 'keyword_generated',
};
function chromiumTransitionLabel(raw) {
  if (raw === null || raw === undefined) return '';
  const core = raw & 0xff;
  return CHROMIUM_TRANSITIONS[core] || `code ${core}`;
}
function chromiumStateLabel(s) {
  switch (s) {
    case 0: return 'In Progress';
    case 1: return 'Complete';
    case 2: return 'Cancelled';
    case 3: return 'Interrupted';
    case 4: return 'Interrupted';
    default: return s === undefined || s === null ? '' : `code ${s}`;
  }
}
function chromiumDangerLabel(d) {
  if (d === null || d === undefined) return '';
  if (d === 0) return '';
  if (d === 6) return 'User validated';
  return `FLAGGED (type ${d})`;
}
function fileNameFromPath(p) {
  if (!p) return '';
  const norm = String(p).replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts[parts.length - 1] || p;
}

function extractChromiumHistory(db, sourceName, fileId) {
  let count = 0;
  try {
    const res = db.exec(`
      SELECT visits.id, visits.from_visit, visits.visit_time, urls.url, urls.title, urls.visit_count, visits.transition
      FROM visits JOIN urls ON visits.url = urls.id
    `);
    if (res.length) {
      for (const row of res[0].values) {
        const [visitId, fromVisit, visitTimeRaw, url, title, visitCount, transitionRaw] = row;
        state.history.push({
          id: `${fileId}-h${count}`,
          source: sourceName,
          browserType: 'chromium',
          visitTime: chromeTimeToMs(visitTimeRaw),
          title: title || '',
          url: url || '',
          visitCount: visitCount || 0,
          transition: chromiumTransitionLabel(transitionRaw),
          searchTerm: extractSearchQuery(url),
          chainKey: `${fileId}:${visitId}`,
          chainFromKey: fromVisit ? `${fileId}:${fromVisit}` : null,
        });
        count++;
      }
    }
  } catch (e) {
    log(`  (Chromium history query failed: ${e.message})`, 'error');
  }
  return count;
}

function extractChromiumDownloads(db, sourceName, fileId) {
  let count = 0;
  try {
    const cols = getColumnNames(db, 'downloads');
    if (!cols.size) return 0;
    const want = ['id', 'target_path', 'current_path', 'start_time', 'end_time', 'total_bytes', 'received_bytes', 'state', 'danger_type', 'mime_type', 'referrer', 'tab_url', 'opened', 'last_access_time'];
    const select = want.filter((c) => cols.has(c));
    const res = db.exec(`SELECT ${select.join(', ')} FROM downloads`);

    const chainMap = {};
    try {
      const chainRes = db.exec('SELECT id, url, chain_index FROM downloads_url_chains');
      if (chainRes.length) {
        for (const [id, url, idx] of chainRes[0].values) {
          if (!(id in chainMap) || idx > chainMap[id].idx) chainMap[id] = { url, idx };
        }
      }
    } catch (e) { /* older schema without url chains */ }

    if (res.length) {
      for (const rawRow of res[0].values) {
        const row = {};
        select.forEach((c, i) => { row[c] = rawRow[i]; });
        const finalUrl = (chainMap[row.id] && chainMap[row.id].url) || row.tab_url || '';
        const targetPath = row.target_path || row.current_path || '';
        state.downloads.push({
          id: `${fileId}-d${count}`,
          source: sourceName,
          browserType: 'chromium',
          startTime: chromeTimeToMs(row.start_time),
          endTime: chromeTimeToMs(row.end_time),
          fileName: fileNameFromPath(targetPath),
          targetPath,
          url: finalUrl,
          referrer: row.referrer || row.tab_url || '',
          totalBytes: row.total_bytes || 0,
          receivedBytes: row.received_bytes || 0,
          state: chromiumStateLabel(row.state),
          mimeType: row.mime_type || '',
          dangerType: chromiumDangerLabel(row.danger_type),
          opened: row.opened === undefined || row.opened === null ? null : !!row.opened,
          lastAccessTime: chromeTimeToMs(row.last_access_time),
        });
        count++;
      }
    }
  } catch (e) {
    log(`  (Chromium downloads query failed: ${e.message})`, 'error');
  }
  return count;
}

// Chromium's "Bookmarks" file is plain JSON (not sqlite) — a tree of "folder"/"url"
// nodes under roots.bookmark_bar / roots.other / roots.synced (and any future root Chrome adds).
function walkChromiumBookmarkNode(node, folderPath, sourceName, fileId, counterRef) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'url') {
    state.bookmarks.push({
      id: `${fileId}-b${counterRef.count++}`,
      source: sourceName,
      browserType: 'chromium',
      title: node.name || '',
      url: node.url || '',
      dateAdded: chromeTimeToMs(Number(node.date_added)),
      folder: folderPath.join(' / ') || '(root)',
    });
  } else if (Array.isArray(node.children)) {
    const nextPath = node.name ? [...folderPath, node.name] : folderPath;
    for (const child of node.children) walkChromiumBookmarkNode(child, nextPath, sourceName, fileId, counterRef);
  }
}
function extractChromiumBookmarksJson(json, sourceName, fileId) {
  const roots = json && json.roots;
  if (!roots || typeof roots !== 'object') return 0;
  const counterRef = { count: 0 };
  for (const key of Object.keys(roots)) {
    walkChromiumBookmarkNode(roots[key], [], sourceName, fileId, counterRef);
  }
  return counterRef.count;
}

/* ---------------------------------------------------------------------
 * Firefox
 * ------------------------------------------------------------------- */
const FIREFOX_TRANSITIONS = {
  1: 'link', 2: 'typed', 3: 'bookmark', 4: 'embed', 5: 'redirect_permanent',
  6: 'redirect_temporary', 7: 'download', 8: 'framed_link', 9: 'reload',
};
function firefoxTransitionLabel(t) {
  if (!t) return '';
  return FIREFOX_TRANSITIONS[t] || `code ${t}`;
}
function firefoxStateLabel(s) {
  const map = { 0: 'Not Started', 1: 'Downloading', 2: 'Complete', 3: 'Failed', 4: 'Cancelled', 5: 'Paused', 6: 'Queued', 8: 'Scanning' };
  if (s === undefined || s === null) return 'Unknown';
  return map[s] || `code ${s}`;
}
function decodeFileUri(uri) {
  if (!uri) return '';
  try {
    let p = String(uri).replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
    return decodeURIComponent(p);
  } catch (e) {
    return uri;
  }
}

function extractFirefoxHistory(db, sourceName, fileId) {
  let count = 0;
  try {
    const res = db.exec(`
      SELECT h.id, h.from_visit, h.visit_date, p.url, p.title, p.visit_count, h.visit_type
      FROM moz_historyvisits h JOIN moz_places p ON h.place_id = p.id
    `);
    if (res.length) {
      for (const row of res[0].values) {
        const [visitId, fromVisit, visitDateRaw, url, title, visitCount, visitType] = row;
        state.history.push({
          id: `${fileId}-h${count}`,
          source: sourceName,
          browserType: 'firefox',
          visitTime: firefoxTimeToMs(visitDateRaw),
          title: title || '',
          url: url || '',
          visitCount: visitCount || 0,
          transition: firefoxTransitionLabel(visitType),
          searchTerm: extractSearchQuery(url),
          chainKey: `${fileId}:${visitId}`,
          chainFromKey: fromVisit ? `${fileId}:${fromVisit}` : null,
        });
        count++;
      }
    }
  } catch (e) {
    log(`  (Firefox history query failed: ${e.message})`, 'error');
  }
  return count;
}

function extractFirefoxDownloads(db, sourceName, fileId) {
  let count = 0;
  try {
    const destRes = db.exec(`
      SELECT a.place_id, a.content, p.url, p.title, p.last_visit_date
      FROM moz_annotations a
      JOIN moz_anno_attributes attr ON a.anno_attribute_id = attr.id
      JOIN moz_places p ON a.place_id = p.id
      WHERE attr.name = 'downloads/destinationFileURI'
    `);
    if (!destRes.length) return 0;

    const metaMap = {};
    try {
      const metaRes = db.exec(`
        SELECT a.place_id, a.content
        FROM moz_annotations a
        JOIN moz_anno_attributes attr ON a.anno_attribute_id = attr.id
        WHERE attr.name = 'downloads/metaData'
      `);
      if (metaRes.length) {
        for (const [placeId, content] of metaRes[0].values) {
          try { metaMap[placeId] = JSON.parse(content); } catch (e) { /* ignore malformed */ }
        }
      }
    } catch (e) { /* metadata annotation absent */ }

    for (const row of destRes[0].values) {
      const [placeId, destUri, sourceUrl, , lastVisit] = row;
      const meta = metaMap[placeId] || {};
      const targetPath = decodeFileUri(destUri);
      state.downloads.push({
        id: `${fileId}-d${count}`,
        source: sourceName,
        browserType: 'firefox',
        startTime: firefoxTimeToMs(lastVisit),
        endTime: meta.endTime ? firefoxTimeToMs(meta.endTime) : null,
        fileName: fileNameFromPath(targetPath),
        targetPath: targetPath || '',
        url: sourceUrl || '',
        referrer: '',
        totalBytes: meta.fileSize || 0,
        receivedBytes: meta.fileSize || 0,
        state: firefoxStateLabel(meta.state),
        mimeType: '',
        dangerType: '',
        opened: null,
        lastAccessTime: null,
      });
      count++;
    }
  } catch (e) {
    log(`  (Firefox downloads not found via annotations schema — may be a newer/older profile format: ${e.message})`, 'info');
  }
  return count;
}

// moz_bookmarks lives in the same places.sqlite already loaded for history — type 1 rows are
// bookmarks (fk -> moz_places.id), type 2 are folders, type 3 are separators.
function extractFirefoxBookmarks(db, sourceName, fileId) {
  let count = 0;
  try {
    const res = db.exec(`
      SELECT b.parent, b.title, b.dateAdded, p.url
      FROM moz_bookmarks b
      JOIN moz_places p ON b.fk = p.id
      WHERE b.type = 1
    `);
    if (!res.length) return 0;

    const nodeMap = {};
    const nodeRes = db.exec('SELECT id, parent, title FROM moz_bookmarks');
    if (nodeRes.length) {
      for (const [id, parent, title] of nodeRes[0].values) nodeMap[id] = { parent, title };
    }
    const folderPathFor = (parentId) => {
      const parts = [];
      let cur = parentId;
      let guard = 0;
      while (cur !== null && cur !== undefined && nodeMap[cur] && guard++ < 50) {
        if (nodeMap[cur].title) parts.unshift(nodeMap[cur].title);
        cur = nodeMap[cur].parent;
      }
      return parts.join(' / ') || '(root)';
    };

    for (const [parent, title, dateAddedRaw, url] of res[0].values) {
      state.bookmarks.push({
        id: `${fileId}-b${count}`,
        source: sourceName,
        browserType: 'firefox',
        title: title || '',
        url: url || '',
        dateAdded: firefoxTimeToMs(dateAddedRaw),
        folder: folderPathFor(parent),
      });
      count++;
    }
  } catch (e) {
    log(`  (Firefox bookmarks query failed: ${e.message})`, 'error');
  }
  return count;
}

/* ---------------------------------------------------------------------
 * Safari
 * ------------------------------------------------------------------- */
function extractSafariHistory(db, sourceName, fileId) {
  let count = 0;
  try {
    const res = db.exec(`
      SELECT hv.visit_time, hi.url, hv.title, hi.visit_count
      FROM history_visits hv JOIN history_items hi ON hv.history_item = hi.id
    `);
    if (res.length) {
      for (const row of res[0].values) {
        const [visitTimeRaw, url, title, visitCount] = row;
        state.history.push({
          id: `${fileId}-h${count}`,
          source: sourceName,
          browserType: 'safari',
          visitTime: safariTimeToMs(visitTimeRaw),
          title: title || '',
          url: url || '',
          visitCount: visitCount || 0,
          transition: '',
          searchTerm: extractSearchQuery(url),
        });
        count++;
      }
    }
  } catch (e) {
    log(`  (Safari history query failed: ${e.message})`, 'error');
  }
  return count;
}

/* ---------------------------------------------------------------------
 * Safari Downloads.plist (binary or XML property list — NOT SQLite)
 * ------------------------------------------------------------------- */
function parsePlist(bytes) {
  const magic = new TextDecoder().decode(bytes.slice(0, 8));
  if (magic.startsWith('bplist')) return parseBinaryPlist(bytes);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return parseXmlPlist(text);
}

function parseBinaryPlist(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailerOffset = bytes.length - 32;

  const readUIntBE = (offset, size) => {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + dv.getUint8(offset + i);
    return v;
  };
  const readIntBE = (offset, size) => {
    if (size <= 6) return readUIntBE(offset, size);
    let big = 0n;
    for (let i = 0; i < size; i++) big = (big << 8n) | BigInt(dv.getUint8(offset + i));
    if (size === 8) {
      const max = 1n << 63n;
      if (big >= max) big -= 1n << 64n;
    }
    return Number(big);
  };

  const offsetIntSize = dv.getUint8(trailerOffset + 6);
  const objectRefSize = dv.getUint8(trailerOffset + 7);
  const numObjects = readUIntBE(trailerOffset + 8, 8);
  const topObject = readUIntBE(trailerOffset + 16, 8);
  const offsetTableOffset = readUIntBE(trailerOffset + 24, 8);

  const offsetTable = [];
  for (let i = 0; i < numObjects; i++) {
    offsetTable.push(readUIntBE(offsetTableOffset + i * offsetIntSize, offsetIntSize));
  }

  const cache = new Array(numObjects);

  function readCount(pos) {
    const marker = dv.getUint8(pos);
    const size = 1 << (marker & 0x0f);
    return { count: readIntBE(pos + 1, size), pos: pos + 1 + size };
  }
  function asciiDecode(pos, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(pos + i));
    return s;
  }
  function utf16beDecode(pos, len) {
    const units = [];
    for (let i = 0; i < len; i++) units.push(dv.getUint16(pos + i * 2, false));
    return String.fromCharCode(...units);
  }

  function parseObject(index) {
    if (cache[index] !== undefined) return cache[index];
    const offset = offsetTable[index];
    const marker = dv.getUint8(offset);
    const objType = marker >> 4;
    const objInfo = marker & 0x0f;
    let pos = offset + 1;

    if (objType === 0x0) {
      const result = objInfo === 0x08 ? false : objInfo === 0x09 ? true : null;
      cache[index] = result;
      return result;
    }
    if (objType === 0x1) {
      const result = readIntBE(pos, 1 << objInfo);
      cache[index] = result;
      return result;
    }
    if (objType === 0x2) {
      const size = 1 << objInfo;
      const result = size === 4 ? dv.getFloat32(pos, false) : dv.getFloat64(pos, false);
      cache[index] = result;
      return result;
    }
    if (objType === 0x3) {
      const result = { __plistDate: dv.getFloat64(pos, false) };
      cache[index] = result;
      return result;
    }
    if (objType === 0x4) {
      let len = objInfo;
      if (objInfo === 0x0f) { const r = readCount(pos); len = r.count; pos = r.pos; }
      const result = bytes.slice(pos, pos + len);
      cache[index] = result;
      return result;
    }
    if (objType === 0x5) {
      let len = objInfo;
      if (objInfo === 0x0f) { const r = readCount(pos); len = r.count; pos = r.pos; }
      const result = asciiDecode(pos, len);
      cache[index] = result;
      return result;
    }
    if (objType === 0x6) {
      let len = objInfo;
      if (objInfo === 0x0f) { const r = readCount(pos); len = r.count; pos = r.pos; }
      const result = utf16beDecode(pos, len);
      cache[index] = result;
      return result;
    }
    if (objType === 0x8) {
      const result = readIntBE(pos, objInfo + 1);
      cache[index] = result;
      return result;
    }
    if (objType === 0xa || objType === 0xc) {
      let len = objInfo;
      if (objInfo === 0x0f) { const r = readCount(pos); len = r.count; pos = r.pos; }
      const arr = [];
      cache[index] = arr;
      for (let i = 0; i < len; i++) {
        const ref = readUIntBE(pos + i * objectRefSize, objectRefSize);
        arr.push(parseObject(ref));
      }
      return arr;
    }
    if (objType === 0xd) {
      let len = objInfo;
      if (objInfo === 0x0f) { const r = readCount(pos); len = r.count; pos = r.pos; }
      const dict = {};
      cache[index] = dict;
      const keysPos = pos;
      const valsPos = pos + len * objectRefSize;
      for (let i = 0; i < len; i++) {
        const keyRef = readUIntBE(keysPos + i * objectRefSize, objectRefSize);
        const valRef = readUIntBE(valsPos + i * objectRefSize, objectRefSize);
        dict[parseObject(keyRef)] = parseObject(valRef);
      }
      return dict;
    }
    cache[index] = null;
    return null;
  }

  return parseObject(topObject);
}

const PLIST_EPOCH_UTC = Date.UTC(2001, 0, 1, 0, 0, 0);
function parseXmlPlist(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('malformed XML plist');
  const plistEl = doc.querySelector('plist');
  if (!plistEl || !plistEl.firstElementChild) throw new Error('no <plist> root element found');
  return parseXmlNode(plistEl.firstElementChild);
}
function parseXmlNode(el) {
  switch (el.tagName) {
    case 'dict': {
      const obj = {};
      const children = [...el.children];
      for (let i = 0; i < children.length; i += 2) {
        obj[children[i].textContent] = parseXmlNode(children[i + 1]);
      }
      return obj;
    }
    case 'array':
      return [...el.children].map(parseXmlNode);
    case 'string': return el.textContent;
    case 'integer': return parseInt(el.textContent, 10);
    case 'real': return parseFloat(el.textContent);
    case 'true': return true;
    case 'false': return false;
    case 'date': {
      const ms = Date.parse(el.textContent);
      return isNaN(ms) ? null : { __plistDate: (ms - PLIST_EPOCH_UTC) / 1000 };
    }
    case 'data': return el.textContent;
    default: return null;
  }
}

function extractSafariDownloadsFromPlist(root, sourceName, fileId) {
  let list = null;
  if (Array.isArray(root)) {
    list = root;
  } else if (root && typeof root === 'object') {
    const candidateKeys = ['DownloadHistory', 'DownloadHistoryEntries'];
    for (const k of candidateKeys) {
      if (Array.isArray(root[k])) { list = root[k]; break; }
    }
    if (!list) {
      // Fallback for unknown schema variants — but only an array whose *key name*
      // says "download" (e.g. Bookmarks.plist's "Children" array must never match here).
      for (const k of Object.keys(root)) {
        if (/download/i.test(k) && Array.isArray(root[k]) && root[k].length && typeof root[k][0] === 'object') { list = root[k]; break; }
      }
    }
  }
  if (!list) return 0;

  const pick = (obj, keys) => {
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    return undefined;
  };
  const dateToMs = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object' && v.__plistDate !== undefined) return safariTimeToMs(v.__plistDate);
    if (typeof v === 'number') return safariTimeToMs(v);
    return null;
  };

  let count = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const url = pick(entry, ['DownloadEntryURL', 'DownloadURL', 'URL']);
    const path = pick(entry, ['DownloadEntryPath', 'DownloadEntryDestinationPath', 'Path']);
    if (!url && !path) continue;
    const originUrl = pick(entry, ['DownloadEntryOriginURL', 'DownloadEntryReferrerURL', 'OriginURL']);
    const started = pick(entry, ['DownloadEntryDateAddedKey', 'DownloadEntryDateStartedKey', 'DateAdded']);
    const finished = pick(entry, ['DownloadEntryDateFinishedKey', 'DateFinished']);
    const bytesSoFar = pick(entry, ['DownloadEntryProgressBytesSoFar']);
    const bytesTotal = pick(entry, ['DownloadEntryProgressTotalToLoad', 'DownloadEntryEstimatedLoadedSize']);
    const startMs = dateToMs(started);
    const endMs = dateToMs(finished);

    state.downloads.push({
      id: `${fileId}-d${count}`,
      source: sourceName,
      browserType: 'safari',
      startTime: startMs,
      endTime: endMs,
      fileName: fileNameFromPath(path),
      targetPath: path || '',
      url: url || '',
      referrer: originUrl || '',
      totalBytes: bytesTotal || 0,
      receivedBytes: bytesSoFar || bytesTotal || 0,
      state: endMs ? 'Complete' : (bytesSoFar && bytesTotal && bytesSoFar < bytesTotal ? 'Incomplete' : 'Unknown'),
      mimeType: '',
      dangerType: '',
      opened: null,
      lastAccessTime: null,
    });
    count++;
  }
  return count;
}

/* ---------------------------------------------------------------------
 * Safari Bookmarks.plist (binary or XML property list — NOT SQLite)
 * A tree of dicts: folders carry a "Children" array, leaves carry a
 * "URLString" (title comes from "Title" or "URIDictionary.title").
 * ------------------------------------------------------------------- */
function walkSafariBookmarkNode(node, folderPath, sourceName, fileId, counterRef) {
  if (!node || typeof node !== 'object') return;
  const title = node.Title || (node.URIDictionary && node.URIDictionary.title) || '';
  if (typeof node.URLString === 'string') {
    state.bookmarks.push({
      id: `${fileId}-b${counterRef.count++}`,
      source: sourceName,
      browserType: 'safari',
      title,
      url: node.URLString,
      dateAdded: null, // Bookmarks.plist doesn't record a per-bookmark added date
      folder: folderPath.join(' / ') || '(root)',
    });
    return;
  }
  if (Array.isArray(node.Children)) {
    const nextPath = title ? [...folderPath, title] : folderPath;
    for (const child of node.Children) walkSafariBookmarkNode(child, nextPath, sourceName, fileId, counterRef);
  }
}
function extractSafariBookmarksFromPlist(root, sourceName, fileId) {
  const counterRef = { count: 0 };
  walkSafariBookmarkNode(root, [], sourceName, fileId, counterRef);
  return counterRef.count;
}

/* ---------------------------------------------------------------------
 * Search-engine query extraction — parsed directly from the visited URL's
 * host/path/query-string, so it works identically across Chromium, Firefox,
 * and Safari with no browser-specific schema (Safari's History.db has no
 * dedicated "typed search" table the way Chromium's keyword_search_terms does).
 * ------------------------------------------------------------------- */
const SEARCH_ENGINES = [
  { host: /(^|\.)google\.[a-z.]{2,}$/i, paths: ['/search'], params: ['q'] },
  { host: /(^|\.)bing\.com$/i, paths: ['/search'], params: ['q'] },
  { host: /(^|\.)search\.yahoo\.com$/i, paths: ['/search'], params: ['p'] },
  { host: /(^|\.)duckduckgo\.com$/i, paths: ['/'], params: ['q'] },
  { host: /(^|\.)yandex\.[a-z.]{2,}$/i, paths: ['/search/'], params: ['text'] },
  { host: /(^|\.)baidu\.com$/i, paths: ['/s'], params: ['wd', 'word'] },
  { host: /(^|\.)ecosia\.org$/i, paths: ['/search'], params: ['q'] },
  { host: /(^|\.)startpage\.com$/i, paths: ['/sp/search', '/do/search'], params: ['query', 'q'] },
  { host: /(^|\.)search\.brave\.com$/i, paths: ['/search'], params: ['q'] },
  { host: /(^|\.)ask\.com$/i, paths: ['/web'], params: ['q'] },
  { host: /(^|\.)search\.aol\.com$/i, paths: ['/aol/search'], params: ['q'] },
  { host: /(^|\.)youtube\.com$/i, paths: ['/results'], params: ['search_query'] },
  { host: /(^|\.)amazon\.[a-z.]{2,}$/i, paths: ['/s'], params: ['k'] },
  { host: /(^|\.)ebay\.[a-z.]{2,}$/i, paths: ['/sch'], params: ['_nkw'] },
];
function extractSearchQuery(urlStr) {
  if (!urlStr) return '';
  let u;
  try { u = new URL(urlStr); } catch (e) { return ''; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  for (const engine of SEARCH_ENGINES) {
    if (!engine.host.test(host)) continue;
    if (!engine.paths.some((p) => path === p || path.startsWith(p))) continue;
    for (const param of engine.params) {
      const v = u.searchParams.get(param);
      if (v) return v;
    }
  }
  return '';
}

/* ---------------------------------------------------------------------
 * Suspicious-domain / indicator heuristics
 * All checks run locally against already-loaded data — nothing is sent
 * anywhere. IOC list is analyst-supplied (pasted/uploaded), not fetched.
 * ------------------------------------------------------------------- */
const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'icu', 'club', 'work', 'click', 'link',
  'support', 'bid', 'loan', 'win', 'party', 'review', 'stream', 'gdn', 'men', 'date',
  'faith', 'science', 'accountant', 'download', 'zip', 'mov', 'country', 'kim', 'cricket',
  'cc', 'ws', 'pw', 'buzz', 'rest', 'quest',
]);
const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly',
  'cutt.ly', 'shorte.st', 'adf.ly', 'tiny.cc', 'rb.gy', 's.id', 'v.gd', 'lnkd.in',
  'shorturl.at', 'tr.im', 'clck.ru', 'soo.gd', 'qr.ae',
]);
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'msi', 'msp', 'hta', 'ps1', 'ps1xml', 'psc1', 'psc2', 'jar', 'cpl', 'gadget', 'lnk',
  'reg', 'iso', 'img', 'vhd', 'vhdx', 'apk', 'sh', 'command', 'scpt',
]);
const DOUBLE_EXTENSION_RE = /\.(doc|docx|pdf|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|txt|zip|rar|7z|csv|mp3|mp4)\.(exe|scr|bat|cmd|com|pif|vbs|js|jar|ps1|hta|wsf|lnk)$/i;

function isIpLiteralHost(h) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.startsWith('[') && h.endsWith(']')) return true;
  return false;
}

function hostnameMatchesIoc(host) {
  if (!host || !state.iocSet.size) return false;
  if (state.iocSet.has(host)) return true;
  const parts = host.split('.');
  for (let i = 1; i < parts.length; i++) {
    if (state.iocSet.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

function analyzeUrlFlags(urlStr) {
  const flags = [];
  let u;
  try { u = new URL(urlStr); } catch (e) { return { flags, host: null }; }
  const host = u.hostname.toLowerCase();
  if (!host) return { flags, host: null };

  if (hostnameMatchesIoc(host)) {
    flags.push({ severity: 'high', label: 'Matches loaded indicator (IOC) list' });
  }
  if (isIpLiteralHost(host)) {
    flags.push({ severity: 'medium', label: 'IP-literal URL (no domain name)' });
  }
  if (host.includes('xn--')) {
    flags.push({ severity: 'medium', label: 'Punycode/IDN domain — check for homograph spoofing' });
  }
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  if (SUSPICIOUS_TLDS.has(tld)) {
    flags.push({ severity: 'medium', label: `Suspicious/high-abuse TLD (.${tld})` });
  }
  if (URL_SHORTENERS.has(host)) {
    flags.push({ severity: 'low', label: 'URL shortener (destination hidden)' });
  }
  return { flags, host };
}

function analyzeFilenameFlags(fileName) {
  const flags = [];
  if (!fileName) return flags;
  const lower = fileName.toLowerCase();
  if (DOUBLE_EXTENSION_RE.test(lower)) {
    flags.push({ severity: 'high', label: 'Disguised double extension (e.g. "invoice.pdf.exe")' });
  } else {
    const dotIdx = lower.lastIndexOf('.');
    const ext = dotIdx >= 0 ? lower.slice(dotIdx + 1) : '';
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      flags.push({ severity: 'medium', label: `Executable/script file type (.${ext})` });
    }
  }
  return flags;
}

function getKeywordFlags(haystack) {
  const flags = [];
  if (!haystack || !state.keywordList.length) return flags;
  const hay = haystack.toLowerCase();
  for (const kw of state.keywordList) {
    if (hay.includes(kw)) flags.push({ severity: 'keyword', label: `Keyword match: "${kw}"` });
  }
  return flags;
}

function getAllFlags(r, kind) {
  let flags = [];
  if (r.url) {
    flags = analyzeUrlFlags(r.url).flags;
  }
  if (kind === 'download') {
    flags = flags.concat(analyzeFilenameFlags(r.fileName));
    flags = flags.concat(getKeywordFlags([r.fileName, r.targetPath, r.url, r.referrer].filter(Boolean).join(' ')));
  } else if (kind === 'bookmark') {
    flags = flags.concat(getKeywordFlags([r.title, r.url, r.folder].filter(Boolean).join(' ')));
  } else {
    flags = flags.concat(getKeywordFlags([r.title, r.url, r.searchTerm].filter(Boolean).join(' ')));
  }
  return flags;
}

/* ---------------------------------------------------------------------
 * Rendering helpers
 * ------------------------------------------------------------------- */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}
function truncate(s, n) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// Defangs a URL for safe display/copy into reports, chat, tickets, etc. —
// standard DFIR convention so the string can't be auto-linkified, clicked,
// or parsed by security tooling that scans for live IOCs.
function defangUrl(url) {
  if (!url) return url;
  return String(url)
    .replace(/^(https?):\/\//i, (m, scheme) => `${scheme.toLowerCase() === 'https' ? 'hxxps' : 'hxxp'}[://]`)
    .replace(/^ftp:\/\//i, 'fxp[://]')
    .replace(/\./g, '[.]');
}
function displayUrl(url) {
  return state.defangUrls ? defangUrl(url) : url;
}
function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function stateClassFor(s) {
  if (!s) return '';
  const l = s.toLowerCase();
  if (l.includes('complete')) return 'state-complete';
  if (l.includes('interrupt') || l.includes('cancel') || l.includes('fail')) return 'state-interrupted';
  return '';
}
function domainOf(url) {
  try { return new URL(url).hostname; } catch (e) { return null; }
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------------------------------------------------------------------
 * Filtering & sorting
 * ------------------------------------------------------------------- */
function applyFiltersAndRender() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const source = document.getElementById('sourceFilter').value;
  const { from, to } = state.range;

  state.filtered.history = state.history.filter((r) => {
    if (source !== 'all' && r.source !== source) return false;
    if (from !== null && (r.visitTime === null || r.visitTime < from)) return false;
    if (to !== null && (r.visitTime === null || r.visitTime > to)) return false;
    if (search && !`${r.title} ${r.url} ${r.searchTerm}`.toLowerCase().includes(search)) return false;
    return true;
  });

  state.filtered.downloads = state.downloads.filter((r) => {
    if (source !== 'all' && r.source !== source) return false;
    if (from !== null && (r.startTime === null || r.startTime < from)) return false;
    if (to !== null && (r.startTime === null || r.startTime > to)) return false;
    if (search && !`${r.fileName} ${r.targetPath} ${r.url}`.toLowerCase().includes(search)) return false;
    return true;
  });

  state.filtered.bookmarks = state.bookmarks.filter((r) => {
    if (source !== 'all' && r.source !== source) return false;
    if (from !== null && (r.dateAdded === null || r.dateAdded < from)) return false;
    if (to !== null && (r.dateAdded === null || r.dateAdded > to)) return false;
    if (search && !`${r.title} ${r.url} ${r.folder}`.toLowerCase().includes(search)) return false;
    return true;
  });

  for (const r of state.filtered.history) {
    r.flags = getAllFlags(r, 'history');
    r.flagCount = r.flags.length;
  }
  for (const r of state.filtered.downloads) {
    r.flags = getAllFlags(r, 'download');
    r.flagCount = r.flags.length;
  }
  for (const r of state.filtered.bookmarks) {
    r.flags = getAllFlags(r, 'bookmark');
    r.flagCount = r.flags.length;
  }
  if (state.flaggedOnly) {
    state.filtered.history = state.filtered.history.filter((r) => r.flagCount > 0);
    state.filtered.downloads = state.filtered.downloads.filter((r) => r.flagCount > 0);
    state.filtered.bookmarks = state.filtered.bookmarks.filter((r) => r.flagCount > 0);
  }

  state.page.history = 1;
  state.page.downloads = 1;
  state.page.bookmarks = 1;

  sortData('history');
  sortData('downloads');
  sortData('bookmarks');
  renderHistory();
  renderDownloads();
  renderBookmarks();
  renderSummary();
}

function sortData(tab) {
  const { key, dir } = state.sort[tab];
  state.filtered[tab].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderFlagsCell(flags) {
  if (!flags || !flags.length) return '';
  return flags.map((f) => `<span class="badge flag-${f.severity}" title="${escAttr(f.label)}">${esc(f.label)}</span>`).join('');
}

function pageBounds(tab) {
  const rows = state.filtered[tab];
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page[tab] > totalPages) state.page[tab] = totalPages;
  if (state.page[tab] < 1) state.page[tab] = 1;
  const start = (state.page[tab] - 1) * state.pageSize;
  return { rows, totalPages, start, shown: rows.slice(start, start + state.pageSize) };
}

function updatePaginationUI(tab, totalPages) {
  const page = state.page[tab];
  document.getElementById(`${tab}PageIndicator`).textContent = `Page ${page} of ${totalPages}`;
  document.getElementById(`${tab}PrevBtn`).disabled = page <= 1;
  document.getElementById(`${tab}NextBtn`).disabled = page >= totalPages;
}

function goToPage(tab, page) {
  state.page[tab] = page;
  if (tab === 'history') renderHistory();
  else if (tab === 'downloads') renderDownloads();
  else renderBookmarks();
}

function renderHistory() {
  const tbody = document.getElementById('historyBody');
  const { rows, totalPages, start, shown } = pageBounds('history');
  const frag = document.createDocumentFragment();
  for (const r of shown) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="time-cell">${fmtTime(r.visitTime)}</td>
      <td title="${escAttr(r.title)}">${esc(truncate(r.title, 80)) || '—'}</td>
      <td class="url-cell mono url-clickable" title="Click to view navigation chain" data-record-id="${escAttr(r.id)}">${esc(displayUrl(r.url))}</td>
      <td title="${escAttr(r.searchTerm)}">${esc(truncate(r.searchTerm, 50)) || '—'}</td>
      <td>${r.visitCount}</td>
      <td>${esc(r.transition)}</td>
      <td class="flags-cell">${renderFlagsCell(r.flags)}</td>
      <td><span class="badge badge-${r.browserType}">${esc(browserLabel(r.browserType))}</span></td>
      <td class="mono" title="${escAttr(r.source)}">${esc(truncate(r.source, 30))}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
  const msg = rows.length
    ? `Showing ${(start + 1).toLocaleString()}-${(start + shown.length).toLocaleString()} of ${rows.length.toLocaleString()} filtered rows (${state.history.length.toLocaleString()} total loaded).`
    : `No history rows match the current filters (${state.history.length.toLocaleString()} total loaded).`;
  document.getElementById('historyCount').textContent = msg;
  updatePaginationUI('history', totalPages);
}

function renderDownloads() {
  const tbody = document.getElementById('downloadsBody');
  const { rows, totalPages, start, shown } = pageBounds('downloads');
  const frag = document.createDocumentFragment();
  for (const r of shown) {
    const tr = document.createElement('tr');
    const stateClass = stateClassFor(r.state);
    const dangerClass = r.dangerType && r.dangerType.startsWith('FLAGGED') ? 'state-dangerous' : '';
    const openedLabel = r.opened === null || r.opened === undefined ? '—' : (r.opened ? 'Yes' : 'No');
    tr.innerHTML = `
      <td class="time-cell">${fmtTime(r.startTime)}</td>
      <td class="time-cell">${fmtTime(r.endTime)}</td>
      <td title="${escAttr(r.fileName)}">${esc(r.fileName) || '—'}</td>
      <td class="mono" title="${escAttr(r.targetPath)}">${esc(truncate(r.targetPath, 60))}</td>
      <td class="mono" title="${escAttr(displayUrl(r.url))}">${esc(truncate(displayUrl(r.url), 60))}</td>
      <td class="mono" title="${escAttr(displayUrl(r.referrer))}">${esc(truncate(displayUrl(r.referrer), 50))}</td>
      <td>${formatBytes(r.totalBytes)}</td>
      <td class="${stateClass}">${esc(r.state)}</td>
      <td>${esc(r.mimeType)}</td>
      <td class="${dangerClass}">${esc(r.dangerType)}</td>
      <td>${openedLabel}</td>
      <td class="time-cell">${fmtTime(r.lastAccessTime)}</td>
      <td class="flags-cell">${renderFlagsCell(r.flags)}</td>
      <td><span class="badge badge-${r.browserType}">${esc(browserLabel(r.browserType))}</span></td>
      <td class="mono" title="${escAttr(r.source)}">${esc(truncate(r.source, 30))}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
  document.getElementById('downloadsCount').textContent = rows.length
    ? `Showing ${(start + 1).toLocaleString()}-${(start + shown.length).toLocaleString()} of ${rows.length.toLocaleString()} filtered rows (${state.downloads.length.toLocaleString()} total loaded).`
    : `No download rows match the current filters (${state.downloads.length.toLocaleString()} total loaded).`;
  updatePaginationUI('downloads', totalPages);
}

function renderBookmarks() {
  const tbody = document.getElementById('bookmarksBody');
  const { rows, totalPages, start, shown } = pageBounds('bookmarks');
  const frag = document.createDocumentFragment();
  for (const r of shown) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="time-cell">${fmtTime(r.dateAdded)}</td>
      <td title="${escAttr(r.title)}">${esc(truncate(r.title, 80)) || '—'}</td>
      <td class="mono" title="${escAttr(displayUrl(r.url))}">${esc(truncate(displayUrl(r.url), 70))}</td>
      <td title="${escAttr(r.folder)}">${esc(truncate(r.folder, 40)) || '—'}</td>
      <td class="flags-cell">${renderFlagsCell(r.flags)}</td>
      <td><span class="badge badge-${r.browserType}">${esc(browserLabel(r.browserType))}</span></td>
      <td class="mono" title="${escAttr(r.source)}">${esc(truncate(r.source, 30))}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
  document.getElementById('bookmarksCount').textContent = rows.length
    ? `Showing ${(start + 1).toLocaleString()}-${(start + shown.length).toLocaleString()} of ${rows.length.toLocaleString()} filtered rows (${state.bookmarks.length.toLocaleString()} total loaded).`
    : `No bookmark rows match the current filters (${state.bookmarks.length.toLocaleString()} total loaded).`;
  updatePaginationUI('bookmarks', totalPages);
}

function statCard(label, value, extraClass) {
  return `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value ${extraClass || ''}">${value}</div></div>`;
}

function renderSummary() {
  const grid = document.getElementById('summaryGrid');
  const allTimes = [...state.history.map((r) => r.visitTime), ...state.downloads.map((r) => r.startTime), ...state.bookmarks.map((r) => r.dateAdded)].filter(
    (t) => t !== null && t !== undefined && !isNaN(t)
  );
  const earliest = allTimes.length ? Math.min(...allTimes) : null;
  const latest = allTimes.length ? Math.max(...allTimes) : null;
  const uniqueDomains = new Set([...state.history.map((r) => domainOf(r.url)), ...state.bookmarks.map((r) => domainOf(r.url))].filter(Boolean));
  const searchQueriesFound = state.history.filter((r) => r.searchTerm).length;
  const chromeFlaggedDownloads = state.downloads.filter((r) => r.dangerType && r.dangerType.startsWith('FLAGGED')).length;
  const heuristicFlaggedHistory = state.filtered.history.filter((r) => r.flagCount > 0).length;
  const heuristicFlaggedDownloads = state.filtered.downloads.filter((r) => r.flagCount > 0).length;
  const heuristicFlaggedBookmarks = state.filtered.bookmarks.filter((r) => r.flagCount > 0).length;

  grid.innerHTML = [
    statCard('Files loaded', state.files.length),
    statCard('History entries (filtered)', state.filtered.history.length.toLocaleString()),
    statCard('Download entries (filtered)', state.filtered.downloads.length.toLocaleString()),
    statCard('Bookmark entries (filtered)', state.filtered.bookmarks.length.toLocaleString()),
    statCard('Unique domains visited', uniqueDomains.size.toLocaleString()),
    statCard('Search engine queries found', searchQueriesFound.toLocaleString()),
    statCard('Chrome-flagged (dangerous) downloads', chromeFlaggedDownloads, chromeFlaggedDownloads > 0 ? 'state-dangerous' : ''),
    statCard('Heuristic/IOC-flagged history (filtered)', heuristicFlaggedHistory, heuristicFlaggedHistory > 0 ? 'state-dangerous' : ''),
    statCard('Heuristic/IOC-flagged downloads (filtered)', heuristicFlaggedDownloads, heuristicFlaggedDownloads > 0 ? 'state-dangerous' : ''),
    statCard('Heuristic/IOC-flagged bookmarks (filtered)', heuristicFlaggedBookmarks, heuristicFlaggedBookmarks > 0 ? 'state-dangerous' : ''),
    statCard(`Earliest activity (${state.displayTz})`, fmtTime(earliest)),
    statCard(`Latest activity (${state.displayTz})`, fmtTime(latest)),
  ].join('');

  const filesBody = document.getElementById('filesBody');
  filesBody.innerHTML = '';
  for (const f of state.files) {
    const fh = state.history.filter((r) => r.source === f.name).map((r) => r.visitTime).filter((t) => t !== null && !isNaN(t));
    const fd = state.downloads.filter((r) => r.source === f.name).map((r) => r.startTime).filter((t) => t !== null && !isNaN(t));
    const fb = state.bookmarks.filter((r) => r.source === f.name).map((r) => r.dateAdded).filter((t) => t !== null && !isNaN(t));
    const all = [...fh, ...fd, ...fb];
    const e = all.length ? Math.min(...all) : null;
    const l = all.length ? Math.max(...all) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${escAttr(f.name)}">${esc(truncate(f.name, 40))}</td>
      <td><span class="badge badge-${f.browserType}">${esc(browserLabel(f.browserType))}</span></td>
      <td class="mono" title="${f.hash}">${f.hash.slice(0, 16)}…</td>
      <td>${f.historyCount.toLocaleString()}</td>
      <td>${f.downloadsCount.toLocaleString()}</td>
      <td>${(f.bookmarksCount || 0).toLocaleString()}</td>
      <td class="time-cell">${fmtTime(e)}</td>
      <td class="time-cell">${fmtTime(l)}</td>
    `;
    filesBody.appendChild(tr);
  }

  renderHistogram();
}

/* ---------------------------------------------------------------------
 * Activity-over-time histogram (Summary tab) — dependency-free inline
 * SVG, bucketed adaptively based on the span of the currently filtered
 * data, showing history visits vs. downloads per bucket.
 * ------------------------------------------------------------------- */
const HISTOGRAM_GRANULARITIES = [
  { label: 'hour', ms: 3600e3 },
  { label: '6 hours', ms: 6 * 3600e3 },
  { label: 'day', ms: 86400e3 },
  { label: 'week', ms: 7 * 86400e3 },
  { label: 'month', ms: 30 * 86400e3 },
];

function computeHistogramBuckets() {
  const events = [];
  for (const r of state.filtered.history) if (r.visitTime !== null && r.visitTime !== undefined && !isNaN(r.visitTime)) events.push({ t: r.visitTime, type: 'history' });
  for (const r of state.filtered.downloads) if (r.startTime !== null && r.startTime !== undefined && !isNaN(r.startTime)) events.push({ t: r.startTime, type: 'downloads' });
  if (!events.length) return null;

  const minT = Math.min(...events.map((e) => e.t));
  const maxT = Math.max(...events.map((e) => e.t));
  const span = Math.max(1, maxT - minT);

  let gran = HISTOGRAM_GRANULARITIES[HISTOGRAM_GRANULARITIES.length - 1];
  for (const g of HISTOGRAM_GRANULARITIES) {
    if (span / g.ms <= 60) { gran = g; break; }
  }

  const bucketStart = Math.floor(minT / gran.ms) * gran.ms;
  const bucketCount = Math.floor((maxT - bucketStart) / gran.ms) + 1;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({ t: bucketStart + i * gran.ms, history: 0, downloads: 0 }));

  for (const e of events) {
    const idx = Math.floor((e.t - bucketStart) / gran.ms);
    if (buckets[idx]) buckets[idx][e.type]++;
  }

  return { buckets, granularity: gran };
}

function fmtBucketLabel(t, granLabel) {
  const d = new Date(t);
  const tz = state.displayTz || 'UTC';
  const opts = { timeZone: tz };
  if (granLabel === 'hour' || granLabel === '6 hours') Object.assign(opts, { month: 'short', day: 'numeric', hour: '2-digit', hour12: false });
  else if (granLabel === 'day' || granLabel === 'week') Object.assign(opts, { month: 'short', day: 'numeric' });
  else Object.assign(opts, { year: 'numeric', month: 'short' });
  try { return new Intl.DateTimeFormat('en-US', opts).format(d); } catch (e) { return d.toISOString(); }
}

function renderHistogram() {
  const container = document.getElementById('histogramContainer');
  const data = computeHistogramBuckets();
  if (!data) {
    container.innerHTML = '<p class="hint">No timestamped activity to chart yet.</p>';
    return;
  }
  const { buckets, granularity } = data;
  const barW = 14;
  const gap = 3;
  const chartH = 140;
  const axisH = 20;
  const margin = 28;
  const plotW = Math.max(buckets.length * (barW + gap), 300);
  const svgW = plotW + margin * 2;
  const maxTotal = Math.max(1, ...buckets.map((b) => b.history + b.downloads));

  let bars = '';
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));
  buckets.forEach((b, i) => {
    const total = b.history + b.downloads;
    const hHeight = total ? (b.history / maxTotal) * chartH : 0;
    const dHeight = total ? (b.downloads / maxTotal) * chartH : 0;
    const x = margin + i * (barW + gap);
    const histY = chartH - hHeight;
    const dlY = histY - dHeight;
    const label = fmtBucketLabel(b.t, granularity.label);
    bars += `<g><title>${esc(label)}: ${b.history} history, ${b.downloads} downloads</title>`;
    if (b.history) bars += `<rect x="${x}" y="${histY}" width="${barW}" height="${Math.max(hHeight, 1)}" fill="var(--accent)" rx="1"></rect>`;
    if (b.downloads) bars += `<rect x="${x}" y="${dlY}" width="${barW}" height="${Math.max(dHeight, 1)}" fill="var(--amber)" rx="1"></rect>`;
    if (!total) bars += `<rect x="${x}" y="${chartH - 1}" width="${barW}" height="1" fill="var(--border)"></rect>`;
    bars += '</g>';
    if (i % labelEvery === 0) {
      bars += `<text x="${x + barW / 2}" y="${chartH + 14}" font-size="10" text-anchor="middle" fill="var(--text-faint)">${esc(label)}</text>`;
    }
  });

  container.innerHTML = `
    <div class="histogram-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>History visits</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--amber)"></span>Downloads</span>
      <span class="hint">Bucketed by ${esc(granularity.label)} &middot; ${buckets.length.toLocaleString()} bucket${buckets.length === 1 ? '' : 's'}</span>
    </div>
    <div class="histogram-scroll">
      <svg width="${svgW}" height="${chartH + axisH + 20}" viewBox="0 0 ${svgW} ${chartH + axisH + 20}">
        <line x1="${margin}" y1="${chartH}" x2="${svgW - margin}" y2="${chartH}" stroke="var(--border)" stroke-width="1"></line>
        ${bars}
      </svg>
    </div>
  `;
}

function updateHeaderStatus() {
  const el = document.getElementById('headerStatus');
  el.innerHTML = `
    <span class="pill pill-ok">${state.files.length} file(s) loaded</span>
    <span class="pill">${state.history.length.toLocaleString()} history rows</span>
    <span class="pill">${state.downloads.length.toLocaleString()} downloads</span>
    <span class="pill">${state.bookmarks.length.toLocaleString()} bookmarks</span>
  `;
}

function populateSourceFilter() {
  const sel = document.getElementById('sourceFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="all">All loaded files</option>';
  for (const f of state.files) {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = `${f.name} (${browserLabel(f.browserType)})`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function onDataChanged() {
  document.getElementById('controlsPanel').hidden = false;
  document.getElementById('tabs').hidden = false;
  document.getElementById('mainContent').hidden = false;
  updateHeaderStatus();
  populateSourceFilter();
  buildVisitIndex();
  applyFiltersAndRender();
}

/* ---------------------------------------------------------------------
 * Navigation chain — reconstructs "how did the user get here" using each
 * browser's referring-visit link (Chromium visits.from_visit / Firefox
 * moz_historyvisits.from_visit). Not available for Safari (no such chain
 * is recorded in History.db).
 * ------------------------------------------------------------------- */
function buildVisitIndex() {
  state.visitIndex = new Map();
  for (const r of state.history) {
    if (r.chainKey) state.visitIndex.set(r.chainKey, r);
  }
}

function getNavigationChain(record, maxHops) {
  if (!record.chainKey) return null;
  const limit = maxHops || 25;
  const chain = [record];
  const seen = new Set([record.chainKey]);
  let cur = record;
  while (cur.chainFromKey && chain.length < limit) {
    const prev = state.visitIndex.get(cur.chainFromKey);
    if (!prev || seen.has(prev.chainKey)) break;
    chain.unshift(prev);
    seen.add(prev.chainKey);
    cur = prev;
  }
  return chain;
}

function renderChainSteps(chain) {
  return '<ol class="chain-list">' + chain.map((r, i) => {
    const isCurrent = i === chain.length - 1;
    return `
      <li class="${isCurrent ? 'chain-current' : ''}">
        <div class="chain-time">${fmtTime(r.visitTime)}${isCurrent ? ' — this page' : ''}</div>
        <div class="chain-title">${esc(r.title) || '(no title)'}</div>
        <div class="chain-url">${esc(displayUrl(r.url))}</div>
        <div class="chain-transition">${esc(r.transition) || '—'}</div>
      </li>`;
  }).join('') + '</ol>';
}

function showNavigationChainModal(record) {
  const overlay = document.getElementById('chainModalOverlay');
  const body = document.getElementById('chainModalBody');
  if (!record.chainKey) {
    body.innerHTML = `<p class="hint">Navigation-chain data isn't available for ${esc(browserLabel(record.browserType))} history — only Chromium and Firefox record which visit a page came from.</p>`;
  } else {
    const chain = getNavigationChain(record);
    if (chain.length <= 1) {
      body.innerHTML = `<p class="hint">No referring page found in the loaded history — this looks like a direct navigation (typed URL, bookmark, new tab), or the referring visit has aged out.</p>${renderChainSteps(chain)}`;
    } else {
      body.innerHTML = `<p class="hint">${chain.length} steps, oldest first — the highlighted entry is the page you clicked.</p>${renderChainSteps(chain)}`;
    }
  }
  overlay.hidden = false;
}
function hideNavigationChainModal() {
  document.getElementById('chainModalOverlay').hidden = true;
}

/* ---------------------------------------------------------------------
 * CSV export
 * ------------------------------------------------------------------- */
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function exportCsv() {
  const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
  const tzSlug = state.displayTz.replace(/[^A-Za-z0-9]/g, '_');
  let rows;
  let headers;
  let mapper;
  let exportSlug = 'history';
  const flagsCsv = (r) => (r.flags || []).map((f) => f.label).join('; ');
  if (activeTab === 'downloads') {
    exportSlug = 'downloads';
    rows = state.filtered.downloads;
    headers = [`start_time_${tzSlug}`, `end_time_${tzSlug}`, 'file_name', 'target_path', 'url', 'referrer', 'total_bytes', 'state', 'mime_type', 'danger_flag', 'opened_by_user', `last_opened_${tzSlug}`, 'flags', 'browser', 'source_file'];
    mapper = (r) => [
      fmtTime(r.startTime), fmtTime(r.endTime), r.fileName, r.targetPath, displayUrl(r.url), displayUrl(r.referrer), r.totalBytes, r.state, r.mimeType, r.dangerType,
      r.opened === null || r.opened === undefined ? '' : (r.opened ? 'Yes' : 'No'), fmtTime(r.lastAccessTime), flagsCsv(r),
      browserLabel(r.browserType), r.source,
    ];
  } else if (activeTab === 'bookmarks') {
    exportSlug = 'bookmarks';
    rows = state.filtered.bookmarks;
    headers = [`date_added_${tzSlug}`, 'title', 'url', 'folder', 'flags', 'browser', 'source_file'];
    mapper = (r) => [fmtTime(r.dateAdded), r.title, displayUrl(r.url), r.folder, flagsCsv(r), browserLabel(r.browserType), r.source];
  } else {
    rows = state.filtered.history;
    headers = [`visit_time_${tzSlug}`, 'title', 'url', 'search_term', 'visit_count', 'transition', 'flags', 'browser', 'source_file'];
    mapper = (r) => [fmtTime(r.visitTime), r.title, displayUrl(r.url), r.searchTerm, r.visitCount, r.transition, flagsCsv(r), browserLabel(r.browserType), r.source];
  }
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(mapper(r).map(csvEscape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `browser-triage-${exportSlug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------
 * UI wiring
 * ------------------------------------------------------------------- */
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');

document.getElementById('browseBtn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { handleFiles([...e.target.files]); fileInput.value = ''; });

['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
);
dropZone.addEventListener('drop', (e) => { handleFiles([...e.dataTransfer.files]); });

document.getElementById('quickRange').addEventListener('change', (e) => {
  const v = e.target.value;
  document.getElementById('customRangeGroup').hidden = v !== 'custom';
  if (v !== 'custom') {
    setRangeFromQuick(v);
    applyFiltersAndRender();
  }
});
function setRangeFromQuick(v) {
  const now = Date.now();
  const spans = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
  if (v === 'all') { state.range.from = null; state.range.to = null; }
  else { state.range.to = now; state.range.from = now - spans[v]; }
}
document.getElementById('applyRangeBtn').addEventListener('click', () => {
  const fromV = document.getElementById('fromInput').value;
  const toV = document.getElementById('toInput').value;
  state.range.from = fromV ? zonedTimeToUtc(fromV, state.displayTz) : null;
  state.range.to = toV ? zonedTimeToUtc(toV, state.displayTz) : null;
  applyFiltersAndRender();
});

/* ---------------------------------------------------------------------
 * Settings persistence — theme, timezone, page size, and the IOC/keyword
 * watchlists are remembered locally (localStorage) between visits.
 * Deliberately NOT persisted: any loaded browser history/downloads data,
 * or current search/filter/sort state — a forensics tool shouldn't leave
 * a case's browsing history sitting in its own browser storage.
 * ------------------------------------------------------------------- */
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* localStorage unavailable (e.g. private mode) */ }
}
function loadSetting(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function clearSetting(key) {
  try { localStorage.removeItem(key); } catch (e) { /* localStorage unavailable */ }
}

function flashSaved(btn, label) {
  if (btn.dataset.flashing) return;
  btn.dataset.flashing = '1';
  const original = btn.textContent;
  btn.textContent = label || 'Saved ✓';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
    delete btn.dataset.flashing;
  }, 1200);
}

document.getElementById('tzSelect').addEventListener('change', (e) => {
  state.displayTz = e.target.value;
  saveSetting('browserTriageTz', state.displayTz);
  updateTzLabels();
  applyFiltersAndRender();
});
populateTzSelect();
const savedTz = loadSetting('browserTriageTz');
if (savedTz && [...document.getElementById('tzSelect').options].some((o) => o.value === savedTz)) {
  state.displayTz = savedTz;
  document.getElementById('tzSelect').value = savedTz;
}
updateTzLabels();

function initTheme() {
  const sel = document.getElementById('themeSelect');
  const saved = loadSetting('browserTriageTheme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  sel.value = saved;
  sel.addEventListener('change', () => {
    document.documentElement.setAttribute('data-theme', sel.value);
    saveSetting('browserTriageTheme', sel.value);
  });
}
initTheme();

(function initPageSize() {
  const sel = document.getElementById('pageSizeSelect');
  const saved = parseInt(loadSetting('browserTriagePageSize'), 10);
  if ([100, 250, 500, 1000].includes(saved)) {
    state.pageSize = saved;
    sel.value = String(saved);
  }
})();

(function initWatchlists() {
  const savedIoc = loadSetting('browserTriageIoc');
  if (savedIoc) {
    document.getElementById('iocTextarea').value = savedIoc;
    applyIocList(savedIoc);
  }
  const savedKeywords = loadSetting('browserTriageKeywords');
  if (savedKeywords) {
    document.getElementById('keywordTextarea').value = savedKeywords;
    applyKeywordList(savedKeywords);
  }
})();

document.getElementById('searchInput').addEventListener('input', debounce(applyFiltersAndRender, 150));
document.getElementById('sourceFilter').addEventListener('change', applyFiltersAndRender);
document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
document.getElementById('flaggedOnlyToggle').addEventListener('change', (e) => {
  state.flaggedOnly = e.target.checked;
  applyFiltersAndRender();
});

document.getElementById('historyBody').addEventListener('click', (e) => {
  const cell = e.target.closest('.url-clickable');
  if (!cell) return;
  const record = state.history.find((r) => r.id === cell.dataset.recordId);
  if (record) showNavigationChainModal(record);
});
document.getElementById('chainModalClose').addEventListener('click', hideNavigationChainModal);
document.getElementById('chainModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'chainModalOverlay') hideNavigationChainModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('chainModalOverlay').hidden) hideNavigationChainModal();
});

document.getElementById('defangToggle').addEventListener('change', (e) => {
  state.defangUrls = e.target.checked;
  saveSetting('browserTriageDefang', state.defangUrls ? '1' : '0');
  renderHistory();
  renderDownloads();
  renderBookmarks();
});
(function initDefangToggle() {
  const saved = loadSetting('browserTriageDefang');
  if (saved !== null) {
    state.defangUrls = saved === '1';
    document.getElementById('defangToggle').checked = state.defangUrls;
  }
})();

document.getElementById('historyPrevBtn').addEventListener('click', () => goToPage('history', state.page.history - 1));
document.getElementById('historyNextBtn').addEventListener('click', () => goToPage('history', state.page.history + 1));
document.getElementById('downloadsPrevBtn').addEventListener('click', () => goToPage('downloads', state.page.downloads - 1));
document.getElementById('downloadsNextBtn').addEventListener('click', () => goToPage('downloads', state.page.downloads + 1));
document.getElementById('bookmarksPrevBtn').addEventListener('click', () => goToPage('bookmarks', state.page.bookmarks - 1));
document.getElementById('bookmarksNextBtn').addEventListener('click', () => goToPage('bookmarks', state.page.bookmarks + 1));

document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
  state.pageSize = parseInt(e.target.value, 10);
  state.page.history = 1;
  state.page.downloads = 1;
  state.page.bookmarks = 1;
  saveSetting('browserTriagePageSize', String(state.pageSize));
  renderHistory();
  renderDownloads();
  renderBookmarks();
});

function applyIocList(text) {
  const set = new Set();
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.split(',')[0].trim();
    line = line.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].split(':')[0];
    line = line.replace(/^www\./i, '').toLowerCase();
    if (line) set.add(line);
  }
  state.iocSet = set;
  document.getElementById('iocCountPill').textContent = `${set.size.toLocaleString()} indicator${set.size === 1 ? '' : 's'} loaded`;
  applyFiltersAndRender();
}
document.getElementById('iocFileBtn').addEventListener('click', () => document.getElementById('iocFileInput').click());
document.getElementById('iocFileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  const ta = document.getElementById('iocTextarea');
  ta.value = ta.value.trim() ? `${ta.value.trim()}\n${text}` : text;
  e.target.value = '';
});
document.getElementById('iocApplyBtn').addEventListener('click', () => {
  applyIocList(document.getElementById('iocTextarea').value);
});
document.getElementById('iocSaveBtn').addEventListener('click', (e) => {
  saveSetting('browserTriageIoc', document.getElementById('iocTextarea').value);
  flashSaved(e.currentTarget);
});
document.getElementById('iocClearBtn').addEventListener('click', () => {
  document.getElementById('iocTextarea').value = '';
  applyIocList('');
  clearSetting('browserTriageIoc');
});

function applyKeywordList(text) {
  const list = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim().toLowerCase();
    if (!line || line.startsWith('#')) continue;
    list.push(line);
  }
  state.keywordList = list;
  document.getElementById('keywordCountPill').textContent = `${list.length.toLocaleString()} keyword${list.length === 1 ? '' : 's'} loaded`;
  applyFiltersAndRender();
}
document.getElementById('keywordFileBtn').addEventListener('click', () => document.getElementById('keywordFileInput').click());
document.getElementById('keywordFileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  const ta = document.getElementById('keywordTextarea');
  ta.value = ta.value.trim() ? `${ta.value.trim()}\n${text}` : text;
  e.target.value = '';
});
document.getElementById('keywordApplyBtn').addEventListener('click', () => {
  applyKeywordList(document.getElementById('keywordTextarea').value);
});
document.getElementById('keywordSaveBtn').addEventListener('click', (e) => {
  saveSetting('browserTriageKeywords', document.getElementById('keywordTextarea').value);
  flashSaved(e.currentTarget);
});
document.getElementById('keywordClearBtn').addEventListener('click', () => {
  document.getElementById('keywordTextarea').value = '';
  applyKeywordList('');
  clearSetting('browserTriageKeywords');
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('Clear all loaded data?')) return;
  state.files = [];
  state.history = [];
  state.downloads = [];
  state.bookmarks = [];
  state.filtered = { history: [], downloads: [], bookmarks: [] };
  state.range = { from: null, to: null };
  state.flaggedOnly = false;
  state.page = { history: 1, downloads: 1, bookmarks: 1 };
  state.visitIndex = new Map();
  document.getElementById('quickRange').value = 'all';
  document.getElementById('customRangeGroup').hidden = true;
  document.getElementById('searchInput').value = '';
  document.getElementById('flaggedOnlyToggle').checked = false;
  document.getElementById('loadLog').innerHTML = '';
  document.getElementById('controlsPanel').hidden = true;
  document.getElementById('tabs').hidden = true;
  document.getElementById('mainContent').hidden = true;
  document.getElementById('headerStatus').innerHTML = '<span class="pill pill-muted">No file loaded</span>';
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

function toggleSort(tab, th, tableSel) {
  const key = th.dataset.sort;
  const cur = state.sort[tab];
  if (cur.key === key) cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
  else { cur.key = key; cur.dir = 'asc'; }
  document.querySelectorAll(`${tableSel} th`).forEach((h) => h.classList.remove('sorted-asc', 'sorted-desc'));
  th.classList.add(cur.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  state.page[tab] = 1;
  sortData(tab);
  if (tab === 'history') renderHistory();
  else if (tab === 'downloads') renderDownloads();
  else renderBookmarks();
}
document.querySelectorAll('#historyTable th.sortable').forEach((th) => th.addEventListener('click', () => toggleSort('history', th, '#historyTable')));
document.querySelectorAll('#downloadsTable th.sortable').forEach((th) => th.addEventListener('click', () => toggleSort('downloads', th, '#downloadsTable')));
document.querySelectorAll('#bookmarksTable th.sortable').forEach((th) => th.addEventListener('click', () => toggleSort('bookmarks', th, '#bookmarksTable')));
