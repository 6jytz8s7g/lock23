// Shared resource lockout board — WRL team
// Node + Express + SQLite. Atomic, race-safe locking.

const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const PORT = process.env.PORT || 3000;
const RESOURCE = process.env.RESOURCE_NAME || 'Shared resource';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'lockout.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

// state: single row holding current lock. log: every session.
db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    locked  INTEGER NOT NULL DEFAULT 0,
    user    TEXT,
    since   INTEGER,
    log_id  INTEGER
  );
  CREATE TABLE IF NOT EXISTS log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user      TEXT NOT NULL,
    ts_in     INTEGER NOT NULL,
    ts_out    INTEGER
  );
  INSERT OR IGNORE INTO state (id, locked) VALUES (1, 0);
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function snapshot() {
  const state = db.prepare('SELECT locked, user, since FROM state WHERE id = 1').get();
  const log = db.prepare('SELECT user, ts_in, ts_out FROM log ORDER BY id DESC LIMIT 200').all();
  return {
    resource: RESOURCE,
    locked: !!state.locked,
    user: state.user,
    since: state.since,
    log: log.map(r => ({ user: r.user, in: r.ts_in, out: r.ts_out })),
  };
}

app.get('/api/state', (req, res) => res.json(snapshot()));

// Atomic claim: the UPDATE only succeeds if currently unlocked.
// Wrapped in a transaction so the log insert + state update are one unit.
function claim(name) {
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const info = db.prepare("UPDATE state SET locked = 1, user = ?, since = ? WHERE id = 1 AND locked = 0").run(name, now);
    if (Number(info.changes) === 0) { db.exec('ROLLBACK'); return { ok: false }; }
    const logRow = db.prepare('INSERT INTO log (user, ts_in) VALUES (?, ?)').run(name, now);
    db.prepare('UPDATE state SET log_id = ? WHERE id = 1').run(Number(logRow.lastInsertRowid));
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

app.post('/api/claim', (req, res) => {
  const name = (req.body.user || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = claim(name);
  if (!result.ok) return res.status(409).json({ error: 'Already locked', ...snapshot() });
  res.json(snapshot());
});

// Release: stamp the out time on the active log row, clear state.
function release() {
  db.exec('BEGIN IMMEDIATE');
  try {
    const state = db.prepare('SELECT log_id, locked FROM state WHERE id = 1').get();
    if (state.locked && state.log_id) {
      db.prepare('UPDATE log SET ts_out = ? WHERE id = ? AND ts_out IS NULL').run(Date.now(), state.log_id);
    }
    db.prepare('UPDATE state SET locked = 0, user = NULL, since = NULL, log_id = NULL WHERE id = 1').run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

app.post('/api/release', (req, res) => {
  release();
  res.json(snapshot());
});

app.listen(PORT, () => console.log(`Lockout board running on http://localhost:${PORT}  (resource: "${RESOURCE}")`));
