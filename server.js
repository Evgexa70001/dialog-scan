const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

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

function authOk(req) {
  if (!INGEST_SECRET) return true;
  const header = String(req.get('authorization') || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const token = bearer || String(req.get('x-debug-token') || '').trim();
  return token === INGEST_SECRET;
}

function summary(scan) {
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
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, scans: readScans().length });
});

app.get('/api/dialog-scans', (_req, res) => {
  const scans = readScans()
    .slice()
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
    .map(summary);
  res.json({ ok: true, items: scans });
});

app.get('/api/dialog-scans/:id', (req, res) => {
  const scan = readScans().find((item) => item.id === req.params.id);
  if (!scan) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, scan });
});

app.post('/api/dialog-scans', (req, res) => {
  if (!authOk(req)) {
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

  const scans = readScans();
  scans.unshift(scan);
  if (scans.length > MAX_SCANS) scans.length = MAX_SCANS;
  writeScans(scans);

  res.status(201).json({ ok: true, id: scan.id, captured: scan.captured });
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`[dialog-scan-debug] listening on :${PORT}`);
  if (!INGEST_SECRET) {
    console.warn('[dialog-scan-debug] INGEST_SECRET is empty — ingest is open');
  }
});
