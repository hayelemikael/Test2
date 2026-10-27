import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from './etev-portal/src/worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'etev-portal', 'public');
const DB_PATH = path.join(__dirname, 'etev-fleet.sqlite');

function normParam(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

class D1PreparedStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = String(sql).replace(/""/g, "''");
    this.params = params.map(normParam);
  }
  bind(...params) {
    return new D1PreparedStatement(this.db, this.sql, params);
  }
  async first(colName) {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params);
    if (!row) return null;
    return colName ? row[colName] : row;
  }
  async all() {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.params);
    return { results: results || [], success: true, meta: {} };
  }
  async run() {
    const stmt = this.db.prepare(this.sql);
    const res = stmt.run(...this.params);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(res?.changes ?? 0),
        last_row_id: Number(res?.lastInsertRowid ?? 0),
      },
    };
  }
}

class D1Database {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = OFF;');
  }
  prepare(sql) {
    return new D1PreparedStatement(this.db, sql);
  }
  async batch(stmts) {
    const out = [];
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) {
        out.push(await s.run());
      }
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw e;
    }
  }
  async exec(sql) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
}

const d1 = new D1Database(DB_PATH);

const env = {
  DB: d1,
  SESSION_SECRET: process.env.SESSION_SECRET || 'etev-fleet-portal-local-session-secret-2026-key',
  SETUP_KEY: process.env.SETUP_KEY || 'etev-setup-key-2026',
  TG_TOKEN: process.env.TG_TOKEN || '',
  TG_CHAT_ID: process.env.TG_CHAT_ID || '',
  CF_API_TOKEN: process.env.CF_API_TOKEN || '',
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || '',
  GH_TOKEN: process.env.GH_TOKEN || '',
  GH_REPO: process.env.GH_REPO || 'hayelemikael/etev-fleet-portal',
};

const ctx = {
  waitUntil(promise) {
    Promise.resolve(promise).catch(err => console.error('[waitUntil error]', err));
  },
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
};

async function callWorker(pathUrl, method = 'GET', bodyObj = undefined, token = undefined) {
  const req = new Request(`http://127.0.0.1:3000${pathUrl}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
  });
  const res = await worker.fetch(req, env, ctx);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${pathUrl}: ${res.status} ${data.error || ''}`);
  }
  return data;
}

async function seedHistoricalShiftsIfNeeded() {
  try {
    // Ensure schema is up to date by making one light API call
    await callWorker('/api/plates');
    const shiftCountRow = d1.db.prepare('SELECT COUNT(*) AS n FROM shifts').get();
    if (shiftCountRow && Number(shiftCountRow.n) > 0) return;

    const vehicles = d1.db.prepare('SELECT plate, mode, driver, driver_id, next_start_km FROM vehicles ORDER BY plate').all();
    const drivers = d1.db.prepare('SELECT id, name, home_plate FROM drivers ORDER BY id').all();
    if (!vehicles.length) return;

    const addisDateStr = (daysAgo = 0) => {
      const ms = Date.now() + 3 * 3600e3 - daysAgo * 86400e3;
      return new Date(ms).toISOString().slice(0, 10);
    };

    const insertShift = d1.db.prepare(`
      INSERT INTO shifts (
        plate, shift_date, shift_no, driver_id, status, form, calc, hash,
        submitted_by, approved_by, created_at, updated_at,
        n_mode, n_km, n_dep, n_tele, n_due, n_cabbycash, n_yangocash,
        n_bonus, n_bonuspay, n_bd, n_sf, n_mp, n_pen, n_pfb, n_pd, n_waived,
        n_ot, n_otmin, n_wmin, n_pax, n_rgap, n_batt, n_clr, n_work, n_ref
      ) VALUES (
        ?, ?, ?, ?, 'APPROVED', ?, ?, ?,
        ?, 'Operations Manager', ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, 0, 0, 0, ?, ?, 0, 0,
        ?, ?, ?, ?, 0, ?, 1, ?, ?
      )
    `);

    const insertCharge = d1.db.prepare(`
      INSERT INTO charging (plate, chg_date, kwh, cost, soc_from, soc_to, odo_km, location, by_actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Test Fleet', ?)
    `);

    const odoMap = Object.fromEntries(vehicles.map((v, idx) => [v.plate, Number(v.next_start_km) || (idx + 1) * 1200]));

    d1.db.exec('BEGIN');
    try {
      // Seed 30 days of approved shifts (from 29 days ago up to today)
      for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
        const shiftDate = addisDateStr(daysAgo);
        const dayWave = Math.sin((29 - daysAgo) * 0.45) * 0.16 + Math.cos((29 - daysAgo) * 0.23) * 0.08;
        const growthFactor = 0.88 + ((29 - daysAgo) / 29) * 0.24 + dayWave;

        for (let vIdx = 0; vIdx < vehicles.length; vIdx++) {
          const v = vehicles[vIdx];
          // 12 out of 16 vehicles active on a given day in a deterministic rotation
          if ((daysAgo + vIdx) % 5 === 0 && daysAgo > 0) continue;

          const isRoute = v.mode === 'route';
          const drv = drivers.find(d => d.home_plate === v.plate) || drivers[vIdx % drivers.length] || { id: 1, name: v.driver || 'Driver 1' };
          const startKm = Math.round(odoMap[v.plate]);
          const baseKm = isRoute ? 148 + ((vIdx * 17 + daysAgo * 11) % 55) : 162 + ((vIdx * 19 + daysAgo * 13) % 68);
          const actualKm = Math.max(85, Math.round(baseKm * growthFactor));
          const chargingKm = 4 + ((vIdx + daysAgo) % 6);
          const endKm = startKm + actualKm;
          const nextDayStartKm = endKm + chargingKm;
          odoMap[v.plate] = nextDayStartKm;

          const batterySoc = 34 + ((vIdx * 7 + daysAgo * 5) % 52);
          const tsIso = `${shiftDate}T18:30:00.000Z`;
          const txnRef = `TXN-${shiftDate.replace(/-/g, '')}-${v.plate.replace(/[^A-Z0-9]/g, '')}`;

          if (isRoute) {
            const roundTrips = 5 + ((vIdx + daysAgo) % 4);
            const tripsCount = roundTrips * 2;
            const paxFull = tripsCount * (8 + ((vIdx + daysAgo) % 4));
            const paxShort = tripsCount * (3 + ((vIdx + daysAgo) % 3));
            const passengers = paxFull + paxShort;
            const expectedRevenue = paxFull * 60 + paxShort * 30;
            const teleTotal = Math.round(expectedRevenue * (0.28 + ((vIdx + daysAgo) % 10) * 0.015));
            const cashDeposited = expectedRevenue - teleTotal;
            const routeTarget = 3200;
            const routeBonus = expectedRevenue >= routeTarget ? 250 + ((vIdx + daysAgo) % 3) * 50 : 0;
            const workMinutes = 480 + ((vIdx + daysAgo) % 4) * 20;
            const overtimeMinutes = Math.max(0, workMinutes - 480);
            const overtimePay = Math.round((overtimeMinutes / 60) * 60);

            const form = {
              plate: v.plate,
              driverId: drv.id,
              driverName: drv.name,
              shiftDate,
              shiftNo: 1,
              mode: 'route',
              routeId: 'at-4k-meg',
              routeName: 'አውቶቡስ ተራ – 4 ኪሎ – መገናኛ',
              roundTrips,
              startKm,
              endKm,
              chargingKm,
              batteryStart: Math.min(98, batterySoc + 45),
              batterySoc,
              routeCash: cashDeposited,
              teleTotal,
              cashDeposited,
              txnRef,
            };
            const calc = {
              ...form,
              actualKm,
              nextDayStartKm,
              passengers,
              paxFull,
              paxShort,
              expectedRevenue,
              cashTotal: cashDeposited,
              totalCashDue: cashDeposited,
              cashVariance: 0,
              shortfall: 0,
              bonusDeduction: 0,
              driverMustPay: 0,
              kmState: 'MATCH',
              excessKm: 0,
              kmPenaltyEtb: 0,
              penaltyFromBonus: 0,
              penaltyDebt: 0,
              routeTarget,
              routeRevenue: expectedRevenue,
              routePct: Math.round((expectedRevenue / routeTarget) * 1000) / 10,
              routeBonus,
              totalCombinedBonus: routeBonus,
              netDriverBalance: routeBonus,
              workMinutes,
              overtimeMinutes,
              overtimePay,
              isCleared: true,
              supervisor: 'Operations Manager',
              hash: `ETEV-${shiftDate.slice(5).replace('-', '')}${v.plate.slice(-2)}`,
            };

            insertShift.run(
              v.plate, shiftDate, 1, drv.id, JSON.stringify(form), JSON.stringify(calc), calc.hash,
              drv.name, tsIso, tsIso,
              'route', actualKm, cashDeposited, teleTotal, cashDeposited, cashDeposited, 0,
              routeBonus, routeBonus, 0, 0,
              overtimePay, overtimeMinutes, workMinutes, passengers, batterySoc, roundTrips, txnRef.toLowerCase()
            );
          } else {
            const cabbyTrips = Math.max(12, Math.round((16 + ((vIdx * 3 + daysAgo * 2) % 10)) * growthFactor));
            const yangoTrips = Math.max(4, Math.round((7 + ((vIdx * 2 + daysAgo) % 7)) * growthFactor));
            const cabbyKm = Math.round(actualKm * 0.68);
            const yangoKm = Math.max(10, actualKm - cabbyKm - 3);
            const cabbyAccept = 88 + ((vIdx + daysAgo) % 11);
            const cabbyCash = Math.round(cabbyTrips * (175 + ((vIdx * 7 + daysAgo * 3) % 35)));
            const yangoCash = Math.round(yangoTrips * (155 + ((vIdx * 5 + daysAgo * 4) % 30)));
            const appCash = cabbyCash + yangoCash;
            const teleTotal = Math.round(appCash * (0.24 + ((vIdx + daysAgo) % 12) * 0.012));
            const totalCashDue = Math.max(0, appCash - teleTotal);
            const cashDeposited = totalCashDue;
            const cabbyBonus = cabbyTrips <= 20 ? cabbyTrips * 15 : 20 * 15 + (cabbyTrips - 20) * 25;
            const yangoBonus = yangoTrips >= 8 ? yangoTrips * 12 : 0;
            const totalCombinedBonus = cabbyBonus + yangoBonus;
            const workMinutes = 495 + ((vIdx + daysAgo) % 3) * 15;
            const overtimeMinutes = Math.max(0, workMinutes - 480);
            const overtimePay = Math.round((overtimeMinutes / 60) * 60);

            const form = {
              plate: v.plate,
              driverId: drv.id,
              driverName: drv.name,
              shiftDate,
              shiftNo: 1,
              mode: 'cabby',
              startKm,
              endKm,
              chargingKm,
              batterySoc,
              cabbyTrips,
              cabbyKm,
              cabbyAccept,
              cabbyCash,
              yangoTrips,
              yangoKm,
              yangoCash,
              teleTotal,
              cashDeposited,
              txnRef,
              shiftStart: '07:30',
              shiftEnd: '16:15',
            };
            const calc = {
              ...form,
              actualKm,
              nextDayStartKm,
              appTotalKm: cabbyKm + yangoKm,
              authorizedCeilingKm: cabbyKm + yangoKm + 15,
              kmState: 'MATCH',
              excessKm: 0,
              kmPenaltyEtb: 0,
              cabbyBonus,
              cabbyTierText: cabbyTrips > 20 ? `Tier 2 (${cabbyTrips} trips)` : `Tier 1 (${cabbyTrips} trips)`,
              yangoBonus,
              yangoTierText: yangoBonus > 0 ? `Tier 2 (${yangoTrips} trips)` : 'Tier 1 (0 ETB)',
              totalCombinedBonus,
              cashRule: 2,
              appCash,
              totalCashDue,
              cashDeposited,
              cashVariance: 0,
              shortfall: 0,
              bonusDeduction: 0,
              driverMustPay: 0,
              penaltyFromBonus: 0,
              penaltyDebt: 0,
              netDriverBalance: totalCombinedBonus,
              workMinutes,
              overtimeMinutes,
              overtimePay,
              isCleared: true,
              supervisor: 'Operations Manager',
              hash: `ETEV-${shiftDate.slice(5).replace('-', '')}${v.plate.slice(-2)}`,
            };

            const netCabbyCash = Math.round(cabbyCash - teleTotal * (cabbyCash / appCash));
            const netYangoCash = cashDeposited - netCabbyCash;

            insertShift.run(
              v.plate, shiftDate, 1, drv.id, JSON.stringify(form), JSON.stringify(calc), calc.hash,
              drv.name, tsIso, tsIso,
              'cabby', actualKm, cashDeposited, teleTotal, totalCashDue, netCabbyCash, netYangoCash,
              totalCombinedBonus, totalCombinedBonus, 0, 0,
              overtimePay, overtimeMinutes, workMinutes, 0, batterySoc, cabbyTrips + yangoTrips, txnRef.toLowerCase()
            );
          }

          // Also log EV charging every other shift
          if ((vIdx + daysAgo) % 2 === 0) {
            const kwh = Math.round((actualKm * 0.165 + ((vIdx + daysAgo) % 5)) * 10) / 10;
            const cost = Math.round(kwh * 4.5 * 100) / 100;
            insertCharge.run(v.plate, shiftDate, kwh, cost, batterySoc, 95, endKm, 'Bole EV Hub', tsIso);
          }
        }
      }

      // Update vehicles next_start_km to match latest odometer
      const updVeh = d1.db.prepare('UPDATE vehicles SET next_start_km = ? WHERE plate = ?');
      for (const [plate, km] of Object.entries(odoMap)) {
        updVeh.run(km, plate);
      }
      d1.db.exec('COMMIT');
      console.log('Seeded 30 days of historical approved shifts and EV charging records.');
    } catch (txErr) {
      try { d1.db.exec('ROLLBACK'); } catch {}
      throw txErr;
    }
  } catch (err) {
    console.error('Historical shift seeding warning:', err);
  }
}

async function seedIfNeeded() {
  try {
    const plates = await callWorker('/api/plates');
    if (plates.length < 16) {
      await callWorker('/api/setup', 'POST', {
        key: env.SETUP_KEY,
        adminPin: '202610',
        adminName: 'Test Admin',
        managers: [],
        vehicles: [
          { plate: 'TEST-C1', driver: 'Test Driver 1', phone: '0900000001', pin: '1111', nextStartKm: 1000, mode: 'cabby' },
          { plate: 'TEST-C2', driver: 'Test Driver 2', phone: '0900000002', pin: '2222', nextStartKm: 2000, mode: 'cabby' },
          { plate: 'TEST-R1', driver: 'Test Driver 3', phone: '0900000003', pin: '3333', nextStartKm: 3000, mode: 'route' },
          { plate: 'TEST-R2', driver: 'Test Driver 4', phone: '0900000004', pin: '4444', nextStartKm: 4000, mode: 'route' },
        ],
      });

      const { token } = await callWorker('/api/login', 'POST', { role: 'staff', pin: '202610' });

      await callWorker(
        '/api/admin/users',
        'PUT',
        [
          { name: 'Test Manager', role: 'manager', pin: '303030' },
          { name: 'Test Fleet', role: 'fleet', pin: '404040' },
          { name: 'Test Finance', role: 'finance', pin: '505050' },
          { name: 'Operations Manager', role: 'manager', pin: '123456' },
        ],
        token
      );

      const pad = n => String(n).padStart(2, '0');
      const V = [
        ...Array.from({ length: 10 }, (_, i) => ({ plate: `TEST-C${i + 1}`, mode: 'cabby' })),
        ...Array.from({ length: 6 }, (_, i) => ({ plate: `TEST-R${i + 1}`, mode: 'route' })),
      ];
      const have = (await callWorker('/api/fleet', 'GET', undefined, token)).drivers;
      const want = Array.from({ length: 37 }, (_, i) => i + 1)
        .filter(n => !have.some(d => d.name === `Test Driver ${n}`))
        .map(n => ({
          name: `Test Driver ${n}`,
          phone: `09000000${pad(n)}`,
          pin: n <= 4 ? String(n).repeat(4) : '1' + String(n).padStart(3, '0'),
          active: true,
        }));
      if (want.length) await callWorker('/api/fleet/drivers', 'PUT', want, token);

      const D = Object.fromEntries((await callWorker('/api/fleet', 'GET', undefined, token)).drivers.map(d => [d.name, d.id]));
      await callWorker(
        '/api/fleet/vehicles',
        'PUT',
        V.map((v, i) => ({
          plate: v.plate,
          mode: v.mode,
          driverId: D[`Test Driver ${i * 2 + 1}`],
          seats: v.mode === 'route' ? 12 : 4,
          ...(plates.some(p => p.plate === v.plate) ? {} : { nextStartKm: 1000 * (i + 1) }),
        })),
        token
      );

      const pairs = [];
      V.forEach((v, i) => {
        for (const sh of [1, 2]) {
          const n = i * 2 + sh;
          pairs.push({ driverId: D[`Test Driver ${n}`], homePlate: v.plate, homeShift: sh, restDow: n % 7, standby: false });
        }
      });
      for (let n = 33; n <= 37; n++) {
        pairs.push({ driverId: D[`Test Driver ${n}`], homePlate: '', homeShift: 1, restDow: (n * 3) % 7, standby: true });
      }
      await callWorker('/api/roster/pairings', 'PUT', pairs, token);
      console.log(`Initialized ETEV Fleet database with ${V.length} vehicles and ${Object.keys(D).length} drivers.`);
    }

    await seedHistoricalShiftsIfNeeded();
  } catch (err) {
    console.error('Database initialization warning:', err);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const fullUrl = new URL(req.url || '/', `${proto}://${host}`);

    if (fullUrl.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyBuffer = Buffer.concat(chunks);

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach(val => headers.append(k, val));
        else if (v !== undefined) headers.set(k, v);
      }
      if (!headers.has('cf-connecting-ip')) {
        headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
      }

      const webReq = new Request(fullUrl.toString(), {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : bodyBuffer,
      });

      const webRes = await worker.fetch(webReq, env, ctx);
      res.statusCode = webRes.status;
      webRes.headers.forEach((val, key) => {
        res.setHeader(key, val);
      });
      const arrayBuf = await webRes.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
      return;
    }

    // Serve static files from etev-portal/public
    let relPath = decodeURIComponent(fullUrl.pathname);
    if (relPath === '/') relPath = '/index.html';
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    if (relPath === '/sw.js' || relPath === '/app/app.json' || relPath === '/app/ETEV-Fleet.apk') {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (relPath === '/app/ETEV-Fleet.apk') {
      res.setHeader('Content-Disposition', 'attachment; filename="ETEV-Fleet.apk"');
    }

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

const PORT = Number(process.env.PORT) || 3000;
await seedIfNeeded();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ETEV Fleet Portal running on http://0.0.0.0:${PORT}`);
});
