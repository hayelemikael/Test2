-- Fresh install schema (v2). Existing databases upgrade themselves automatically on the first request.
CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vehicles (
  plate TEXT PRIMARY KEY, driver TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL, next_start_km REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'any', pin_ver INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, shift_date TEXT NOT NULL,
  status TEXT NOT NULL, form TEXT NOT NULL, calc TEXT NOT NULL, hash TEXT NOT NULL,
  submitted_by TEXT, approved_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_shifts_plate ON shifts(plate, shift_date);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, shift_id INTEGER, detail TEXT);
CREATE TABLE IF NOT EXISTS attempts (k TEXT PRIMARY KEY, n INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL, lookup TEXT NOT NULL,
  ver INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_managers_lookup ON managers(lookup);
INSERT OR IGNORE INTO config(k,v) VALUES('schema_ver','2');
