const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseScanItems, countParsedKinds } = require('./lib/parse-dialog-items');

const PORT = Number(process.env.PORT || 3000);
const INGEST_SECRET = String(process.env.INGEST_SECRET || '').trim();
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'scans.json');
const MAX_SCANS = 500;

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readScans() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeScans(scans) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(scans, null, 2), 'utf8');
}

function shopKey(serverId, shopId) {
  return `${Number(serverId) || 0}:${Number(shopId)}`;
}

function normalizeOwner(value) {
  return String(value || '').trim().toLowerCase();
}

function ownerKey(serverId, ownerNickname) {
  const nick = normalizeOwner(ownerNickname);
  if (!nick) return null;
  return `${Number(serverId) || 0}:nick:${nick}`;
}

function upsertScan(scans, scan) {
  const shopKeyVal = shopKey(scan.server_id, scan.shop_id);
  const ownerKeyVal = ownerKey(scan.server_id, scan.owner_nickname);

  let existing = scans.find((item) => shopKey(item.server_id, item.shop_id) === shopKeyVal);
  if (!existing && ownerKeyVal) {
    existing = scans.find((item) => ownerKey(item.server_id, item.owner_nickname) === ownerKeyVal);
  }
  if (existing) scan.id = existing.id;

  const rest = scans.filter((item) => {
    if (shopKey(item.server_id, item.shop_id) === shopKeyVal) return false;
    if (ownerKeyVal && ownerKey(item.server_id, item.owner_nickname) === ownerKeyVal) return false;
    return true;
  });
  rest.unshift(scan);
  if (rest.length > MAX_SCANS) rest.length = MAX_SCANS;
  return { scans: rest, updated: Boolean(existing) };
}

function compactScans(scans) {
  const latest = new Map();
  for (const scan of scans) {
    const key = ownerKey(scan.server_id, scan.owner_nickname) || shopKey(scan.server_id, scan.shop_id);
    const prev = latest.get(key);
    if (!prev || String(scan.received_at).localeCompare(String(prev.received_at)) >= 0) {
      latest.set(key, scan);
    }
  }
  return Array.from(latest.values())
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
}

function authOk(req) {
  if (!INGEST_SECRET) return true;
  const header = String(req.get('authorization') || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const token = bearer || String(req.get('x-debug-token') || '').trim();
  return token === INGEST_SECRET;
}

function countByKind(scan) {
  const parsed = Array.isArray(scan.parsed_items) ? scan.parsed_items : null;
  if (parsed) return countParsedKinds(parsed);
  let sell = 0;
  let buy = 0;
  const items = scan.items;
  if (!Array.isArray(items)) return { sell, buy };
  for (const item of items) {
    if (item.kind === 'sell') sell += 1;
    else if (item.kind === 'buy') buy += 1;
  }
  return { sell, buy };
}

function ensureParsedScan(scan) {
  if (!scan || typeof scan !== 'object') return scan;
  scan.parsed_items = parseScanItems(scan.items);
  return scan;
}

function summary(scan) {
  ensureParsedScan(scan);
  const counts = countByKind(scan);
  return {
    id: scan.id,
    server_id: scan.server_id,
    shop_id: scan.shop_id,
    owner_nickname: scan.owner_nickname,
    scanned_at: scan.scanned_at,
    elapsed_sec: scan.elapsed_sec,
    queued: scan.queued,
    captured: scan.captured,
    received_at: scan.received_at,
    sell_count: counts.sell,
    buy_count: counts.buy,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, scans: readScans().length });
});

app.get('/api/dialog-scans', (_req, res) => {
  const scans = compactScans(readScans()).map(summary);
  res.json({ ok: true, items: scans });
});

app.get('/api/dialog-scans/:id', (req, res) => {
  const scan = readScans().find((item) => item.id === req.params.id);
  if (!scan) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, scan: ensureParsedScan({ ...scan }) });
});

app.post('/api/dialog-scans', (req, res) => {
  console.log('[ingest] POST /api/dialog-scans shop_id=%s auth=%s',
    req.body && req.body.shop_id,
    req.get('authorization') ? 'yes' : 'no');

  if (!authOk(req)) {
    console.warn('[ingest] unauthorized');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'invalid json body' });
  }

  const shopId = Number(body.shop_id);
  if (!Number.isFinite(shopId)) {
    return res.status(400).json({ ok: false, error: 'shop_id required' });
  }

  const scan = {
    id: crypto.randomUUID(),
    received_at: new Date().toISOString(),
    server_id: Number(body.server_id) || null,
    shop_id: shopId,
    owner_nickname: String(body.owner_nickname || ''),
    scanned_at: String(body.scanned_at || ''),
    elapsed_sec: Number(body.elapsed_sec) || 0,
    queued: Number(body.queued) || 0,
    captured: Number(body.captured) || 0,
    items: Array.isArray(body.items) ? body.items : [],
  };
  scan.parsed_items = parseScanItems(scan.items);

  const { scans, updated } = upsertScan(readScans(), scan);
  writeScans(scans);

  console.log('[ingest] %s id=%s shop=%s server=%s owner=%s captured=%s',
    updated ? 'updated' : 'created',
    scan.id, scan.shop_id, scan.server_id, scan.owner_nickname, scan.captured);
  res.status(updated ? 200 : 201).json({
    ok: true,
    id: scan.id,
    captured: scan.captured,
    updated,
  });
});

app.listen(PORT, () => {
  ensureStore();
  let raw = readScans();
  const compact = compactScans(raw);
  let changed = compact.length !== raw.length;
  raw = compact;
  for (const scan of raw) {
    const reparsed = parseScanItems(scan.items);
    const prev = JSON.stringify(scan.parsed_items || []);
    const next = JSON.stringify(reparsed);
    if (prev !== next) {
      scan.parsed_items = reparsed;
      changed = true;
    }
  }
  if (changed) {
    writeScans(raw);
    console.log('[dialog-scan-debug] stored scans=%s (compact/migrate parsed_items)', raw.length);
  }
  console.log(`[dialog-scan-debug] listening on :${PORT}`);
  if (!INGEST_SECRET) {
    console.warn('[dialog-scan-debug] INGEST_SECRET is empty — ingest is open');
  }
});
