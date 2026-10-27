/*
 * ETEV Fleet Portal
 * Copyright (c) 2026 Letarik Teshome. All rights reserved.
 * Developed by Letarik Teshome <letarikteshome49@gmail.com> · +251 910 022 051
 * Proprietary software. No copying, modification or redistribution without written permission. See LICENSE.
 */
// ETEV Fleet Portal API (Cloudflare Worker + D1). Secrets: SESSION_SECRET, SETUP_KEY, TG_TOKEN, TG_CHAT_ID
const APP = { name: 'ETEV Fleet Portal', version: '4.6', author: 'Letarik Teshome', contact: 'letarikteshome49@gmail.com', phone: '+251 910 022 051', copyright: '© 2026 Letarik Teshome. All rights reserved.' };
// Phase 2: per-manager logins, fixed Cabby/Route mode per vehicle, Telegram alerts + daily missing-report reminder, driver summary.
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const num = v => (Number.isFinite(+v) ? +v : 0);
const now = () => new Date().toISOString();
const addisDate = (offDays = 0) => new Date(Date.now() + 3 * 3600e3 - offDays * 864e5).toISOString().slice(0, 10); // Addis Ababa = UTC+3
const addisHour = () => new Date(Date.now() + 3 * 3600e3).getUTCHours();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (m, s = 400) => J({ error: m }, s);
const MAX_BODY = 64 * 1024;
const MAX_SHIFT_KM = 1000;

const DEF = {
  adminName: 'Super Admin', managerName: 'Fleet Manager', bufferKm: 30, penaltyRate: 20, minAccept: 90,
  cabbyT1Min: 1, cabbyT1Max: 5, cabbyT1Rate: 25, cabbyT2Rate: 45,
  yangoT2Min: 6, yangoT2Max: 8, yangoT2Rate: 35, yangoT3Rate: 60,
  whatsappAdmin: '', autoPushTg: true,
  alertsTg: true, lowBatteryPct: 20, lowBatteryPctCabby: 20, lowBatteryPctRoute: 25,
  batteryThresholds: {
    cabby: { warnPct: 25, alertPct: 20, lockGate: true },
    route: { warnPct: 30, alertPct: 25, lockGate: true },
    any:   { warnPct: 25, alertPct: 20, lockGate: true },
  },
  maxDailyKm: 400, reminderOn: true, reminderHour: 21,
  requirePhotos: false, photoKeepDays: 60, backupTg: false, serviceWarnKm: 500,
  standardHours: 8,
  overtimeRate: 0, // ETB per overtime hour (0 = overtime hours recorded but not paid in the payroll)
  // Expense categories; fleet: true = the Fleet Admin may record it with the "repairs" permission
  expenseCats: [{ id: 'repair', name: 'ጥገና · Repair', fleet: true }, { id: 'tyres', name: 'ጎማ · Tyres', fleet: true }, { id: 'insurance', name: 'ኢንሹራንስ · Insurance' },
    { id: 'parking', name: 'ፓርኪንግ · Parking' }, { id: 'other', name: 'ሌላ · Other' }],
  debtLockEtb: 500, // vehicle gate locks while the driver owes more than this (0 = never lock)
  // v4.3: day close, devices, breaks, incidents, personal Telegram
  groupTg: true, // the old shared Telegram group keeps getting messages until the switch to personal messages is finished
  deviceLock: false, // drivers may only sign in from phones the Fleet Admin approved (the first phone is approved by itself)
  // v4.9 📅 shifts: two shifts a day per group; the times are set in Admin
  shiftTimes: { cabby: [{ no: 1, name: 'ጠዋት', start: '06:00', end: '14:00' }, { no: 2, name: 'ከሰዓት', start: '14:00', end: '22:00' }],
    route: [{ no: 1, name: 'ጠዋት', start: '06:00', end: '14:00' }, { no: 2, name: 'ከሰዓት', start: '14:00', end: '22:00' }] },
  requireInspection: true, inspectWithinMin: 120, // 📋 a shift's inspection is due within this many minutes of its start
  leaveNoticeDays: 2, // 📅 a day off is asked at least this many days ahead (sick leave any time)
  // 🎯 Route target bonus, per shift: tiers by % of the route's target, or a % of the revenue above the target. Paid only with the cash fully deposited and no fares short.
  // 📈 Profit & loss: the platforms' commission (% of their fares) and fixed costs (insurance, bolo, loan/lease, parking/charging-site rent …)
  commission: { cabby: 0, yango: 0 }, fixedCosts: [],
  // 🎯 Monthly targets (monitoring only): defaults for every vehicle / driver; each one can have its own
  targets: { vehicle: { revenue: 0, net: 0, km: 0, trips: 0, pax: 0 }, driver: { revenue: 0, trips: 0, shifts: 0, km: 0, hours: 0 } },
  // 🟡 Yango weekly goal (per vehicle; both shift drivers share one Yango account). All or nothing. Drivers get sharePct % split by their Yango trips.
  yangoGoal: { tiers: [{ trips: 7, etb: 600 }, { trips: 15, etb: 1300 }, { trips: 30, etb: 2650 }, { trips: 45, etb: 4000 }, { trips: 60, etb: 5400 }, { trips: 80, etb: 7500 }, { trips: 100, etb: 10000 }], sharePct: 0, warnDow: 4 },
  // 📄 Documents with an expiry date. An expired one stops work unless the Super Admin permits it (with a reason, until a date)
  docTypes: [{ id: 'licence', name: 'መንጃ ፈቃድ (Driving licence)', for: 'driver', mode: 'any' }, { id: 'insurance', name: 'ኢንሹራንስ (Insurance)', for: 'vehicle', mode: 'any' },
    { id: 'bolo', name: 'ቦሎ (Annual inspection)', for: 'vehicle', mode: 'any' }, { id: 'routepermit', name: 'የመስመር ፈቃድ (Route permit)', for: 'vehicle', mode: 'route' }],
  docRemindDays: '30,7,1',
  // 🟣 Cabby Reserve runs (paid online, no cash): range, battery margin, bonus per run, how close a Cabby booking must be to a run to match it
  reserveRangeKm: 220, reserveBattMarginPct: 20, reserveBonusPerRun: 0, reserveMatchMin: 90,
  routeBonus: { mode: 'tiers', tiers: [{ pct: 100, etb: 150 }, { pct: 115, etb: 300 }, { pct: 130, etb: 500 }], pct: 10, cap: 0 }, routeMissAlert: 3,
  handoverGraceMin: 15, doubleShiftAfterMin: 120, maxDoubleWeek: 2, lateFreePerMonth: 3, // 🔁 handover: grace, when overtime becomes a double shift, double shifts per week, late arrivals a month before a fine
  teleStmtMode: 'smart', teleRandomPct: 10, // 📄 Telebirr statement: 'daily' = every day with payments; 'smart' = weekly + the days the portal asks for
  lateMarkHours: 3, // 🌙 a report sent more than this many hours after the work ended is marked "sent late"
  driverSessionDays: 7, driverMaxBackDays: 7, // drivers stay signed in; they may report up to N days back while the day is still open
  breakMaxMin: 60, breakMaxCount: 3, // a break longer than this, or more breaks than this in a day, is flagged
  closeRemindHour: 10, closeDeadlineHour: 12, digestHour: 7, // Addis clock hours: 10 = 4 ሰዓት, 12 = 6 ሰዓት, 7 = 1 ሰዓት
  quietHoursOn: false, quietStartHour: 22, quietEndHour: 6, // 🌙 Quiet hours (Addis clock): save in 🔔 immediately, pause non-urgent Telegram push
  fleetPhone: '', emergencyPhones: '',
  // Who is told about what: 0 = nobody, 1 = 🔔 in the portal, 2 = 🔔 + personal Telegram
  notify: {},
  // What each staff role may do. Super Admin can switch every box on or off; the Super Admin always has everything.
  perms: {
    manager: { approve: true, photos: true, opsDash: true },
    fleet: { photos: true, charging: true, startKm: true, service: true, vehicles: true, driverPin: true, assign: true, opsDash: true, mgrStats: true, repairs: true, incidents: true },
    finance: { photos: true, opsDash: true, payments: true, platform: true, reports: true, salary: true, expenses: true, closeDay: true },
  },
  // Route / zone lines: one line with a middle stop; a full ride pays fullFare, a half ride (to/from the middle stop) pays shortFare
  routes: [{ id: 'at-4k-meg', name: 'አውቶቡስ ተራ – 4 ኪሎ – መገናኛ', from: 'አውቶቡስ ተራ', mid: '4 ኪሎ', to: 'መገናኛ', fullFare: 60, shortFare: 30 }],
};
const ROLES = ['manager', 'fleet', 'finance'];
const PERM_KEYS = ['approve', 'photos', 'charging', 'startKm', 'service', 'vehicles', 'driverPin', 'assign', 'opsDash', 'payments', 'platform', 'reports', 'salary', 'expenses', 'repairs', 'mgrStats', 'audit', 'closeDay', 'incidents'];
// Message types: label and the default level per role (0 off, 1 bell, 2 bell + Telegram). The Super Admin changes these in Admin.
const NOTIFY = {
  incident: { l: '🚨 አደጋ / ችግር (Incident)', def: { admin: 2, manager: 2, fleet: 2, finance: 1 } },
  vehicleHold: { l: '⏸ በምርመራ / ጥገና ያለ መኪና (Vehicle off the road)', def: { admin: 1, manager: 1, fleet: 2 } },
  pending: { l: '⏳ ያልጸደቁ ሪፖርቶች — ጠዋት (Pending reports, morning)', def: { admin: 1, manager: 2 } },
  newPending: { l: '📥 አዲስ ሪፖርት ገባ (New report sent)', def: { admin: 1, manager: 1 } },
  closeDue: { l: '📕 ዛሬ የሚዘጉ ቀኖች (Days to close today)', def: { admin: 1, finance: 2 } },
  notClosed: { l: '⚠️ ቀኑ አልተዘጋም (Day not closed)', def: { admin: 2, finance: 1 } },
  dayClosed: { l: '📕 ቀን ተዘጋ / ተከፈተ (Day closed / reopened)', def: { admin: 1, finance: 1 } },
  security: { l: '🔐 አዲስ መሳሪያ / የጋራ ስልክ (Device & PIN)', def: { admin: 2 } },
  shiftAlert: { l: '🔔 የሪፖርት ማስጠንቀቂያ — ባትሪ፣ ገንዘብ፣ ኪ.ሜ (Report alerts)', def: { admin: 1, manager: 1 } },
  breakOver: { l: '☕ ከገደብ በላይ እረፍት (Break over the limit)', def: { manager: 1, fleet: 1 } },
  digest: { l: '🟡 የቀን ማጠቃለያ — ጠዋት (Daily summary)', def: { admin: 2, manager: 2, fleet: 2, finance: 2 } },
  usage: { l: '📈 የነፃ እቅድ ገደብ እየቀረበ ነው (Free-plan limit near)', def: { admin: 2 } },
  roster: { l: '📅 የፈቃድ ጥያቄ / የፕሮግራም ክፍተት (Leave requests, plan gaps)', def: { admin: 1, fleet: 2 } },
  inspection: { l: '📋 ፍተሻ፦ ችግር / ያልተደረገ / ተረኛ ያልደረሰ (Inspection & handover)', def: { admin: 1, fleet: 2, manager: 1 } },
  target: { l: '🎯 ዒላማ ደጋግሞ ያልደረሰ ሹፌር (Route target missed again)', def: { admin: 1, manager: 1, fleet: 2 } },
  yango: { l: '🟡 የያንጎ ሳምንታዊ ግብ — ማስጠንቀቂያ እና ውጤት (Yango weekly goal)', def: { admin: 1, manager: 1, fleet: 2, finance: 1 } },
  feedback: { l: '⭐ የተሳፋሪ ቅሬታ በQR — 1–2 ኮከብ ወይም ታሪፍ (Passenger complaint)', def: { admin: 1, manager: 1, fleet: 2 } },
  monthly: { l: '📈 የወር ሪፖርት — ትርፍ/ኪሳራ + Excel (Monthly report, on the 1st)', def: { admin: 2, manager: 2, finance: 2 } },
  docs: { l: '📄 ሰነድ ማብቂያ — መንጃ ፈቃድ፣ ኢንሹራንስ፣ ቦሎ (Documents expiring)', def: { admin: 2, manager: 1, fleet: 2 } },
  serviceDue: { l: '🔧 የሰርቪስ ኪ.ሜ መድረስ (Service due soon / overdue)', def: { admin: 1, manager: 1, fleet: 2 } },
  debtLimit: { l: '💸 የሹፌር ዕዳ ከገደብ አለፈ (Driver debt over limit)', def: { admin: 2, manager: 1, fleet: 1, finance: 2 } },
  lowBatteryRepeat: { l: '🔋 ተደጋጋሚ ዝቅተኛ ባትሪ በ7 ቀን (Repeated low battery in 7d)', def: { admin: 2, manager: 1, fleet: 2 } },
  broadcast: { l: '📢 የአስተዳደር ማስታወቂያ (Staff broadcast announcement)', def: { admin: 1, manager: 1, fleet: 1, finance: 1 } },
};
const NROLES = ['admin', 'manager', 'fleet', 'finance'];
// Management channel (v4.4): small actions go out once an hour in one bundle; the rest at once.
const FEED_MINOR = ['LOGIN', 'BREAK_START', 'BREAK_END', 'TG_LINK', 'TG_UNLINK', 'BACKUP_DOWNLOAD', 'EXPORT_CSV', 'EXPORT_PAYROLL', 'EXPORT_PAYOUT', 'PHOTO', 'TELE_LOG'];
const FEED_RICH = ['APPROVE', 'EDIT', 'INCIDENT']; // these are posted as a full report / with photos instead of one line
const FEED_ICON = { SUBMIT: '📥', REJECT: '↩️', CANCEL: '✖️', DELETE: '🗑', PAYMENT: '💵', PAYMENT_DELETE: '🗑💵', CHARGE: '⚡', CHARGE_DELETE: '🗑⚡', EXPENSE: '🧾', EXPENSE_DELETE: '🗑🧾',
  ASSIGN: '🔁', START_KM: '🔢', SERVICED: '🔧', DAY_CLOSE: '📕', DAY_REOPEN: '📖', INCIDENT_RESOLVE: '🛠', VEHICLE_STATUS: '⏸', DEVICE: '📱', DEVICE_APPROVE: '📱✅', DEVICE_BLOCK: '📱🚫',
  PERMS_UPDATE: '🔐', CONFIG_UPDATE: '⚙️', MANAGERS_UPDATE: '👥', DRIVERS_UPDATE: '👤', VEHICLES_UPDATE: '🚐', PLATFORM_IMPORT: '🔍', SETUP: '🛠', CHANNEL: '📢', LOGIN: '🔑', BREAK_START: '☕', BREAK_END: '▶️' };
const HOOK_UPDATES = ['message', 'channel_post'];
const INC_KINDS = { accident: { l: '💥 የመኪና አደጋ', stop: true }, breakdown: { l: '🔧 መኪና ተበላሸ', stop: true }, injury: { l: '🤕 ሰው ተጎዳ', stop: true },
  battery: { l: '🔋 ባትሪ አለቀ' }, traffic: { l: '👮 በትራፊክ ተያዘ' }, other: { l: '⚠️ ሌላ' } };
const BREAK_REASONS = { lunch: '🍽 ምሳ', prayer: '🙏 ጸሎት', charge: '⚡ ቻርጅ', rest: '☕ እረፍት', other: '• ሌላ' };
const MISS_REASONS = { idle: 'ቆሞ ዋለ (idle)', repair: 'ጥገና (repair)', absent: 'ቀሪ (absent)', leave: 'ፈቃድ (leave)', other: 'ሌላ (other)' };
const normPhone = s => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const MAX_PHOTO = 900 * 1024;
const PHOTO_KINDS = { odo: 'Odometer', cash: 'Telebirr / cash receipt' };
// Only these are frozen onto an approved record ("rates stay with the record")
const RATE_KEYS = ['overtimeRate', 'bufferKm', 'penaltyRate', 'minAccept', 'cabbyT1Min', 'cabbyT1Max', 'cabbyT1Rate', 'cabbyT2Rate', 'yangoT2Min', 'yangoT2Max', 'yangoT2Rate', 'yangoT3Rate', 'routeBonus', 'reserveBonusPerRun', 'lowBatteryPct', 'lowBatteryPctCabby', 'lowBatteryPctRoute', 'batteryThresholds'];
const MODES = ['any', 'cabby', 'route'];

function normBattThresholds(cfg) {
  const baseAlert = Math.min(100, Math.max(0, Math.round(num(cfg?.lowBatteryPct ?? 20))));
  const cabbyAlert = Math.min(100, Math.max(0, Math.round(num(cfg?.batteryThresholds?.cabby?.alertPct ?? cfg?.lowBatteryPctCabby ?? baseAlert))));
  const routeAlert = Math.min(100, Math.max(0, Math.round(num(cfg?.batteryThresholds?.route?.alertPct ?? cfg?.lowBatteryPctRoute ?? ( cfg?.lowBatteryPct != null ? baseAlert : 25 )))));
  const anyAlert = Math.min(100, Math.max(0, Math.round(num(cfg?.batteryThresholds?.any?.alertPct ?? baseAlert))));
  const clampWarn = (w, al, defAdd = 5) => {
    const raw = w != null && Number.isFinite(+w) ? Math.round(+w) : Math.min(100, al + defAdd);
    return Math.min(100, Math.max(al, raw));
  };
  return {
    cabby: {
      alertPct: cabbyAlert,
      warnPct: clampWarn(cfg?.batteryThresholds?.cabby?.warnPct, cabbyAlert, 5),
      lockGate: cfg?.batteryThresholds?.cabby?.lockGate !== undefined ? !!cfg.batteryThresholds.cabby.lockGate : true,
    },
    route: {
      alertPct: routeAlert,
      warnPct: clampWarn(cfg?.batteryThresholds?.route?.warnPct, routeAlert, 5),
      lockGate: cfg?.batteryThresholds?.route?.lockGate !== undefined ? !!cfg.batteryThresholds.route.lockGate : true,
    },
    any: {
      alertPct: anyAlert,
      warnPct: clampWarn(cfg?.batteryThresholds?.any?.warnPct, anyAlert, 5),
      lockGate: cfg?.batteryThresholds?.any?.lockGate !== undefined ? !!cfg.batteryThresholds.any.lockGate : true,
    },
  };
}

function battCfgForMode(cfg, mode) {
  const bt = normBattThresholds(cfg);
  const m = mode === 'route' ? 'route' : mode === 'cabby' ? 'cabby' : 'any';
  return bt[m] || bt.any;
}

function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function hashPin(pin, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
  return salt + ':' + hex(bits);
}
async function checkPin(pin, stored) {
  if (!stored || !pin) return false;
  return safeEq(await hashPin(String(pin), stored.split(':')[0]), stored);
}
// Keyed lookup so a staff PIN can be matched to its account without trying every hash (and to enforce unique PINs)
const pinLookup = (env, pin) => hmac(env.SESSION_SECRET, 'staffpin:' + String(pin));

async function signToken(env, p, hours = 12) {
  const body = b64u(JSON.stringify({ ...p, exp: Date.now() + hours * 3600e3 }));
  return body + '.' + await hmac(env.SESSION_SECRET, body);
}
async function readToken(env, req) {
  const t = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const [body, sig] = t.split('.');
  if (!body || !sig || !env.SESSION_SECRET) return null;
  if (!safeEq(sig, await hmac(env.SESSION_SECRET, body))) return null;
  try {
    const p = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

const getKV = async (env, k) => (await env.DB.prepare('SELECT v FROM config WHERE k=?').bind(k).first())?.v;
const setKV = (env, k, v) => env.DB.prepare('INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
const delKV = (env, k) => env.DB.prepare('DELETE FROM config WHERE k=?').bind(k).run();
async function getCfg(env) {
  const v = await getKV(env, 'policy');
  return { ...DEF, ...(v ? JSON.parse(v) : {}) };
}
// Every audit line also records the device: its id (kept on the phone), phone/browser, IP and city; GPS when the driver allowed it.
// env._ri is set per request in handle(); scheduled jobs have none.
const auditStmt = (env, actor, action, shiftId, detail, lastId = false) => {
  const ri = env._ri || {};
  return env.DB.prepare(`INSERT INTO audit(ts,actor,action,shift_id,detail,dev,dinfo,ip,city,geo) VALUES(?,?,?,${lastId ? 'last_insert_rowid()' : '?'},?,?,?,?,?,?)`)
    .bind(...[now(), actor, action, ...(lastId ? [] : [shiftId ?? null]), detail ?? '', ri.dev || '', ri.info || '', ri.ip || '', ri.city || '', ri.geo || '']);
};
const audit = (env, actor, action, shiftId, detail) => auditStmt(env, actor, action, shiftId, detail).run();
// "Android 13 · SM-A155F · Chrome" from the browser's user agent (+ the model the page reads when the browser hides it)
function devInfo(ua, model) {
  ua = String(ua || '');
  const os = (ua.match(/Android [\d.]+/) || [])[0] || (/iPhone|iPad/.test(ua) ? 'iOS ' + ((ua.match(/OS (\d+)_/) || [])[1] || '') : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '');
  let mdl = String(model || '').trim();
  if (!mdl) { const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/); if (m && m[1] !== 'K') mdl = m[1]; }
  const br = /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox/.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return [os.trim(), mdl.slice(0, 30), br].filter(Boolean).join(' · ').slice(0, 80);
}
const devShort = d => (d ? 'D-' + String(d).slice(0, 4).toUpperCase() : '');
const r5 = x => Math.round(x * 1e5) / 1e5;
const cleanGeo = g => { if (!g || typeof g !== 'object') return null; const lat = +g.lat, lng = +g.lng; return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat: r5(lat), lng: r5(lng), acc: Math.round(num(g.acc)) } : null; };
const mapLink = g => (g ? `https://maps.google.com/?q=${g.lat},${g.lng}` : '');

// v4.5: the money numbers of each report also live in their own columns, so totals are added up by the database
// (Cloudflare's free plan allows ~10 ms of Worker CPU per request; reading every report's JSON does not scale)
const N_COLS = ['n_mode', 'n_km', 'n_dep', 'n_tele', 'n_due', 'n_cabbycash', 'n_yangocash', 'n_bonus', 'n_bonuspay', 'n_bd', 'n_sf', 'n_mp', 'n_pen', 'n_pfb', 'n_pd', 'n_waived', 'n_ot', 'n_otmin', 'n_wmin', 'n_pax', 'n_rgap', 'n_batt', 'n_clr', 'n_work', 'n_ref'];
function shiftNums(c) {
  const route = c.mode === 'route';
  // n_cabbycash / n_yangocash = cash in hand. Under the v4.9 rule the app cash also holds the Telebirr-paid trips: that part is taken off, split by each app's share.
  let cc = num(c.cabbyCash), yc = num(c.yangoCash);
  if (!route && c.cashRule === 2 && num(c.teleTotal) > 0 && cc + yc > 0) { const t = Math.min(num(c.teleTotal), cc + yc), k = cc / (cc + yc); cc = r2(cc - t * k); yc = r2(yc - t * (1 - k)); }
  return [route ? 'route' : 'cabby', num(c.actualKm), num(c.cashDeposited), num(c.teleTotal), num(c.totalCashDue), cc, yc, num(c.totalCombinedBonus),
    bonusPayable(c), bdOf(c), sfOf(c), mpOf(c), num(c.kmPenaltyEtb), pfbOf(c), pdOf(c), num(c.waivedPenalty), num(c.overtimePay), num(c.overtimeMinutes), num(c.workMinutes),
    num(c.passengers), Math.max(0, num(c.revenueGap)), num(c.batterySoc), c.isCleared ? 1 : 0, route ? num(c.roundTrips) : num(c.cabbyTrips) + num(c.yangoTrips),
    c.txnRef && c.txnRef !== 'N/A' ? String(c.txnRef).toLowerCase() : '']; // receipt number, for the "already used" check
}
const N_SET = N_COLS.map(c => c + '=?').join(',');

// ---- Automatic database upgrade (no terminal command needed) ----
let schemaOk = false;
async function ensureSchema(env) {
  if (schemaOk) return;
  const base = [
    'CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
    "CREATE TABLE IF NOT EXISTS vehicles (plate TEXT PRIMARY KEY, driver TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', pin_hash TEXT NOT NULL, next_start_km REAL NOT NULL DEFAULT 0)",
    'CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, shift_date TEXT NOT NULL, status TEXT NOT NULL, form TEXT NOT NULL, calc TEXT NOT NULL, hash TEXT NOT NULL, submitted_by TEXT, approved_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_shifts_plate ON shifts(plate, shift_date)',
    'CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, shift_id INTEGER, detail TEXT)',
    'CREATE TABLE IF NOT EXISTS attempts (k TEXT PRIMARY KEY, n INTEGER NOT NULL, ts INTEGER NOT NULL)',
  ];
  for (const s of base) await env.DB.prepare(s).run();
  const ver = num(await getKV(env, 'schema_ver'));
  if (ver < 2) {
    const alters = [
      "ALTER TABLE vehicles ADD COLUMN mode TEXT NOT NULL DEFAULT 'any'",
      'ALTER TABLE vehicles ADD COLUMN pin_ver INTEGER NOT NULL DEFAULT 1',
    ];
    for (const s of alters) { try { await env.DB.prepare(s).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } }
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS managers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL, lookup TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)').run();
    await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_managers_lookup ON managers(lookup)').run();
    await setKV(env, 'schema_ver', 2);
  }
  if (ver < 3) {
    const alters = [
      'ALTER TABLE shifts ADD COLUMN reject_reason TEXT',
      'ALTER TABLE vehicles ADD COLUMN service_every_km REAL NOT NULL DEFAULT 0',
      'ALTER TABLE vehicles ADD COLUMN last_service_km REAL NOT NULL DEFAULT 0',
      "ALTER TABLE vehicles ADD COLUMN last_service_date TEXT NOT NULL DEFAULT ''",
    ];
    for (const s of alters) { try { await env.DB.prepare(s).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } }
    for (const s of [
      'CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, pay_date TEXT NOT NULL, amount REAL NOT NULL, ref TEXT NOT NULL DEFAULT \'\', note TEXT NOT NULL DEFAULT \'\', by_actor TEXT NOT NULL, created_at TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS idx_payments_plate ON payments(plate, pay_date)',
      'CREATE TABLE IF NOT EXISTS charging (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, chg_date TEXT NOT NULL, kwh REAL NOT NULL, cost REAL NOT NULL DEFAULT 0, soc_from REAL, soc_to REAL, odo_km REAL, location TEXT NOT NULL DEFAULT \'\', by_actor TEXT NOT NULL, created_at TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS idx_charging_plate ON charging(plate, chg_date)',
      'CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB, in_r2 INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(shift_id, kind))',
    ]) await env.DB.prepare(s).run();
    await setKV(env, 'schema_ver', 3);
  }
  if (ver < 4) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS platform_trips (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, plate TEXT NOT NULL, trip_date TEXT NOT NULL, trips INTEGER NOT NULL DEFAULT 0, km REAL NOT NULL DEFAULT 0, cash REAL NOT NULL DEFAULT 0, imported_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(source, plate, trip_date))").run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_platform_date ON platform_trips(trip_date)').run();
    await setKV(env, 'schema_ver', 4);
  }
  if (ver < 5) {
    try { await env.DB.prepare("ALTER TABLE vehicles ADD COLUMN tele_id TEXT NOT NULL DEFAULT ''").run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; }
    await setKV(env, 'schema_ver', 5);
  }
  if (ver < 6) {
    try { await env.DB.prepare("ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'cash'").run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; }
    await setKV(env, 'schema_ver', 6);
  }
  if (ver < 7) {
    // v4: staff roles, drivers separate from vehicles, daily driver assignment
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt("ALTER TABLE managers ADD COLUMN role TEXT NOT NULL DEFAULT 'manager'");
    await alt('ALTER TABLE vehicles ADD COLUMN driver_id INTEGER');
    await alt('ALTER TABLE shifts ADD COLUMN driver_id INTEGER');
    await alt('ALTER TABLE payments ADD COLUMN driver_id INTEGER');
    for (const q of [
      "CREATE TABLE IF NOT EXISTS drivers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', pin_hash TEXT NOT NULL, pin_ver INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, salary REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone) WHERE phone<>''",
      'CREATE TABLE IF NOT EXISTS assignments (plate TEXT NOT NULL, adate TEXT NOT NULL, driver_id INTEGER NOT NULL, by_actor TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(plate, adate))',
      'CREATE INDEX IF NOT EXISTS idx_shifts_driver ON shifts(driver_id, shift_date)',
      'CREATE INDEX IF NOT EXISTS idx_payments_driver ON payments(driver_id)',
    ]) await env.DB.prepare(q).run();
    // Each vehicle's current driver becomes a driver record (same PIN, so nobody has to log in again); history follows them
    const vs = (await env.DB.prepare('SELECT * FROM vehicles WHERE driver_id IS NULL').all()).results;
    const used = new Set((await env.DB.prepare("SELECT phone FROM drivers WHERE phone<>''").all()).results.map(r => r.phone));
    for (const v of vs) {
      let ph = normPhone(v.phone); if (used.has(ph)) ph = ''; if (ph) used.add(ph);
      const did = (await env.DB.prepare('INSERT INTO drivers(name,phone,pin_hash,pin_ver,created_at) VALUES(?,?,?,?,?)').bind(String(v.driver || v.plate).trim() || v.plate, ph, v.pin_hash, v.pin_ver ?? 1, now()).run()).meta.last_row_id;
      await env.DB.batch([env.DB.prepare('UPDATE vehicles SET driver_id=? WHERE plate=?').bind(did, v.plate),
        env.DB.prepare('UPDATE shifts SET driver_id=? WHERE plate=? AND driver_id IS NULL').bind(did, v.plate),
        env.DB.prepare('UPDATE payments SET driver_id=? WHERE plate=? AND driver_id IS NULL').bind(did, v.plate)]);
    }
    await setKV(env, 'schema_ver', 7);
  }
  if (ver < 8) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL DEFAULT '', exp_date TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, months INTEGER NOT NULL DEFAULT 1, ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', photo BLOB, photo_mime TEXT, by_actor TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(exp_date)').run();
    await setKV(env, 'schema_ver', 8);
  }
  if (ver < 9) {
    // v4.3: device on every audit line, day close, breaks, incidents, vehicle status, personal Telegram, in-portal notifications
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    for (const c of ['dev', 'dinfo', 'ip', 'city', 'geo']) await alt(`ALTER TABLE audit ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
    await alt("ALTER TABLE vehicles ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'");
    await alt("ALTER TABLE vehicles ADD COLUMN status_since TEXT NOT NULL DEFAULT ''");
    await alt("ALTER TABLE vehicles ADD COLUMN repair_until TEXT NOT NULL DEFAULT ''");
    await alt("ALTER TABLE vehicles ADD COLUMN status_note TEXT NOT NULL DEFAULT ''");
    for (const q of [
      "CREATE TABLE IF NOT EXISTS day_close (cdate TEXT NOT NULL, grp TEXT NOT NULL, status TEXT NOT NULL, closed_by TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '', reopened_by TEXT NOT NULL DEFAULT '', reopened_at TEXT NOT NULL DEFAULT '', reopen_reason TEXT NOT NULL DEFAULT '', PRIMARY KEY(cdate, grp))",
      "CREATE TABLE IF NOT EXISTS day_missing (cdate TEXT NOT NULL, plate TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', by_actor TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(cdate, plate))",
      "CREATE TABLE IF NOT EXISTS breaks (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, plate TEXT NOT NULL DEFAULT '', bdate TEXT NOT NULL, reason TEXT NOT NULL, start_ts TEXT NOT NULL, end_ts TEXT)",
      'CREATE INDEX IF NOT EXISTS idx_breaks_driver ON breaks(driver_id, bdate)',
      "CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, driver_id INTEGER, idate TEXT NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', lat REAL, lng REAL, acc REAL, status TEXT NOT NULL DEFAULT 'open', by_actor TEXT NOT NULL, created_at TEXT NOT NULL, resolved_by TEXT NOT NULL DEFAULT '', resolved_at TEXT NOT NULL DEFAULT '', resolution TEXT NOT NULL DEFAULT '')",
      'CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, idate)',
      'CREATE TABLE IF NOT EXISTS incident_photos (incident_id INTEGER NOT NULL, n INTEGER NOT NULL, mime TEXT NOT NULL, data BLOB, created_at TEXT NOT NULL, PRIMARY KEY(incident_id, n))',
      "CREATE TABLE IF NOT EXISTS devices (dev TEXT NOT NULL, who TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', info TEXT NOT NULL DEFAULT '', first_ts TEXT NOT NULL, last_ts TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(dev, who))",
      'CREATE INDEX IF NOT EXISTS idx_devices_who ON devices(who)',
      'CREATE TABLE IF NOT EXISTS tg_links (who TEXT PRIMARY KEY, chat_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT \'\', linked_at TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS tg_codes (code TEXT PRIMARY KEY, who TEXT NOT NULL, exp INTEGER NOT NULL)',
      "CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0)",
      'CREATE INDEX IF NOT EXISTS idx_notifications_who ON notifications(who, id)',
    ]) await env.DB.prepare(q).run();
    await setKV(env, 'schema_ver', 9);
  }
  if (ver < 10) {
    // v4.4: management channel. Every audit line is queued for the channel by a trigger (only while a channel is linked).
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS feed (id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id INTEGER NOT NULL, minor INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_feed_sent ON feed(sent, minor, id)').run();
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS feed_audit AFTER INSERT ON audit WHEN EXISTS (SELECT 1 FROM config WHERE k='tg_channel') BEGIN
      INSERT INTO feed(audit_id, minor) VALUES (NEW.id, NEW.action IN (${FEED_MINOR.map(a => `'${a}'`).join(',')})); END`).run();
    await setKV(env, 'schema_ver', 10);
  }
  if (ver < 11) {
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    for (const c of N_COLS) await alt(`ALTER TABLE shifts ADD COLUMN ${c} ${c === 'n_mode' ? "TEXT NOT NULL DEFAULT 'cabby'" : c === 'n_ref' ? "TEXT NOT NULL DEFAULT ''" : 'REAL NOT NULL DEFAULT 0'}`);
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_shifts_status_date ON shifts(status, shift_date)').run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shifts_ref ON shifts(n_ref) WHERE n_ref<>''").run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref)').run();
    // Fill the new columns for existing reports, a page at a time
    for (let last = 0; ;) {
      const rows = (await env.DB.prepare('SELECT id,calc FROM shifts WHERE id>? ORDER BY id LIMIT 200').bind(last).all()).results;
      if (!rows.length) break;
      const st = rows.map(r => env.DB.prepare(`UPDATE shifts SET ${N_SET} WHERE id=?`).bind(...shiftNums(JSON.parse(r.calc)), r.id));
      for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
      last = rows[rows.length - 1].id;
    }
    await setKV(env, 'schema_ver', 11);
  }
  if (ver < 12) {
    // v4.8 Telebirr: every passenger payment is one row. The driver's phone claims it (from the SMS); the merchant statement confirms it.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tele_txn (txn TEXT PRIMARY KEY, tdate TEXT NOT NULL, ts TEXT NOT NULL, amount REAL,
      plate TEXT, driver_id INTEGER, src TEXT, logged_by TEXT, logged_at TEXT, dup TEXT,
      st_amount REAL, st_ts TEXT, st_type TEXT, st_op TEXT, st_at TEXT,
      res TEXT, res_amt REAL, res_note TEXT, res_by TEXT, res_at TEXT)`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_tele_date ON tele_txn(tdate, plate)').run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS tele_import (id INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL, from_ts TEXT NOT NULL, to_ts TEXT NOT NULL, rows INTEGER NOT NULL, file TEXT, by_actor TEXT, created_at TEXT NOT NULL)').run();
    // the channel trigger lists the "small" actions; Telebirr receipts join them (bundled hourly)
    await env.DB.prepare('DROP TRIGGER IF EXISTS feed_audit').run();
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS feed_audit AFTER INSERT ON audit WHEN EXISTS (SELECT 1 FROM config WHERE k='tg_channel') BEGIN
      INSERT INTO feed(audit_id, minor) VALUES (NEW.id, NEW.action IN (${FEED_MINOR.map(a => `'${a}'`).join(',')})); END`).run();
    await setKV(env, 'schema_ver', 12);
  }
  if (ver < 13) {
    // v4.9: a report is per vehicle, day and shift; the weekly plan (roster); the shift inspection / handover with 4 photos
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt('ALTER TABLE shifts ADD COLUMN shift_no INTEGER NOT NULL DEFAULT 1');
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_shifts_pds ON shifts(plate, shift_date, shift_no)').run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS roster (rdate TEXT NOT NULL, plate TEXT NOT NULL, shift_no INTEGER NOT NULL, driver_id INTEGER, kind TEXT NOT NULL DEFAULT 'work',
      note TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, by_actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY(rdate, plate, shift_no))`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_roster_driver ON roster(driver_id, rdate)').run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, idate TEXT NOT NULL, shift_no INTEGER NOT NULL, driver_id INTEGER,
      out_driver_id INTEGER, km REAL, km_expected REAL, battery REAL, items TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '', serious INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, late_min INTEGER NOT NULL DEFAULT 0, ot_min INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL, at TEXT NOT NULL,
      decided_by TEXT, decided_at TEXT, decision TEXT, UNIQUE(plate, idate, shift_no))`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_insp_driver ON inspections(driver_id, idate)').run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS inspection_photos (insp_id INTEGER NOT NULL, side TEXT NOT NULL, mime TEXT NOT NULL, data BLOB, created_at TEXT NOT NULL, PRIMARY KEY(insp_id, side))').run();
    await setKV(env, 'schema_ver', 13);
  }
  if (ver < 14) {
    // v4.9: each driver's usual vehicle, shift and rest day (for the weekly plan); days off asked in the portal
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt("ALTER TABLE drivers ADD COLUMN home_plate TEXT NOT NULL DEFAULT ''");
    await alt('ALTER TABLE drivers ADD COLUMN home_shift INTEGER NOT NULL DEFAULT 1');
    await alt('ALTER TABLE drivers ADD COLUMN rest_dow INTEGER NOT NULL DEFAULT -1');
    await alt('ALTER TABLE drivers ADD COLUMN standby INTEGER NOT NULL DEFAULT 0');
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS leaves (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL, kind TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, decision_note TEXT, created_at TEXT NOT NULL)`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_leaves_driver ON leaves(driver_id, from_date)').run();
    await setKV(env, 'schema_ver', 14);
  }
  if (ver < 15) {
    // v4.9: 🟣 Cabby Reserve runs the driver logs (⏳ waiting ▶ start 🏁 arrived) and the bookings from Cabby's monthly report they are matched with
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt('ALTER TABLE vehicles ADD COLUMN seats INTEGER NOT NULL DEFAULT 4');
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reserve_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, rdate TEXT NOT NULL, shift_no INTEGER NOT NULL DEFAULT 1, driver_id INTEGER NOT NULL,
      status TEXT NOT NULL, wait_at TEXT, start_at TEXT, end_at TEXT, start_km REAL, end_km REAL, est_km REAL, battery REAL, pax INTEGER NOT NULL DEFAULT 0, wait_min INTEGER NOT NULL DEFAULT 0,
      wait_fee REAL NOT NULL DEFAULT 0, allow_km REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', lat REAL, lng REAL, created_at TEXT NOT NULL)`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rsv_pd ON reserve_runs(plate, rdate)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rsv_drv ON reserve_runs(driver_id, rdate)').run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reserve_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, at TEXT NOT NULL, plate TEXT NOT NULL, pax INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'done', plan TEXT NOT NULL DEFAULT '', run_id INTEGER, by_actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rsvb_run ON reserve_bookings(run_id)').run();
    await setKV(env, 'schema_ver', 15);
  }
  if (ver < 16) {
    // v4.9: 📄 documents (licence, insurance, bolo, route permit …) with expiry, the current and previous photo, and the Super Admin's permit to work past expiry
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, type TEXT NOT NULL, number TEXT NOT NULL DEFAULT '',
      expires TEXT NOT NULL, photo_ok INTEGER NOT NULL DEFAULT 0, permit_until TEXT, permit_reason TEXT, permit_by TEXT, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, UNIQUE(owner_kind, owner_id, type))`).run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS doc_photos (doc_id INTEGER NOT NULL, slot TEXT NOT NULL, mime TEXT NOT NULL, data BLOB, expires TEXT, created_at TEXT NOT NULL, PRIMARY KEY(doc_id, slot))').run();
    await setKV(env, 'schema_ver', 16);
  }
  if (ver < 17) {
    // v4.9: 🟡 Yango weekly goal per vehicle (chosen goal, result, drivers' share); 🎯 targets for one vehicle / driver
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS yango_week (plate TEXT NOT NULL, week TEXT NOT NULL, goal INTEGER NOT NULL DEFAULT 0, goal_etb REAL NOT NULL DEFAULT 0, chosen_by TEXT NOT NULL DEFAULT '',
      trips INTEGER NOT NULL DEFAULT 0, met INTEGER NOT NULL DEFAULT 0, bonus REAL NOT NULL DEFAULT 0, share_pct REAL NOT NULL DEFAULT 0, shares TEXT NOT NULL DEFAULT '{}', closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(plate, week))`).run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS targets (kind TEXT NOT NULL, id TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY(kind, id, metric))').run();
    await setKV(env, 'schema_ver', 17);
  }
  if (ver < 18) {
    // v4.9: ⭐ passenger feedback by the QR code in each vehicle
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt("ALTER TABLE vehicles ADD COLUMN fb_code TEXT NOT NULL DEFAULT ''");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL, driver_id INTEGER, fdate TEXT NOT NULL, at TEXT NOT NULL, stars INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', who TEXT NOT NULL, complaint INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new',
      handled_by TEXT, note TEXT, UNIQUE(plate, fdate, who))`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_fb_driver ON feedback(driver_id, fdate)').run();
    await setKV(env, 'schema_ver', 18);
  }
  if (ver < 19) {
    // v4.9: a reserve run is recorded at its start and its end only (many bookings in one run); the start place name and the end GPS
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt("ALTER TABLE reserve_runs ADD COLUMN place TEXT NOT NULL DEFAULT ''");
    await alt('ALTER TABLE reserve_runs ADD COLUMN end_lat REAL');
    await alt('ALTER TABLE reserve_runs ADD COLUMN end_lng REAL');
    await setKV(env, 'schema_ver', 19);
  }
  if (ver < 20) {
    // v4.9: a returned report marks the wrong fields; charging entered at the approval is linked to the report
    const alt = async q => { try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message || e))) throw e; } };
    await alt("ALTER TABLE shifts ADD COLUMN reject_fields TEXT NOT NULL DEFAULT ''");
    await alt('ALTER TABLE charging ADD COLUMN shift_id INTEGER');
    await setKV(env, 'schema_ver', 20);
  }
  schemaOk = true;
}

// ---- Plate matching for imported Cabby / Yango reports ----
const normPlate = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ET(?=\d)/, '');
function plateMatcher(vehicles) {
  const by = new Map(vehicles.map(v => [normPlate(v.plate), v.plate]));
  const tele = new Map(vehicles.filter(v => v.tele_id).map(v => [String(v.tele_id).replace(/\D/g, ''), v.plate]));
  return raw => {
    const n = normPlate(raw);
    if (!n) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits && tele.has(digits)) return tele.get(digits); // Telebirr merchant / QR number of the vehicle
    if (by.has(n)) return by.get(n);
    // Fallback: same trailing number (e.g. "A1024" vs "3A1024"), only if exactly one vehicle matches
    const tail = (n.match(/\d{4,}$/) || [])[0];
    if (!tail) return null;
    const hits = [...by.entries()].filter(([k]) => k.endsWith(tail) || n.endsWith((k.match(/\d{4,}$/) || [''])[0] || '#'));
    return hits.length === 1 ? hits[0][1] : null;
  };
}
const weekStart = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;

// Rate limit: returns true if locked
async function locked(env, key, limit) {
  const r = await env.DB.prepare('SELECT n,ts FROM attempts WHERE k=?').bind(key).first();
  return !!r && r.n >= limit && Date.now() - r.ts < 15 * 60e3;
}
async function bump(env, key) {
  const r = await env.DB.prepare('SELECT n,ts FROM attempts WHERE k=?').bind(key).first();
  const n = r && Date.now() - r.ts < 15 * 60e3 ? r.n + 1 : 1;
  await env.DB.prepare('INSERT INTO attempts(k,n,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=?,ts=?').bind(key, n, Date.now(), n, Date.now()).run();
}
async function guardedLogin(env, req, ident, ok) {
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const k1 = `ip:${ip}:${ident}`, k2 = `id:${ident}`;
  if (await locked(env, k1, 5) || await locked(env, k2, 20)) return 'LOCKED';
  if (await ok()) { await env.DB.prepare('DELETE FROM attempts WHERE k IN (?,?)').bind(k1, k2).run(); return 'OK'; }
  await bump(env, k1); await bump(env, k2); return 'BAD';
}

// Staff login: admin first, then individual managers; legacy single manager PIN is migrated on first use
async function staffLogin(env, pin) {
  if (!/^\d{6,12}$/.test(String(pin || ''))) return null;
  const lk = await pinLookup(env, pin);
  const adminHash = await getKV(env, 'admin_pin'), adminLk = await getKV(env, 'admin_lookup');
  if (adminLk && safeEq(adminLk, lk) && await checkPin(pin, adminHash)) return { role: 'admin' };
  const m = await env.DB.prepare('SELECT * FROM managers WHERE lookup=? AND active=1').bind(lk).first();
  if (m && await checkPin(pin, m.pin_hash)) return { role: m.role || 'manager', mid: m.id, ver: m.ver, name: m.name };
  if (!adminLk && await checkPin(pin, adminHash)) { await setKV(env, 'admin_lookup', lk); return { role: 'admin' }; }
  const legacy = await getKV(env, 'manager_pin');
  if (legacy && await checkPin(pin, legacy)) {
    const cfg = await getCfg(env);
    const id = (await env.DB.prepare('INSERT INTO managers(name,pin_hash,lookup,created_at) VALUES(?,?,?,?)').bind(cfg.managerName || 'Fleet Manager', legacy, lk, now()).run()).meta.last_row_id;
    await delKV(env, 'manager_pin');
    return { role: 'manager', mid: id, ver: 1, name: cfg.managerName || 'Fleet Manager' };
  }
  return null;
}
// Is this staff PIN already used by someone else? (exceptMid = the manager being edited)
async function staffPinTaken(env, pin, { exceptMid = null, exceptAdmin = false } = {}) {
  const lk = await pinLookup(env, pin);
  if (!exceptAdmin) {
    const alk = await getKV(env, 'admin_lookup');
    if (alk ? safeEq(alk, lk) : await checkPin(pin, await getKV(env, 'admin_pin'))) return true;
  }
  const m = await env.DB.prepare('SELECT id FROM managers WHERE lookup=?').bind(lk).first();
  if (m && m.id !== exceptMid) return true;
  const legacy = await getKV(env, 'manager_pin');
  return !!legacy && await checkPin(pin, legacy);
}

// ---- Route logbook: trips, passengers, fares, hours ----
const hm = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const fmtMin = x => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
function routeLog(cfg, f) {
  const route = (cfg.routes || []).find(r => r.id === f.routeId) || null;
  const full = num(cfg.fareOverride?.full ?? route?.fullFare), short = num(cfg.fareOverride?.short ?? route?.shortFare);
  const raw = Array.isArray(f.trips) ? f.trips.slice(0, 60) : [];
  const trips = raw.map((t, i) => {
    const paxFull = Math.max(0, Math.floor(num(t.paxFull))), paxShort = Math.max(0, Math.floor(num(t.paxShort)));
    const cash = Math.max(0, num(t.cash)), tele = Math.max(0, num(t.tele)), expected = route || cfg.fareOverride ? paxFull * full + paxShort * short : null;
    return { n: i + 1, dir: t.dir === 'back' ? 'back' : 'fwd', start: hm(t.start) != null ? String(t.start) : '', end: hm(t.end) != null ? String(t.end) : '', paxFull, paxShort, cash, tele, expected, gap: expected == null ? 0 : expected - (cash + tele),
      ...(t.manual ? { manual: true } : {}) }; // manual = the driver typed the time instead of the automatic clock
  });
  const fwd = trips.filter(t => t.dir === 'fwd').length, back = trips.length - fwd;
  const sum = k => trips.reduce((a, t) => a + num(t[k]), 0);
  // Working time: first trip start to last trip end (past midnight counts as the next day)
  const st = trips.map(t => hm(t.start)).filter(x => x != null), en = trips.map(t => hm(t.end)).filter(x => x != null);
  let workMinutes = 0;
  if (st.length && en.length) { workMinutes = en[en.length - 1] - st[0]; if (workMinutes < 0) workMinutes += 1440; }
  const stdH = num(cfg.stdHoursOverride ?? cfg.standardHours) || 8;
  const expectedRevenue = trips.some(t => t.expected != null) ? sum('expected') : null;
  return { route, routeId: route?.id || '', trips, tripsCount: trips.length, roundTrips: Math.min(fwd, back), passengers: sum('paxFull') + sum('paxShort'),
    paxFull: sum('paxFull'), paxShort: sum('paxShort'), cashTotal: sum('cash'), teleTotal: sum('tele'), expectedRevenue,
    manualTimes: trips.filter(t => t.manual).length,
    revenueGap: expectedRevenue == null ? 0 : expectedRevenue - sum('cash') - sum('tele'), tripIssues: trips.filter(t => t.expected != null && t.gap !== 0).map(t => ({ n: t.n, expected: t.expected, collected: t.cash + t.tele })),
    firstStart: st.length ? trips.find(t => t.start).start : '', lastEnd: en.length ? [...trips].reverse().find(t => t.end).end : '',
    workMinutes, overtimeMinutes: Math.max(0, workMinutes - stdH * 60), standardHours: stdH, fullFare: full, shortFare: short };
}

// ⭐ Passenger feedback: quick topics on the QR page
const FB_TAGS = { speed: 'ፍጥነት / አነዳድ (Driving & speed)', courtesy: 'ትህትና (Courtesy)', clean: 'ንጽህና (Cleanliness)', fare: 'ታሪፍ / ክፍያ (Fare)', media: 'ሙዚቃ / ቲቪ (Music & TV)' };
// 📄 Documents: which types apply to a driver / a vehicle, and which expired ones stop work today
const docTypesOf = (cfg, kind, mode) => (cfg.docTypes || DEF.docTypes).filter(t => t.for === kind && (t.mode === 'any' || !mode || mode === 'any' || t.mode === mode));
async function docBlocks(env, cfg, did, plate, date) {
  const v = plate ? await env.DB.prepare('SELECT mode FROM vehicles WHERE plate=?').bind(plate).first() : null;
  const want = [...docTypesOf(cfg, 'driver').map(t => ['driver', String(did), t]), ...(plate ? docTypesOf(cfg, 'vehicle', v?.mode).map(t => ['vehicle', plate, t]) : [])];
  const out = [];
  for (const [k, id, t] of want) {
    const d = await env.DB.prepare('SELECT * FROM documents WHERE owner_kind=? AND owner_id=? AND type=?').bind(k, id, t.id).first();
    if (d && d.expires < date && !(d.permit_until && d.permit_until >= date)) out.push(`${t.name}${k === 'vehicle' ? ` (${plate})` : ''} — ${d.expires}`);
  }
  return out;
}
const docBlockMsg = l => `📄 ጊዜው ያለፈ ሰነድ፦ ${l.join(' · ')}። ፍሊትን ያነጋግሩ — ሰነዱ እስኪታደስ ወይም Super Admin እስኪፈቅድ ስራ መጀመር አይቻልም። (Expired document: work is stopped until it is renewed or the Super Admin permits it)`;
const DEP_METHODS = { bank: 'Bank', telebirr: 'Telebirr transfer', hand: 'Cash to Finance' }; // how the driver deposited the cash
// 🟣 Cabby Reserve: totals of a shift's runs. The run's own KM (start → end, odometer) is allowed like app KM; there is no separate way back —
// after a run the driver goes online on Cabby/Yango, so empty KM falls under the usual buffer. The manager sees where the last run ended.
const gpsKm = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function rsvSum(rr) {
  const done = rr.filter(r => r.status === 'done'), last = [...done].sort((a, b) => String(b.end_at).localeCompare(String(a.end_at)))[0];
  return { runs: done.length, pax: done.reduce((a, r) => a + num(r.pax), 0), km: r1(done.reduce((a, r) => a + Math.max(0, num(r.end_km) - num(r.start_km)), 0)),
    allowKm: r1(done.reduce((a, r) => a + num(r.allow_km), 0)), places: done.map(r => r.place).filter(Boolean).slice(0, 5),
    last: last ? { at: last.end_at, lat: last.end_lat, lng: last.end_lng } : null };
}
// 🎯 Route target for one shift: the weekend target on Saturday/Sunday when set, else the usual one (0 = no target)
function routeTargetFor(cfg, routeId, date) {
  if (cfg.routeTargetOverride != null) return num(cfg.routeTargetOverride);
  const r = (cfg.routes || []).find(x => x.id === routeId); if (!r) return 0;
  const we = [0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay());
  return Math.max(0, num(we && num(r.targetWeekend) > 0 ? r.targetWeekend : r.target));
}
function routeBonusCalc(rb, target, revenue) {
  rb = rb || DEF.routeBonus;
  if (!(target > 0)) return { pct: null, bonus: 0, text: '' };
  const pct = Math.floor(revenue / target * 1000) / 10;
  if (rb.mode === 'pct') {
    const over = Math.max(0, revenue - target); let b = Math.round(over * num(rb.pct) / 100); if (num(rb.cap) > 0) b = Math.min(b, num(rb.cap));
    return { pct, bonus: b, text: b ? `${num(rb.pct)}% × ${r2(over)} over target` : 'below target' };
  }
  const t = [...(rb.tiers || [])].sort((a, b) => b.pct - a.pct).find(x => pct >= num(x.pct));
  return { pct, bonus: t ? num(t.etb) : 0, text: t ? `≥${t.pct}% → ${t.etb} ETB` : 'below target' };
}

// ---- Server-authoritative reconciliation engine ----
async function compute(env, cfg, f, supervisor, waive) {
  // Route / Zone drivers: no app trips, no KM-penalty rule. Cash due = route cash collected. Bonus = the route target bonus (v4.9).
  const isRoute = f.mode === 'route';
  let rl = null;
  if (isRoute) {
    rl = routeLog(cfg, f);
    if (rl.tripsCount) { // trip-by-trip logbook: totals come from the trips; Telebirr goes straight to the company, so only cash is deposited
      const { route, trips, ...rest } = rl;
      f = { ...f, ...rest, trips, routeName: route ? route.name : (String(f.routeName || '').trim().slice(0, 60) || 'N/A'), routeCash: rl.cashTotal };
    } else { delete f.trips; rl = null; }
  }
  f = isRoute ? { ...f, mode: 'route', routeName: String(f.routeName || '').trim().slice(0, 60) || 'N/A', roundTrips: Math.max(0, Math.floor(num(f.roundTrips))),
    routeCash: Math.max(0, num(f.routeCash)), batteryStart: String(f.batteryStart ?? '') === '' ? null : Math.min(100, Math.max(0, num(f.batteryStart))),
    cabbyTrips: 0, cabbyKm: Math.max(0, num(f.endKm) - num(f.startKm)), cabbyAccept: 100,
    cabbyCash: Math.max(0, num(f.routeCash)), yangoTrips: 0, yangoKm: 0, yangoCash: 0 } : { ...f, mode: 'cabby' };
  // Breaks (☕) come off the working time before overtime is worked out. breakMinutes is set by the server from the break log.
  const brk = Math.max(0, Math.round(num(f.breakMinutes)));
  if (isRoute && rl) { const std = num(f.standardHours) || 8; f.workMinutes = Math.max(0, num(f.workMinutes) - brk); f.overtimeMinutes = Math.max(0, f.workMinutes - std * 60); }
  const startKm = num(f.startKm), endKm = num(f.endKm), chargingKm = Math.max(0, num(f.chargingKm));
  const batterySoc = Math.min(100, Math.max(0, num(f.batterySoc)));
  const actualKm = Math.max(0, endKm - startKm), nextDayStartKm = endKm + chargingKm;
  const cabbyTrips = Math.max(0, Math.floor(num(f.cabbyTrips))), cabbyKm = Math.max(0, num(f.cabbyKm));
  const cabbyAccept = Math.min(100, Math.max(0, num(f.cabbyAccept))), cabbyCash = Math.max(0, num(f.cabbyCash));
  const yangoTrips = Math.max(0, Math.floor(num(f.yangoTrips))), yangoKm = Math.max(0, num(f.yangoKm)), yangoCash = Math.max(0, num(f.yangoCash));
  const rsv = !isRoute && f.reserve ? f.reserve : null, reserveAllowKm = rsv ? num(rsv.allowKm) : 0;
  const appTotalKm = cabbyKm + yangoKm, authorizedCeilingKm = appTotalKm + (isRoute ? 0 : cfg.bufferKm) + reserveAllowKm;
  let kmState = 'MATCH', excessKm = 0;
  if (!isRoute) {
    if (actualKm < appTotalKm) kmState = 'UNDERRUN';
    else if (actualKm > authorizedCeilingKm) { kmState = 'EXCESS'; excessKm = actualKm - authorizedCeilingKm; }
  }
  const kmPenaltyEtb = waive ? 0 : excessKm * cfg.penaltyRate, waivedPenalty = waive ? excessKm * cfg.penaltyRate : 0;

  let cabbyBonus = 0, cabbyTierText = '0 ETB';
  if (!isRoute) {
    if (cabbyAccept < cfg.minAccept) cabbyTierText = `Forfeited (<${cfg.minAccept}% Accept)`;
    else if (cabbyTrips >= cfg.cabbyT1Min && cabbyTrips <= cfg.cabbyT1Max) { cabbyBonus = cabbyTrips * cfg.cabbyT1Rate; cabbyTierText = `Tier 1 (${cabbyTrips}x${cfg.cabbyT1Rate})`; }
    else if (cabbyTrips > cfg.cabbyT1Max) {
      const base = cfg.cabbyT1Max * cfg.cabbyT1Rate, extra = (cabbyTrips - cfg.cabbyT1Max) * cfg.cabbyT2Rate;
      cabbyBonus = base + extra; cabbyTierText = `Tier 2 (${base}+${cabbyTrips - cfg.cabbyT1Max}x${cfg.cabbyT2Rate})`;
    }
  }
  let yangoBonus = 0, yangoTierText = 'Tier 1 (0 ETB)';
  if (!isRoute) {
    if (cabbyAccept < cfg.minAccept) yangoTierText = `Forfeited (<${cfg.minAccept}% Cabby)`;
    else if (yangoTrips >= cfg.yangoT2Min && yangoTrips <= cfg.yangoT2Max) { yangoBonus = yangoTrips * cfg.yangoT2Rate; yangoTierText = `Tier 2 (${yangoTrips}x${cfg.yangoT2Rate})`; }
    else if (yangoTrips > cfg.yangoT2Max) {
      const base = cfg.yangoT2Max * cfg.yangoT2Rate, extra = (yangoTrips - cfg.yangoT2Max) * cfg.yangoT3Rate;
      yangoBonus = base + extra; yangoTierText = `Tier 3 (${base}+${yangoTrips - cfg.yangoT2Max}x${cfg.yangoT3Rate})`;
    }
  }
  // Cash to deposit. Cabby/Yango (v4.9): the apps count a Telebirr-paid trip as "cash", so the passengers' Telebirr (from the SMS) comes off the app cash.
  // Records approved under the old rule keep it when re-edited (cfg.cashRuleOld). Route: the cash column is cash only.
  const teleIn = Math.max(0, num(f.teleTotal)), cashRule = isRoute || cfg.cashRuleOld ? 1 : 2;
  const appCash = cabbyCash + yangoCash, totalCashDue = cashRule === 2 ? Math.max(0, r2(appCash - teleIn)) : appCash, cashDeposited = Math.max(0, num(f.cashDeposited));
  const teleOverApp = cashRule === 2 && teleIn > appCash + 0.5 ? r2(teleIn - appCash) : 0;
  const txnRef = String(f.txnRef || '').trim().slice(0, 60) || 'N/A';
  const cashVariance = cashDeposited - totalCashDue;
  // Cash rule: Cash Deposited must be >= Cabby Cash + Yango Cash. Any shortfall is deducted from the bonus first; the driver pays whatever the bonus cannot cover.
  const shortfall = Math.max(0, -cashVariance);
  // 🎯 Route target: revenue = cash + Telebirr. The bonus is paid only with the cash fully deposited and no fares short.
  let rt = {};
  if (isRoute) {
    const target = routeTargetFor(cfg, f.routeId, f.shiftDate), revenue = r2(num(f.routeCash) + Math.max(0, num(f.teleTotal)));
    const c = routeBonusCalc(cfg.routeBonus, target, revenue), lost = [];
    if (c.bonus > 0 && shortfall > 0) lost.push(`cash short ${shortfall} ETB`);
    if (c.bonus > 0 && num(f.revenueGap) > 0) lost.push(`fares short ${num(f.revenueGap)} ETB`);
    rt = { routeTarget: target, routeRevenue: revenue, routePct: c.pct, routeBonusEarned: c.bonus, routeBonus: lost.length ? 0 : c.bonus, routeBonusText: c.text, routeBonusLost: lost.join(', ') };
  }
  const reserveBonus = rsv ? num(rsv.runs) * num(cfg.reserveBonusPerRun) : 0;
  const totalCombinedBonus = cabbyBonus + yangoBonus + (rt.routeBonus || 0) + reserveBonus;
  const bonusDeduction = Math.min(shortfall, totalCombinedBonus);
  const driverMustPay = shortfall - bonusDeduction;
  // KM penalty rule: taken from whatever bonus is left after the cash shortfall; the rest becomes penalty debt
  // ⏰ a late arrival over the monthly allowance is fined like a penalty: from the bonus first, the rest to the debt
  const lateFine = Math.max(0, Math.round(num(f.lateFine))), penTotal = kmPenaltyEtb + lateFine;
  const penaltyFromBonus = Math.min(penTotal, totalCombinedBonus - bonusDeduction);
  const penaltyDebt = penTotal - penaltyFromBonus;
  const netDriverBalance = totalCombinedBonus - bonusDeduction - penTotal;
  const bCfg = battCfgForMode(cfg, isRoute ? 'route' : 'cabby');
  const lowBatteryPct = bCfg.alertPct;
  const warnBatteryPct = bCfg.warnPct;
  const battLockGate = bCfg.lockGate;
  const isCleared = cashVariance >= 0 && kmState !== 'UNDERRUN' && (!battLockGate || batterySoc >= lowBatteryPct);
  // Working hours: route = from the trip times; Cabby/Yango = the shift start and end time the driver enters
  let hours = {};
  if (!isRoute) {
    const a = hm(f.shiftStart), b = hm(f.shiftEnd), std = num(cfg.stdHoursOverride ?? cfg.standardHours) || 8;
    if (a != null && b != null) { let wm = b - a; if (wm < 0) wm += 1440; wm = Math.max(0, wm - brk); hours = { firstStart: f.shiftStart, lastEnd: f.shiftEnd, workMinutes: wm, overtimeMinutes: Math.max(0, wm - std * 60), standardHours: std }; }
    else hours = { workMinutes: 0, overtimeMinutes: 0 };
  }
  const otMin = hours.overtimeMinutes ?? num(f.overtimeMinutes), overtimePay = Math.round(otMin / 60 * num(cfg.overtimeRate));
  const hash = 'ETEV-' + (await hmac(env.SESSION_SECRET, `${f.plate}|${f.shiftDate}|${actualKm}|${cashDeposited}`)).slice(0, 10).toUpperCase();
  return { ...f, startKm, endKm, chargingKm, batterySoc, lowBatteryPct, warnBatteryPct, battLockGate, actualKm, nextDayStartKm, cabbyTrips, cabbyKm, cabbyAccept, cabbyCash,
    yangoTrips, yangoKm, yangoCash, appTotalKm, authorizedCeilingKm, kmState, excessKm, kmPenaltyEtb, cabbyBonus, cabbyTierText,
    yangoBonus, yangoTierText, totalCombinedBonus, totalCashDue, cashDeposited, txnRef, cashVariance, shortfall, bonusDeduction, driverMustPay, penaltyFromBonus, penaltyDebt, netDriverBalance,
    lateFine, ...rt, cashRule, appCash, ...(teleOverApp ? { teleOverApp } : {}), ...(rsv ? { reserveAllowKm, reserveBonus } : {}),
    teleTotal: Math.max(0, num(f.teleTotal)), // passenger Telebirr paid to the vehicle's company QR (not part of the cash to deposit)
    ...hours, overtimePay,
    isCleared, hash, supervisor, waived: !!waive, waivedPenalty, waiveReason: waive ? String(f.waiveReason || '').trim().slice(0, 120) : '',
    rates: Object.fromEntries(RATE_KEYS.map(k => [k, cfg[k]])) };
}
function report(s, status) {
  const lowBatt = s.lowBatteryPct ?? battCfgForMode(s.rates || {}, s.mode).alertPct;
  if (s.mode === 'route') {
    return `🟢 *ETEV ROUTE / ZONE DIGITAL LOGBOOK* (${status})
📅 Date: ${s.shiftDate}${s.shiftName ? ` · ${s.shiftName}` : ''} | 🔒 Hash: #${s.hash}${lateLine(s)}
🚐 Vehicle: *${s.plate}* | 👤 Driver: ${s.driverName}
👔 Verified By: ${s.supervisor}
🛣️ Route: *${s.routeName}*
🔄 Round Trips: *${s.roundTrips}*${s.tripsCount ? ` (${s.tripsCount} trips)` : ''}${s.tripsCount ? `
👥 Passengers: *${s.passengers}* (${s.fullFare} ETB × ${s.paxFull} · ${s.shortFare} ETB × ${s.paxShort})
⏱️ Hours: ${s.firstStart || '?'} → ${s.lastEnd || '?'} = *${fmtMin(s.workMinutes)}*${s.breakMinutes ? ` (☕ ${s.breakMinutes} min break off)` : ''}${s.overtimeMinutes ? ` · ⏰ Overtime *${fmtMin(s.overtimeMinutes)}*` : ''}${s.manualTimes ? `\n✎ ${s.manualTimes} trip time(s) typed by hand` : ''}` : ''}
-----------------------------------------
📏 Odometer: ${s.startKm} → ${s.endKm} (*${s.actualKm} KM*)
⚡ Charge KM: +${s.chargingKm} ➔ Next Start: *${s.nextDayStartKm} KM*
🔋 Battery: ${s.batteryStart != null ? s.batteryStart + '% → ' : ''}*${s.batterySoc}%*${s.batterySoc < lowBatt ? '\n🚨 *ADMIN ALERT:* Low battery!' : ''}
-----------------------------------------${s.tripsCount ? `
🎫 Fares expected: ${s.expectedRevenue} ETB | Collected: ${s.cashTotal + s.teleTotal} ETB (cash ${s.cashTotal} + Telebirr ${s.teleTotal})${s.revenueGap > 0 ? `\n⚠️ *Fares short:* ${s.revenueGap} ETB` : s.revenueGap < 0 ? `\nℹ️ Collected ${-s.revenueGap} ETB more than the fares` : ' ✅'}` : ''}
💰 Cash to deposit: ${s.totalCashDue} ETB | Deposited: ${s.cashDeposited} ETB (Ref: ${s.txnRef})
${s.routeTarget ? `🎯 Target: ${s.routeTarget} ETB | Revenue: ${s.routeRevenue} ETB (*${s.routePct}%*) ➔ ${s.routeBonusLost ? `❌ Bonus ${s.routeBonusEarned} lost — ${s.routeBonusLost}` : `Bonus *+${s.routeBonus} ETB*`}\n` : ''}${s.shortfall ? `⚠️ *Cash Shortfall:* ${s.shortfall} ETB — Driver must pay: ${s.driverMustPay} ETB\n` : ''}🚦 *GATE PASS:* ${s.isCleared ? '✅ CLEARED FOR DISPATCH' : '🛑 LOCKED / SUSPENDED'}`;
  }
  return `📋 *ETEV FLEET DAILY AUDIT REPORT* (${status})
🔒 *Hash:* #${s.hash} | *Date:* ${s.shiftDate}${s.shiftName ? ` · ${s.shiftName}` : ''}${lateLine(s)}
🚐 *Vehicle:* ${s.plate} | *Driver:* ${s.driverName}
👔 *Verified By:* ${s.supervisor}
-----------------------------------------
🛣️ *KM & NEXT-DAY ROLLOVER*
• Shift KM: ${s.actualKm} (${s.startKm} → ${s.endKm}) | Charging KM: +${s.chargingKm}
• Tomorrow Start KM: *${s.nextDayStartKm}* | Battery: *${s.batterySoc}%*${s.batterySoc < lowBatt ? '\n🚨 *ADMIN ALERT:* Low battery!' : ''}
• Auth Limit: ${s.authorizedCeilingKm} KM | Excess Penalty: -${s.kmPenaltyEtb} ETB
-----------------------------------------
🎯 *BONUS & CASH*
• Cabby: ${s.cabbyTrips} trips (${s.cabbyAccept}%) ➔ +${s.cabbyBonus} ETB
• Yango: ${s.yangoTrips} trips ➔ +${s.yangoBonus} ETB
${s.reserve ? `• 🟣 Cabby Reserve: ${s.reserve.runs} run(s) · ${s.reserve.pax} pax · ${s.reserve.km} KM${s.reserve.places?.length ? ` (from ${s.reserve.places.join(', ')})` : ''}${s.reserveBonus ? ` ➔ +${s.reserveBonus} ETB` : ''} — paid online, no cash\n` : ''}• *Total Bonus:* +${s.totalCombinedBonus} ETB
• ${s.cashRule === 2 && s.teleTotal ? `App cash ${s.appCash} − Telebirr ${s.teleTotal} = *Cash Due ${s.totalCashDue}*` : `Cash Due: ${s.totalCashDue}`} | Deposited: ${s.cashDeposited} (Ref: ${s.txnRef}${DEP_METHODS[s.depMethod] ? ' · ' + DEP_METHODS[s.depMethod] : ''})${s.cashRule !== 2 && s.teleTotal ? `\n• Telebirr to company QR: ${s.teleTotal} ETB` : ''}${s.teleOverApp ? `\n⚠️ Telebirr is ${s.teleOverApp} ETB more than the app cash` : ''}
${s.shortfall ? `• ⚠️ *Cash Shortfall:* ${s.shortfall} ETB (from bonus: ${s.bonusDeduction} | Driver must pay: ${s.driverMustPay})\n` : ''}${s.kmPenaltyEtb ? `• KM penalty ${s.kmPenaltyEtb} ETB (from bonus: ${s.penaltyFromBonus ?? 0}${s.penaltyDebt ? ` | *added to debt: ${s.penaltyDebt}*` : ''})\n` : ''}${s.waivedPenalty ? `• 👑 Penalty ${s.waivedPenalty} ETB waived: ${s.waiveReason}\n` : ''}• Net Driver Balance: ${s.netDriverBalance >= 0 ? '+' : ''}${s.netDriverBalance} ETB
🚦 *GATE PASS:* ${s.isCleared ? '✅ CLEARED FOR DISPATCH' : '🛑 LOCKED / SUSPENDED'}`;
}
// v4.7 🌙 Late report: filled with no internet (sent from the phone's 📤 outbox) or sent more than lateMarkHours after the work ended.
// Times come from the phone, so the phone clock is compared with the server clock and a big difference is flagged.
function sentInfo(sent, calc, cfg, nowMs = Date.now()) {
  const o = sent && typeof sent === 'object' ? sent : {}, H = Math.min(48, Math.max(1, num(cfg.lateMarkHours) || 3));
  const cn = num(o.clientNow), skew = cn ? Math.round((cn - nowMs) / 60000) : 0;
  const clockSkewMin = Math.abs(skew) >= 10 ? Math.max(-9999, Math.min(9999, skew)) : 0;
  // when the work ended (Addis time); with no end time, the end of the shift day
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(calc.lastEnd || ''));
  let endMs = Date.parse(`${calc.shiftDate}T${hm ? `${hm[1].padStart(2, '0')}:${hm[2]}` : '23:59'}:00+03:00`);
  const fs = /^(\d{1,2}):(\d{2})$/.exec(String(calc.firstStart || ''));
  if (hm && fs && +hm[1] * 60 + +hm[2] < +fs[1] * 60 + +fs[2]) endMs += 864e5; // worked past midnight
  const hoursAfter = Number.isFinite(endMs) ? Math.round((nowMs - endMs) / 36e5 * 10) / 10 : null;
  let savedAt = null;
  if (o.queued) { const t = Date.parse(o.savedAt); if (t && t <= nowMs + 6e5 && t > nowMs - 40 * 864e5) savedAt = new Date(t).toISOString(); }
  const late = o.queued || (hoursAfter != null && hoursAfter > H)
    ? { queued: !!o.queued, ...(savedAt ? { savedAt } : {}), sentAt: new Date(nowMs).toISOString(), hoursAfter: hoursAfter != null && hoursAfter > 0 ? hoursAfter : null } : null;
  return { late, clockSkewMin };
}
const addisTs = iso => iso ? new Date(Date.parse(iso) + 3 * 36e5).toISOString().slice(5, 16).replace('T', ' ') : '';
const lateLine = s => s.late ? `\n🌙 *Sent late (ዘግይቶ የተላከ)*${s.late.queued ? ` — filled with no internet${s.late.savedAt ? ' at ' + addisTs(s.late.savedAt) : ''}` : ''}${s.late.hoursAfter != null ? ` · ${s.late.hoursAfter} h after work ended` : ''} · sent ${addisTs(s.late.sentAt)}` : '';
// Alert reasons for one shift (used for Telegram alerts and the dashboard)
function alertReasons(s, cfg, expectedStartKm, approved) {
  const why = [];
  const bCfg = battCfgForMode(cfg || s.rates || {}, s.mode);
  const lowBatt = Math.min(100, Math.max(0, num(s.lowBatteryPct ?? bCfg.alertPct)));
  const warnBatt = Math.min(100, Math.max(lowBatt, num(s.warnBatteryPct ?? bCfg.warnPct)));
  const catLabel = s.mode === 'route' ? '🟢 Route' : '🔵 Cabby';
  if (s.batterySoc < lowBatt) why.push(`🔋 Low battery ${s.batterySoc}% (${catLabel} critical <${lowBatt}%)`);
  else if (s.batterySoc < warnBatt) why.push(`🪫 Battery warning ${s.batterySoc}% (${catLabel} advisory <${warnBatt}%)`);
  if (s.mode === 'route' && num(s.revenueGap) > 0) why.push(`🎫 Fares short ${s.revenueGap} ETB (passengers say ${s.expectedRevenue}, collected ${num(s.cashTotal) + num(s.teleTotal)}${s.tripIssues?.length ? `; trips ${s.tripIssues.map(t => t.n).join(', ')}` : ''})`);
  if (s.actualKm > cfg.maxDailyKm) why.push(`📏 ${s.actualKm} KM in one shift (limit ${cfg.maxDailyKm})`);
  if (expectedStartKm != null && Math.abs(s.startKm - expectedStartKm) > 0.5) why.push(`🔢 Odometer gap: start ${s.startKm} but expected ${expectedStartKm}`);
  if (s.shortfall) why.push(`💰 Cash short ${s.shortfall} ETB (driver pays ${s.driverMustPay})`);
  if (s.teleOverApp) why.push(`📱 Telebirr ${num(s.teleTotal)} ETB is more than the app cash ${s.appCash} ETB — another trip's payment mixed in?`);
  if (s.kmState === 'EXCESS') why.push(`⚠️ Excess ${Math.round(s.excessKm)} KM`);
  if (s.kmState === 'EXCESS' && s.reserve?.last) { const L = s.reserve.last; why.push(`🟣 The last Cabby Reserve run ended at ${L.endHm || '?'}${L.minToShiftEnd != null ? ` (${L.minToShiftEnd} min before the shift end)` : ''}${L.kmToReport != null ? ` · ${L.kmToReport} km straight from there to where the report was sent (≈${r1(L.kmToReport * 1.3)} km by road)` : ' · no GPS'}${L.lat != null ? ` · map: https://maps.google.com/?q=${L.lat},${L.lng}` : ''} — decide the excess KM`); }
  if (s.breakOver) why.push(`☕ Breaks over the limit (${s.breakCount} break(s), ${s.breakMinutes} min)`);
  if (s.incidents) why.push(`🚨 ${s.incidents} incident(s) reported that day`);
  if (s.teleLog && Math.abs(num(s.teleTotal) - s.teleLog.sum) >= 1) why.push(`📱 Telebirr: report says ${num(s.teleTotal)} ETB, the ${s.teleLog.n} payment SMS add up to ${s.teleLog.sum} ETB`);
  if (s.inspection && s.inspection.km != null && Math.abs(num(s.inspection.km) - s.startKm) > 1) why.push(`📋 Odometer at the inspection ${s.inspection.km} but the report starts at ${s.startKm}`);
  if (s.inspection && s.inspection.status === 'issue') why.push('📋 The shift inspection found a problem');
  if (s.doubleShift && s.doubleWeek > num(cfg.maxDoubleWeek)) why.push(`🔁 ${s.driverName}: ${s.doubleWeek} double shifts in 7 days (limit ${cfg.maxDoubleWeek})`);
  if (s.lateMin) why.push(`⏰ Started ${s.lateMin} min late${s.lateFine ? ` — fine ${s.lateFine} ETB (${s.lateCount} late starts this month)` : ''}`);
  if (s.reliefLateMin) why.push(`🔁 The next driver came ${s.reliefLateMin} min late — overtime for ${s.driverName}`);
  if (s.clockSkewMin) why.push(`🕒 Phone clock is off by ${s.clockSkewMin > 0 ? '+' : ''}${s.clockSkewMin} min — check the trip times`);
  if (approved && !s.isCleared) why.push('🛑 Gate pass LOCKED');
  return why;
}
// The old shared group (TG_CHAT_ID). Personal messages go through notify()/notifyDriver().
async function tg(env, text, chat = env.TG_CHAT_ID) {
  if (!env.TG_TOKEN || !chat) return false;
  for (const pm of ['Markdown', undefined]) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: pm, disable_web_page_preview: true }),
      });
      if ((await r.json()).ok) return true;
    } catch {}
  }
  return false;
}
const rowOut = r => ({ id: r.id, plate: r.plate, shiftDate: r.shift_date, shiftNo: r.shift_no || 1, status: r.status, submittedBy: r.submitted_by,
  approvedBy: r.approved_by, createdAt: r.created_at, rejectReason: r.reject_reason || '', rejectFields: r.reject_fields ? String(r.reject_fields).split(',') : [], ...JSON.parse(r.calc) });
// ↩️ What an approver can mark as wrong when returning a report (the driver sees these fields in red)
const REJ_FIELDS = { endKm: 'End KM (መድረሻ ኪ.ሜ)', batterySoc: 'ባትሪ %', times: 'የስራ ሰዓት', trips: 'የጉዞ ብዛት', appKm: 'የአፕ ኪ.ሜ', cash: 'የአፕ ካሽ', teleTotal: 'ቴሌብር', deposit: 'ገቢ የተደረገ ብር / መንገድ', txnRef: 'የደረሰኝ ቁጥር', photos: 'ፎቶ', route: 'የቀጠና ጉዞዎች' };
// fields of the driver's form the Super Admin's change log compares (from → to)
const DIFF_KEYS = ['shiftDate', 'shiftNo', 'endKm', 'batterySoc', 'shiftStart', 'shiftEnd', 'cabbyTrips', 'cabbyKm', 'cabbyAccept', 'cabbyCash', 'yangoTrips', 'yangoKm', 'yangoCash', 'teleTotal', 'cashDeposited', 'depMethod', 'txnRef', 'chargingKm', 'roundTrips', 'routeCash', 'batteryStart'];
const vehOut = v => ({ plate: v.plate, driver: v.driver, driverId: v.driver_id ?? null, phone: v.phone, nextStartKm: v.next_start_km, mode: v.mode || 'any', teleId: v.tele_id || '', seats: v.seats ?? 4,
  serviceEveryKm: v.service_every_km || 0, lastServiceKm: v.last_service_km || 0, lastServiceDate: v.last_service_date || '',
  status: v.status || 'ok', statusSince: v.status_since || '', repairUntil: v.repair_until || '', statusNote: v.status_note || '' });
// Service is due when the odometer is within serviceWarnKm of (last service + interval). Not tracked until both are set.
function serviceState(v, cfg) {
  const every = num(v.service_every_km), last = num(v.last_service_km);
  if (!every || !last) return null;
  const dueAt = last + every, left = dueAt - num(v.next_start_km);
  return left <= cfg.serviceWarnKm ? { plate: v.plate, driver: v.driver, dueAt, left, overdue: left < 0 } : null;
}
// Money owed is the DRIVER's, not the vehicle's: keyed by driver id
async function balances(env, did, asOf = null) {
  const prep = (sql, args) => { const st = env.DB.prepare(sql); return args.length ? st.bind(...args) : st; };
  const w = (did ? ' AND driver_id=?' : ' AND driver_id IS NOT NULL') + (asOf ? ' AND shift_date<=?' : '');
  const wPay = (did ? ' AND driver_id=?' : ' AND driver_id IS NOT NULL') + (asOf ? ' AND pay_date<=?' : '');
  const wTele = (did ? ' AND driver_id=?' : ' AND driver_id IS NOT NULL') + (asOf ? ' AND tdate<=?' : '');
  const args = [...(did ? [did] : []), ...(asOf ? [asOf] : [])];
  const owedRows = (await prep(`SELECT driver_id k,SUM(n_mp) mp,SUM(n_pd) pd,SUM(n_pen) pen,SUM(n_pfb) pfb,SUM(n_waived) wv FROM shifts WHERE status='APPROVED'${w} GROUP BY driver_id`, args).all()).results;
  const paidRows = (await prep(`SELECT driver_id k,kind,SUM(amount) s FROM payments WHERE 1=1${wPay} GROUP BY driver_id,kind`, args).all()).results;
  const by = {}, mk = () => ({ owed: 0, paid: 0, cash: { owed: 0, paid: 0 }, penalty: { owed: 0, paid: 0, total: 0, fromBonus: 0, waived: 0 } });
  for (const r of owedRows) { const o = by[r.k] ||= mk(); o.cash.owed += num(r.mp); o.penalty.owed += num(r.pd); o.penalty.total += num(r.pen); o.penalty.fromBonus += num(r.pfb); o.penalty.waived += num(r.wv); }
  for (const r of paidRows) { const o = by[r.k] ||= mk(); (r.kind === 'penalty' ? o.penalty : o.cash).paid += num(r.s); }
  // 💸 Telebirr payments a driver recorded that never arrived, put on the driver's debt by Finance
  for (const r of (await prep(`SELECT driver_id k,SUM(res_amt) s FROM tele_txn WHERE res='debt'${wTele} GROUP BY driver_id`, args).all()).results) { const o = by[r.k] ||= mk(); o.cash.owed += num(r.s); o.teleDebt = num(r.s); }
  for (const k in by) {
    const o = by[k];
    o.owed = o.cash.owed + o.penalty.owed; o.paid = o.cash.paid + o.penalty.paid; o.balance = o.owed - o.paid;
    o.cash.balance = o.cash.owed - o.cash.paid; o.penalty.balance = o.penalty.owed - o.penalty.paid;
  }
  return by;
}
const ZERO_BAL = { owed: 0, paid: 0, balance: 0, cash: { owed: 0, paid: 0, balance: 0 }, penalty: { owed: 0, paid: 0, total: 0, fromBonus: 0, waived: 0, balance: 0 } };
// Who drives a vehicle on a date: a day assignment wins, otherwise the vehicle's main driver
async function driverFor(env, plate, date, shiftNo) {
  // 📅 the published or planned roster wins for that shift
  if (shiftNo) { const r = await env.DB.prepare("SELECT driver_id FROM roster WHERE rdate=? AND plate=? AND shift_no=? AND kind='work'").bind(date, plate, shiftNo).first(); if (r && r.driver_id != null) return r.driver_id; }
  const a = await env.DB.prepare('SELECT driver_id FROM assignments WHERE plate=? AND adate=?').bind(plate, date).first();
  if (a) return a.driver_id;
  const v = await env.DB.prepare('SELECT driver_id FROM vehicles WHERE plate=?').bind(plate).first();
  return v?.driver_id ?? null;
}
// Which vehicle a driver has on a date (null = none)
async function plateFor(env, did, date, shiftNo) {
  // 📅 a driver on the plan that day drives the planned vehicle (that shift's, else the first planned one) — not their usual one
  const ro = (await env.DB.prepare("SELECT plate, shift_no FROM roster WHERE driver_id=? AND rdate=? AND kind='work' ORDER BY shift_no").bind(did, date).all()).results;
  if (ro.length) return (ro.find(r => r.shift_no === shiftNo) || ro[0]).plate;
  const a = await env.DB.prepare('SELECT plate FROM assignments WHERE driver_id=? AND adate=? LIMIT 1').bind(did, date).first();
  if (a) return a.plate;
  const v = await env.DB.prepare('SELECT plate FROM vehicles WHERE driver_id=? AND plate NOT IN (SELECT plate FROM assignments WHERE adate=? AND driver_id<>?) ORDER BY plate LIMIT 1').bind(did, date, did).first();
  return v?.plate ?? null;
}
// ---- v4.9 📅 shifts ----
const hmMin = x => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(x || '')); return m ? +m[1] * 60 + +m[2] : null; };
function shiftDefs(cfg, grp) {
  const list = (cfg.shiftTimes || DEF.shiftTimes)[grp === 'route' ? 'route' : 'cabby'];
  return Array.isArray(list) && list.length ? list : DEF.shiftTimes.cabby;
}
const shiftDef = (cfg, grp, no) => shiftDefs(cfg, grp).find(d => d.no === no) || null;
// The shift running at an Addis clock time (before the first start = the first shift)
function shiftAt(cfg, grp, hm) { const t = hmMin(hm), d = shiftDefs(cfg, grp); let cur = d[0]; for (const x of d) if (t != null && hmMin(x.start) <= t) cur = x; return cur.no; }
// Ordering of shifts: a later shift = a later day, or the same day with a higher shift number
const SHIFT_AFTER = "(shift_date>? OR (shift_date=? AND shift_no>?))", SHIFT_BEFORE = "(shift_date<? OR (shift_date=? AND shift_no<?))";
// 📋 Inspection checklist: serious = the vehicle waits for the Fleet Admin
const INSP_ITEMS = { tyres: { l: 'ጎማዎች (Tyres)', serious: true }, brakes: { l: 'ፍሬን (Brakes)', serious: true }, warning: { l: 'ዳሽቦርድ ማስጠንቀቂያ መብራት (Warning lights)', serious: true },
  lights: { l: 'መብራቶችና ፍሬቻ (Lights)' }, mirrors: { l: 'መስታወቶች (Mirrors)' }, clean: { l: 'የውስጥ ንጽህና (Clean inside)' }, body: { l: 'የውጭ ጭረት / ጉዳት (Body damage)' },
  seats: { l: 'ወንበሮችና በሮች (Seats & doors)' }, safety: { l: 'የእሳት ማጥፊያ እና የመጀመሪያ እርዳታ (Extinguisher, first aid)' },
  tv: { l: '📺 ቲቪ (TV)' }, flash: { l: '💾 ፍላሽ (Flash drive)' }, speaker: { l: '🔊 ስፒከር (Speaker)' }, phone: { l: '📱 ስልክ (Phone)' }, led: { l: '🪧 የላይ LED ስክሪን (Roof LED screen)' } };
const INSP_SIDES = ['front', 'back', 'left', 'right'];
const inspOut = r => r && ({ id: r.id, plate: r.plate, date: r.idate, shiftNo: r.shift_no, driverId: r.driver_id, outDriverId: r.out_driver_id, km: r.km, kmExpected: r.km_expected, battery: r.battery,
  items: JSON.parse(r.items || '{}'), note: r.note, serious: !!r.serious, status: r.status, lateMin: r.late_min, otMin: r.ot_min, at: r.at, decidedBy: r.decided_by || '', decision: r.decision || '' });
// ---- v4.9 📅 weekly plan ----
const DOW_AM = ['እሁድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'];
const LEAVE_KINDS = { leave: '🏖 ፈቃድ (Leave)', sick: '🤒 ህመም (Sick)', rest: '😴 የእረፍት ቀን (Day off)' };
const dowOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
const ddmm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const rosterChannel = async env => { try { return JSON.parse((await getKV(env, 'tg_roster_channel')) || 'null'); } catch { return null; } };
async function rosterWeek(env, cfg, ws) {
  const days = Array.from({ length: 7 }, (_, i) => dAdd(ws, i));
  const vehicles = (await env.DB.prepare('SELECT plate,mode,status,repair_until,driver_id FROM vehicles ORDER BY plate').all()).results;
  const drivers = (await env.DB.prepare('SELECT id,name,phone,active,home_plate,home_shift,rest_dow,standby FROM drivers WHERE active=1 ORDER BY name').all()).results;
  const rows = (await env.DB.prepare('SELECT * FROM roster WHERE rdate>=? AND rdate<=?').bind(days[0], days[6]).all()).results;
  const leaves = (await env.DB.prepare("SELECT * FROM leaves WHERE status='approved' AND to_date>=? AND from_date<=?").bind(days[0], days[6]).all()).results;
  return { days, vehicles, drivers, rows, leaves };
}
const offOn = (W, did, date) => { const d = W.drivers.find(x => x.id === did); return (d && d.rest_dow === dowOf(date)) ? 'rest' : W.leaves.some(l => l.driver_id === did && l.from_date <= date && l.to_date >= date) ? 'leave' : ''; };
// Draft: each vehicle-shift gets its usual driver; rest days and approved days off are filled from the standby drivers
function rosterDraft(cfg, W) {
  const out = [], load = {};
  for (const date of W.days) {
    const used = new Set(), gaps = [];
    for (const v of W.vehicles) {
      if (v.status === 'repair' && (!v.repair_until || v.repair_until >= date)) continue;
      for (const sd of shiftDefs(cfg, v.mode === 'route' ? 'route' : 'cabby')) {
        const home = W.drivers.find(d => d.home_plate === v.plate && d.home_shift === sd.no && !d.standby) || (sd.no === 1 && !W.drivers.some(d => d.home_plate === v.plate) ? W.drivers.find(d => d.id === v.driver_id && !d.standby && !d.home_plate) : null); // no pairing: the vehicle's main driver (unless standby or paired elsewhere)
        if (home && !offOn(W, home.id, date) && !used.has(home.id)) { used.add(home.id); load[home.id] = (load[home.id] || 0) + 1; out.push({ date, plate: v.plate, shiftNo: sd.no, driverId: home.id }); }
        else if (home || W.drivers.some(d => d.home_plate === v.plate && d.home_shift === sd.no) || (sd.no === 1 && W.drivers.some(d => d.id === v.driver_id && !d.standby && !d.home_plate))) gaps.push({ plate: v.plate, shiftNo: sd.no });
      }
    }
    for (const g of gaps) {
      const sb = W.drivers.filter(d => d.standby && !used.has(d.id) && !offOn(W, d.id, date)).sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0))[0];
      if (sb) { used.add(sb.id); load[sb.id] = (load[sb.id] || 0) + 1; }
      out.push({ date, plate: g.plate, shiftNo: g.shiftNo, driverId: sb ? sb.id : null });
    }
  }
  return out;
}
// One driver's plan as text (for Telegram and the 🔔)
async function rosterText(env, cfg, did, days) {
  const rows = (await env.DB.prepare("SELECT r.*, v.mode FROM roster r LEFT JOIN vehicles v ON v.plate=r.plate WHERE r.driver_id=? AND r.rdate>=? AND r.rdate<=? AND r.kind='work' ORDER BY r.rdate, r.shift_no").bind(did, days[0], days[days.length - 1]).all()).results;
  return days.map(d => { const mine = rows.filter(r => r.rdate === d); return `${DOW_AM[dowOf(d)]} ${ddmm(d)}፦ ${mine.length ? mine.map(r => { const sd = shiftDef(cfg, r.mode === 'route' ? 'route' : 'cabby', r.shift_no); return `${r.plate} · ${sd ? `${sd.name} ${sd.start}–${sd.end}` : 'ፈረቃ ' + r.shift_no}`; }).join(' + ') : '😴 እረፍት'}`; }).join('\n');
}
// Old-style "vehicle + driver + PIN" rows (setup, Admin › Vehicles) keep working: they create or update the vehicle's main driver
async function upsertMainDriver(env, plate, name, phone, pin) {
  const v = await env.DB.prepare('SELECT driver_id FROM vehicles WHERE plate=?').bind(plate).first();
  let ph = normPhone(phone);
  if (ph && await env.DB.prepare('SELECT 1 x FROM drivers WHERE phone=? AND id IS NOT ?').bind(ph, v?.driver_id ?? null).first()) ph = '';
  const nm = String(name || '').trim().slice(0, 60) || plate;
  if (v?.driver_id) {
    await env.DB.prepare("UPDATE drivers SET name=?, phone=CASE WHEN ?<>'' THEN ? ELSE phone END WHERE id=?").bind(nm, ph, ph, v.driver_id).run();
    if (pin) await env.DB.prepare('UPDATE drivers SET pin_hash=?, pin_ver=pin_ver+1 WHERE id=?').bind(await hashPin(pin), v.driver_id).run();
    return v.driver_id;
  }
  const did = (await env.DB.prepare('INSERT INTO drivers(name,phone,pin_hash,created_at) VALUES(?,?,?,?)').bind(nm, ph, await hashPin(pin || crypto.randomUUID()), now()).run()).meta.last_row_id;
  await env.DB.prepare('UPDATE vehicles SET driver_id=? WHERE plate=?').bind(did, plate).run();
  return did;
}
// vehicles.driver / phone mirror the main driver's name and phone (used in reports and Telegram)
const syncVehicleDrivers = env => env.DB.prepare("UPDATE vehicles SET driver=COALESCE((SELECT name FROM drivers WHERE id=vehicles.driver_id),driver), phone=COALESCE((SELECT phone FROM drivers WHERE id=vehicles.driver_id),phone) WHERE driver_id IS NOT NULL").run();
const driverOut = (d, withSalary) => ({ id: d.id, name: d.name, phone: d.phone, active: !!d.active, ...(withSalary ? { salary: d.salary || 0 } : {}) });
const debtLocked = (cfg, b) => num(cfg.debtLockEtb) > 0 && num(b?.balance) > num(cfg.debtLockEtb);

// ---- Finance (v4.1): money in / money out, by day, vehicle, source and category ----
const dAdd = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const monthDays = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const monthAdd = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
// An expense is spread evenly over the days of its months (an annual insurance = 12 months), so one payment does not distort a month
const expSpan = e => { const st = e.exp_date.slice(0, 7) + '-01', ym = monthAdd(e.exp_date.slice(0, 7), Math.max(1, e.months) - 1), en = ym + '-' + String(monthDays(ym)).padStart(2, '0'); return { st, en, daily: num(e.amount) / (dDiff(st, en) + 1) }; };
const bonusPayable = r => Math.max(0, num(r.totalCombinedBonus) - bdOf(r) - pfbOf(r));
// Salary days: a driver is paid for each day they had a vehicle (main driver, unless someone else was assigned that day, or a day assignment),
// counted from the day the driver was added. Returns { driverId: { date: plate } }.
async function salaryDays(env, from, to) {
  const mains = (await env.DB.prepare('SELECT plate,driver_id FROM vehicles WHERE driver_id IS NOT NULL').all()).results;
  const asg = (await env.DB.prepare('SELECT plate,adate,driver_id FROM assignments WHERE adate>=? AND adate<=?').bind(from, to).all()).results;
  const added = Object.fromEntries((await env.DB.prepare('SELECT id,created_at FROM drivers').all()).results.map(d => [d.id, (d.created_at || '').slice(0, 10)]));
  const A = {}; for (const a of asg) A[a.plate + '|' + a.adate] = a.driver_id;
  const out = {};
  const mark = (did, d, plate) => { if (did == null || (added[did] && d < added[did])) return; (out[did] ||= {})[d] ||= plate; };
  for (let d = from; d <= to; d = dAdd(d, 1)) {
    for (const v of mains) mark(A[v.plate + '|' + d] ?? v.driver_id, d, v.plate);
    for (const a of asg) if (a.adate === d && !mains.some(v => v.plate === a.plate)) mark(a.driver_id, d, a.plate);
  }
  return out;
}
const MONEY_KEYS = ['dep', 'tele', 'pay', 'rsv', 'ygb', 'chg', 'exp', 'fix', 'com', 'sal', 'ot', 'bonus', 'ygs'];
const MONEY_IN = ['dep', 'tele', 'pay', 'rsv', 'ygb'], MONEY_OUT = ['chg', 'exp', 'fix', 'com', 'sal', 'ot', 'bonus', 'ygs'];
// group = '' (everything) | 'cabby' | 'route'. Reports count by their own mode; vehicle costs (charging, expenses, salary, payments) by the
// vehicle's registered mode. Company-wide expenses and "either" vehicles' costs appear only in the full view.
const modeOf = r => (r.mode === 'route' ? 'route' : 'cabby');
async function plateModes(env) { return Object.fromEntries((await env.DB.prepare('SELECT plate,mode FROM vehicles').all()).results.map(v => [v.plate, v.mode || 'any'])); }
async function moneyFlow(env, cfg, from, to, group = '') {
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const PM = await plateModes(env), inG = plate => !group || PM[plate] === group;
  // Two small sums instead of one row per vehicle per day: totals per day (for the chart) and per vehicle (for the table)
  const SUMS = 'SUM(n_dep) dep, SUM(n_tele) tele, SUM(n_bonuspay) bp, SUM(n_ot) ot, SUM(n_pax) pax, SUM(n_km) km, COUNT(*) n, SUM(n_due) due, SUM(n_cabbycash) cc, SUM(n_yangocash) yc';
  const W = `FROM shifts WHERE status='APPROVED' AND shift_date>=? AND shift_date<=?${group ? ' AND n_mode=?' : ''}`, A = [from, to, ...(group ? [group] : [])];
  const byDay = await q(`SELECT shift_date d, n_mode m, ${SUMS} ${W} GROUP BY shift_date, n_mode`, ...A);
  const byPlate = await q(`SELECT plate, ${SUMS} ${W} GROUP BY plate`, ...A);
  const chg = (await q('SELECT plate,chg_date,kwh,cost FROM charging WHERE chg_date>=? AND chg_date<=?', from, to)).filter(c => inG(c.plate));
  const pays = (await q('SELECT plate,kind,amount,pay_date FROM payments WHERE pay_date>=? AND pay_date<=?', from, to)).filter(p => inG(p.plate));
  const exps = (await q('SELECT id,plate,exp_date,category,amount,months FROM expenses WHERE exp_date<=?', to)).filter(e => inG(e.plate));
  const drivers = await q('SELECT id,name,salary FROM drivers WHERE salary>0');
  const sd = await salaryDays(env, from, to);
  const blank = () => ({ dep: 0, tele: 0, pay: 0, rsv: 0, ygb: 0, chg: 0, exp: 0, fix: 0, com: 0, sal: 0, ot: 0, bonus: 0, ygs: 0, pax: 0, km: 0, kwh: 0, shifts: 0 });
  const D = {}, V = {}, cats = {}, src = { cabby: 0, yango: 0, route: 0, telebirr: 0 };
  for (let d = from; d <= to; d = dAdd(d, 1)) D[d] = blank();
  const add = (d, plate, k, v) => { if (!D[d] || !v) return; D[d][k] += v; (V[plate || ''] ||= blank())[k] += v; };
  const KS = [['dep', 'dep'], ['tele', 'tele'], ['bonus', 'bp'], ['ot', 'ot'], ['pax', 'pax'], ['km', 'km'], ['shifts', 'n']];
  for (const r of byDay) {
    if (D[r.d]) for (const [k, c] of KS) D[r.d][k] += num(r[c]);
    if (r.m === 'route') src.route += num(r.due); else { src.cabby += num(r.cc); src.yango += num(r.yc); }
    src.telebirr += num(r.tele);
  }
  for (const r of byPlate) { const o = V[r.plate || ''] ||= blank(); for (const [k, c] of KS) o[k] += num(r[c]); }
  for (const c of chg) { add(c.chg_date, c.plate, 'chg', num(c.cost)); add(c.chg_date, c.plate, 'kwh', num(c.kwh)); }
  for (const p of pays) add(p.pay_date, p.plate, 'pay', num(p.amount));
  for (const e of exps) {
    const { st, en, daily } = expSpan(e);
    const a = st > from ? st : from, b = en < to ? en : to;
    for (let d = a; d <= b; d = dAdd(d, 1)) { add(d, e.plate, 'exp', daily); cats[e.category] = (cats[e.category] || 0) + daily; }
  }
  for (const dr of drivers) for (const [d, plate] of Object.entries(sd[dr.id] || {})) if (inG(plate)) add(d, plate, 'sal', num(dr.salary) / monthDays(d.slice(0, 7)));
  // 📈 v4.9: platform commission on app fares, fixed costs spread by day, Cabby Reserve payouts, Yango weekly goal bonus and the drivers' share of it
  const cm = cfg.commission || {};
  if (group !== 'route' && (num(cm.cabby) || num(cm.yango)))
    for (const r of await q(`SELECT shift_date d, plate, SUM(n_cabbycash) cc, SUM(n_yangocash) yc, SUM(n_tele) t FROM shifts WHERE status='APPROVED' AND n_mode='cabby' AND shift_date>=? AND shift_date<=? GROUP BY shift_date, plate`, from, to)) {
      const cc = num(r.cc), yc = num(r.yc), k = cc + yc > 0 ? cc / (cc + yc) : 1, gc = cc + num(r.t) * k, gy = yc + num(r.t) * (1 - k); // app fares = cash + the Telebirr-paid trips
      add(r.d, r.plate, 'com', (gc * num(cm.cabby) + gy * num(cm.yango)) / 100); }
  for (const fc of cfg.fixedCosts || []) {
    if (fc.plate && !inG(fc.plate)) continue; if (!fc.plate && group) continue;
    for (let d = from; d <= to; d = dAdd(d, 1)) { if (fc.from && d < fc.from) continue; if (fc.to && d > fc.to) continue;
      const daily = num(fc.amount) / (fc.per === 'year' ? 365 : monthDays(d.slice(0, 7))); add(d, fc.plate || '', 'fix', daily); cats['fix:' + fc.name] = (cats['fix:' + fc.name] || 0) + daily; }
  }
  if (group !== 'route') {
    for (const b of await q("SELECT plate, substr(at,1,10) d, amount FROM reserve_bookings WHERE status<>'cancel' AND substr(at,1,10)>=? AND substr(at,1,10)<=?", from, to)) if (inG(b.plate)) add(b.d, b.plate, 'rsv', num(b.amount));
    for (const y of await q('SELECT * FROM yango_week WHERE closed=1 AND met=1 AND week>=? AND week<=?', dAdd(from, -6), to)) {
      const d = dAdd(y.week, 6); if (d < from || d > to || !inG(y.plate)) continue;
      add(d, y.plate, 'ygb', num(y.bonus)); add(d, y.plate, 'ygs', Object.values(JSON.parse(y.shares || '{}')).reduce((a, x) => a + num(x), 0));
    }
  }
  const fin = o => { const r = { ...o }; for (const k of MONEY_KEYS) r[k] = r2(r[k]); r.in = r2(MONEY_IN.reduce((a, k) => a + num(o[k]), 0)); r.out = r2(MONEY_OUT.reduce((a, k) => a + num(o[k]), 0)); r.net = r2(r.in - r.out); return r; };
  const tot = blank(); for (const d in D) for (const k in tot) tot[k] += D[d][k];
  return { days: Object.entries(D).map(([date, o]) => ({ date, ...fin(o) })), total: fin(tot),
    vehicles: Object.entries(V).map(([plate, o]) => ({ plate, ...fin(o) })),
    cats: Object.entries(cats).map(([id, v]) => ({ id, name: id.startsWith('fix:') ? '📌 ' + id.slice(4) : (cfg.expenseCats || []).find(c => c.id === id)?.name || id, amount: r2(v) })).sort((a, b) => b.amount - a.amount),
    sources: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, r2(v)])) };
}
// Unpaid driver money by age: payments settle the oldest debt first
async function debtAging(env) {
  const today = addisDate(0);
  const owed = (await env.DB.prepare("SELECT driver_id,shift_date,n_mp+n_pd a FROM shifts WHERE status='APPROVED' AND driver_id IS NOT NULL AND n_mp+n_pd>0 ORDER BY shift_date,id").all()).results;
  const paid = Object.fromEntries((await env.DB.prepare('SELECT driver_id k,SUM(amount) s FROM payments WHERE driver_id IS NOT NULL GROUP BY driver_id').all()).results.map(r => [r.k, num(r.s)]));
  const drvs = (await env.DB.prepare('SELECT id,name,phone FROM drivers').all()).results;
  const names = Object.fromEntries(drvs.map(d => [d.id, d.name]));
  const phones = Object.fromEntries(drvs.map(d => [d.id, d.phone || '']));
  const vPlates = Object.fromEntries((await env.DB.prepare('SELECT driver_id,plate FROM vehicles WHERE driver_id IS NOT NULL').all()).results.map(v => [v.driver_id, v.plate]));
  const by = {};
  for (const r of owed) (by[r.driver_id] ||= []).push({ date: r.shift_date, a: num(r.a) });
  const list = [];
  for (const [did, items] of Object.entries(by)) {
    let left = paid[did] || 0;
    const o = { driverId: +did, driver: names[did] || '#' + did, phone: phones[did] || '', plate: vPlates[did] || '', d0_7: 0, d8_30: 0, d31: 0, total: 0, oldestDays: 0 };
    for (const it of items) {
      const use = Math.min(left, it.a); left -= use; const rest = it.a - use; if (rest <= 0.001) continue;
      const age = dDiff(it.date, today); o[age <= 7 ? 'd0_7' : age <= 30 ? 'd8_30' : 'd31'] += rest; o.total += rest; o.oldestDays = Math.max(o.oldestDays, age);
    }
    if (o.total > 0.001) list.push({ ...o, d0_7: r2(o.d0_7), d8_30: r2(o.d8_30), d31: r2(o.d31), total: r2(o.total) });
  }
  list.sort((a, b) => b.total - a.total);
  return { list, total: { d0_7: r2(list.reduce((t, x) => t + x.d0_7, 0)), d8_30: r2(list.reduce((t, x) => t + x.d8_30, 0)), d31: r2(list.reduce((t, x) => t + x.d31, 0)), total: r2(list.reduce((t, x) => t + x.total, 0)) } };
}
// Monthly payroll per driver: salary for the days they had a vehicle (from the day they were added) + bonus after deductions + overtime pay
async function payroll(env, cfg, month, group = '') {
  const mStart = month + '-01', mEnd = month + '-' + String(monthDays(month)).padStart(2, '0'), md = monthDays(month);
  const PM = await plateModes(env);
  const agg = Object.fromEntries((await env.DB.prepare(`SELECT driver_id k, COUNT(*) n, SUM(n_bonus) bonus, SUM(n_bd) bd, SUM(n_pfb) pfb, SUM(n_bonuspay) bp, SUM(n_otmin) otm, SUM(n_ot) ot, SUM(n_wmin) wm, SUM(n_pax) pax, SUM(n_km) km
    FROM shifts WHERE status='APPROVED' AND shift_date>=? AND shift_date<=? AND driver_id IS NOT NULL${group ? ' AND n_mode=?' : ''} GROUP BY driver_id`).bind(mStart, mEnd, ...(group ? [group] : [])).all()).results.map(r => [r.k, r]));
  const drivers = (await env.DB.prepare('SELECT * FROM drivers ORDER BY name').all()).results;
  const plates = Object.fromEntries((await env.DB.prepare('SELECT plate,driver_id FROM vehicles WHERE driver_id IS NOT NULL').all()).results.map(v => [v.driver_id, v.plate]));
  const bal = await balances(env, null), sd = await salaryDays(env, mStart, mEnd);
  const ysh = {}; // 🟡 drivers' share of the Yango weekly goal bonus, for weeks that end in this month
  if (group !== 'route') for (const y of (await env.DB.prepare('SELECT shares, week FROM yango_week WHERE closed=1 AND met=1 AND week>=? AND week<=?').bind(dAdd(mStart, -6), mEnd).all()).results)
    if (dAdd(y.week, 6) >= mStart && dAdd(y.week, 6) <= mEnd) for (const [did, a] of Object.entries(JSON.parse(y.shares || '{}'))) ysh[did] = (ysh[did] || 0) + num(a);
  const rows = [];
  for (const d of drivers) {
    const a = agg[d.id] || {}, n = num(a.n), salDays = Object.values(sd[d.id] || {}).filter(pl => !group || PM[pl] === group).length;
    if (!n && !(salDays && d.salary > 0) && !ysh[d.id]) continue;
    const salary = r2(num(d.salary) * salDays / md);
    const bonus = num(a.bonus), fromBonusCash = num(a.bd), fromBonusPenalty = num(a.pfb), bonusPay = num(a.bp);
    const otHours = r2(num(a.otm) / 60), otPay = num(a.ot), debt = Math.max(0, r2(bal[d.id]?.balance || 0));
    const yangoShare = r2(ysh[d.id] || 0), net = r2(salary + bonusPay + otPay + yangoShare);
    rows.push({ driverId: d.id, driver: d.name, plate: plates[d.id] || '', active: !!d.active, shifts: n, salaryDays: salDays, salary, bonus, fromBonusCash, fromBonusPenalty, bonusPay, yangoShare,
      workHours: r2(num(a.wm) / 60), otHours, otPay, passengers: num(a.pax), km: num(a.km), net, debt, afterDebt: r2(Math.max(0, net - debt)) });
  }
  const T = k => r2(rows.reduce((t, r) => t + num(r[k]), 0));
  return { month, rows, total: Object.fromEntries(['salary', 'bonus', 'bonusPay', 'yangoShare', 'otHours', 'otPay', 'net', 'debt', 'afterDebt'].map(k => [k, T(k)])), overtimeRate: num(cfg.overtimeRate) };
}
// ---- v4.9 🟡 Yango weekly goal ----
const yTiers = cfg => [...((cfg.yangoGoal || DEF.yangoGoal).tiers || [])].sort((a, b) => a.trips - b.trips);
// Yango trips per vehicle (and per driver) in a week, from the reports sent (pending or approved)
async function yangoTrips(env, from, to) {
  const rs = (await env.DB.prepare("SELECT plate, driver_id, calc FROM shifts WHERE shift_date>=? AND shift_date<=? AND status IN ('PENDING','APPROVED') AND n_mode='cabby'").bind(from, to).all()).results;
  const by = {}; for (const r of rs) { const t = num(JSON.parse(r.calc).yangoTrips); const o = by[r.plate] ||= { trips: 0, drivers: {} }; o.trips += t; if (r.driver_id != null) o.drivers[r.driver_id] = (o.drivers[r.driver_id] || 0) + t; }
  return by;
}
async function yangoWeek(env, cfg, week) {
  const today = addisDate(0), end = dAdd(week, 6), days = Math.min(7, Math.max(0, dDiff(week, today) + 1)); // days of the week gone (today included)
  const cur = await yangoTrips(env, week, end), tiers = yTiers(cfg);
  const hist = {}; for (let i = 1; i <= 4; i++) { const w = dAdd(week, -7 * i), t = await yangoTrips(env, w, dAdd(w, 6)); for (const [p, o] of Object.entries(t)) (hist[p] ||= []).push(o.trips); }
  const rows = (await env.DB.prepare('SELECT * FROM yango_week WHERE week=?').bind(week).all()).results, set = Object.fromEntries(rows.map(r => [r.plate, r]));
  const vs = (await env.DB.prepare("SELECT plate FROM vehicles WHERE mode<>'route' ORDER BY plate").all()).results;
  return vs.map(v => {
    const c = cur[v.plate] || { trips: 0, drivers: {} }, h = hist[v.plate] || [], avg = h.length ? Math.round(h.reduce((a, x) => a + x, 0) / h.length) : null;
    const advice = avg != null ? [...tiers].reverse().find(t => t.trips <= avg * 0.95) || null : null; // a goal the vehicle reached most weeks, with a little room
    const g = set[v.plate], goal = num(g?.goal), proj = days ? Math.round(c.trips / days * 7) : 0, pace = goal ? Math.round(goal * days / 7) : 0;
    return { plate: v.plate, goal, goalEtb: num(g?.goal_etb), chosenBy: g?.chosen_by || '', trips: c.trips, drivers: c.drivers, projected: proj, pace, behind: !!goal && days > 0 && proj < goal,
      need: goal ? Math.max(0, goal - c.trips) : 0, avg4: avg, advice: advice ? advice.trips : null, closed: !!g?.closed, met: !!g?.met, bonus: num(g?.bonus), shares: JSON.parse(g?.shares || '{}') };
  });
}
async function yangoClose(env, cfg, week) { // a finished week: goal met? bonus to the company, the drivers' share split by their Yango trips
  const end = dAdd(week, 6), cur = await yangoTrips(env, week, end), pct = num((cfg.yangoGoal || DEF.yangoGoal).sharePct), out = [];
  for (const g of (await env.DB.prepare('SELECT * FROM yango_week WHERE week=? AND closed=0 AND goal>0').bind(week).all()).results) {
    const c = cur[g.plate] || { trips: 0, drivers: {} }, met = c.trips >= g.goal, bonus = met ? num(g.goal_etb) : 0, shares = {};
    if (met && pct > 0 && c.trips > 0) for (const [did, t] of Object.entries(c.drivers)) if (t > 0) shares[did] = r2(bonus * pct / 100 * t / c.trips);
    await env.DB.prepare('UPDATE yango_week SET trips=?, met=?, bonus=?, share_pct=?, shares=?, closed=1 WHERE plate=? AND week=?').bind(c.trips, met ? 1 : 0, bonus, pct, JSON.stringify(shares), g.plate, week).run();
    for (const [did, a] of Object.entries(shares)) await notifyDriver(env, +did, 'yango', `🟡 የያንጎ ሳምንታዊ ግብ ተሳክቷል (${g.plate}, ${c.trips}/${g.goal}) — የእርስዎ ድርሻ *${a} ብር* (በደሞዝ ይከፈላል)`);
    out.push(`${met ? '✅' : '❌'} ${g.plate}: ${c.trips}/${g.goal} ጉዞ${met ? ` → ${bonus} ብር${Object.keys(shares).length ? ` (የሹፌሮች ድርሻ ${r2(Object.values(shares).reduce((a, x) => a + x, 0))})` : ''}` : ' — ቦነስ የለም'}`);
  }
  if (out.length) await notify(env, cfg, 'yango', `🟡 *የያንጎ ሳምንታዊ ግብ — ${ddmm(week)}–${ddmm(end)}*\n${out.join('\n')}`);
  return out.length;
}
async function yangoJob(env, cfg) {
  const today = addisDate(0), wk = weekStart(today), yg = cfg.yangoGoal || DEF.yangoGoal;
  if (dowOf(today) === 1) await yangoClose(env, cfg, dAdd(wk, -7)); // Monday: close last week
  const dw = (dowOf(today) + 6) % 7, warnFrom = (num(yg.warnDow) + 6) % 7; // Monday = 0
  if (dw < warnFrom) return;
  const rows = (await yangoWeek(env, cfg, wk)).filter(r => r.behind && !r.closed);
  if (!rows.length) return;
  const left = 7 - dw;
  await notify(env, cfg, 'yango', `🟡 *የያንጎ ግብ — ከእቅድ ኋላ (behind the goal)*\n${rows.map(r => `• ${r.plate}: ${r.trips}/${r.goal} — በ${left} ቀን ${r.need} ጉዞ ይቀራል (≈${Math.ceil(r.need / left)}/ቀን)`).join('\n')}\nግቡ ካልተሟላ ቦነሱ በሙሉ ይቀራል።`);
  for (const r of rows) for (const d of (await env.DB.prepare("SELECT DISTINCT driver_id FROM roster WHERE plate=? AND rdate=? AND kind='work' AND driver_id IS NOT NULL").bind(r.plate, today).all()).results)
    await notifyDriver(env, d.driver_id, 'yango', `🟡 የያንጎ ግብ (${r.plate})፦ ${r.trips}/${r.goal} — በ${left} ቀን ${r.need} ጉዞ ይቀራል። ግቡ ካልተሟላ ቦነሱ በሙሉ ይቀራል።`);
}
// ---- v4.9 🎯 monthly targets (monitoring only) ----
const TGT_METRICS = { vehicle: ['revenue', 'net', 'km', 'trips', 'pax'], driver: ['revenue', 'trips', 'shifts', 'km', 'hours'] };
async function targetReport(env, cfg, month) {
  const from = month + '-01', mEnd = month + '-' + String(monthDays(month)).padStart(2, '0'), today = addisDate(0), to = mEnd < today ? mEnd : today;
  const pace = to < from ? 0 : (dDiff(from, to) + 1) / monthDays(month);
  const mf = await moneyFlow(env, cfg, from, to < from ? from : to, ''), def = cfg.targets || DEF.targets;
  const ov = {}; for (const t of (await env.DB.prepare('SELECT * FROM targets').all()).results) ((ov[t.kind] ||= {})[t.id] ||= {})[t.metric] = t.value;
  const rs = (await env.DB.prepare("SELECT plate, driver_id, calc, n_due, n_tele, n_km, n_pax, n_wmin FROM shifts WHERE status='APPROVED' AND shift_date>=? AND shift_date<=?").bind(from, mEnd).all()).results;
  const tripsOf = c => c.mode === 'route' ? num(c.tripsCount) || num(c.roundTrips) * 2 : num(c.cabbyTrips) + num(c.yangoTrips) + num(c.reserve?.runs);
  const V = {}, D = {};
  for (const r of rs) { const c = JSON.parse(r.calc), t = tripsOf(c);
    const v = V[r.plate] ||= { trips: 0, pax: 0 }; v.trips += t; v.pax += num(r.n_pax);
    if (r.driver_id != null) { const d = D[r.driver_id] ||= { revenue: 0, trips: 0, shifts: 0, km: 0, hours: 0 }; d.revenue += num(r.n_due) + num(r.n_tele); d.trips += t; d.shifts++; d.km += num(r.n_km); d.hours += num(r.n_wmin) / 60; } }
  const row = (kind, id, name, act) => { const tg = { ...def[kind], ...(ov[kind]?.[id] || {}) };
    return { id, name, own: !!ov[kind]?.[id], metrics: TGT_METRICS[kind].map(k => { const a = r2(num(act[k])), t = num(tg[k]); return { k, actual: a, target: t, pct: t ? Math.round(a / t * 100) : null, onPace: t ? a >= t * pace : null }; }) }; };
  const vehicles = (await env.DB.prepare('SELECT plate, mode FROM vehicles ORDER BY plate').all()).results.map(v => { const m = mf.vehicles.find(x => x.plate === v.plate) || {};
    return row('vehicle', v.plate, v.plate, { revenue: m.in || 0, net: m.net || 0, km: m.km || 0, trips: V[v.plate]?.trips || 0, pax: V[v.plate]?.pax || 0 }); });
  const drivers = (await env.DB.prepare('SELECT id, name FROM drivers WHERE active=1 ORDER BY name').all()).results.map(d => row('driver', String(d.id), d.name, D[d.id] || {}));
  return { month, pace: Math.round(pace * 100), defaults: def, vehicles, drivers };
}
// ---- v4.9 📈 a real .xlsx (stored zip, inline strings) for the monthly report ----
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const te = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const [name, text] of files) {
    const nb = te.encode(name), data = te.encode(text), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), nb); off += 30 + nb.length + data.length;
  }
  const cl = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cl, true); e.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; } return out;
}
function xlsxBuild(sheets) {
  const x = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheet = rows => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    const ref = col(j) + (i + 1); return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : v == null || v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`; }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = [['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${x(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet(s.rows)])];
  return zipStore(files);
}
const PNL_LINES = [['in', 'ገቢ (Money in)'], ['dep', '  ጥሬ ገንዘብ ገቢ (Cash deposited)'], ['tele', '  ቴሌብር (Telebirr)'], ['rsv', '  ካቢ ሪዘርቭ (Cabby Reserve payouts)'], ['ygb', '  የያንጎ ሳምንታዊ ቦነስ (Yango weekly bonus)'], ['pay', '  ከሹፌሮች የተመለሰ (Driver repayments)'],
  ['out', 'ወጪ (Money out)'], ['sal', '  ደሞዝ (Salaries)'], ['bonus', '  የሹፌር ቦነስ (Driver bonus)'], ['ygs', '  የያንጎ ቦነስ ድርሻ ለሹፌሮች (Yango share)'], ['ot', '  ትርፍ ሰዓት (Overtime)'], ['chg', '  ቻርጅ (Charging)'], ['com', '  የፕላትፎርም ኮሚሽን (Platform commission)'], ['fix', '  ቋሚ ወጪ (Fixed costs)'], ['exp', '  ሌሎች ወጪዎች (Expenses)'], ['net', 'የተጣራ ትርፍ / ኪሳራ (Net)']];
async function monthlyPack(env, cfg, month) {
  const from = month + '-01', to = month + '-' + String(monthDays(month)).padStart(2, '0'), mf = await moneyFlow(env, cfg, from, to, ''), tr = await targetReport(env, cfg, month), pr = await payroll(env, cfg, month);
  const yw = (await env.DB.prepare('SELECT * FROM yango_week WHERE week>=? AND week<=? ORDER BY week, plate').bind(dAdd(from, -6), to).all()).results.filter(y => dAdd(y.week, 6) >= from);
  const t = mf.total, vehs = (await env.DB.prepare('SELECT plate, driver FROM vehicles ORDER BY plate').all()).results;
  const sheets = [{ name: 'P&L', rows: [['ETEV — ' + month], [], ['Item', 'ETB'], ...PNL_LINES.map(([k, l]) => [l, r2(num(t[k]))]), [], ['KM', r2(t.km)], ['Passengers', t.pax], ['Shifts', t.shifts], ['kWh', r2(t.kwh)]] },
    { name: 'Vehicles', rows: [['Vehicle', 'Driver', 'Money in', 'Money out', 'Net', 'KM', 'Passengers', ...MONEY_KEYS], ...mf.vehicles.map(v => [v.plate || 'Company-wide', vehs.find(x => x.plate === v.plate)?.driver || '', v.in, v.out, v.net, r2(v.km), v.pax, ...MONEY_KEYS.map(k => v[k])])] },
    { name: 'Costs', rows: [['Cost', 'ETB'], ...mf.cats.map(c => [c.name, c.amount])] },
    { name: 'Targets', rows: [['Kind', 'Name', 'Metric', 'Actual', 'Target', '%'], ...['vehicles', 'drivers'].flatMap(k => tr[k].flatMap(r => r.metrics.filter(m => m.target).map(m => [k === 'vehicles' ? 'Vehicle' : 'Driver', r.name, m.k, m.actual, m.target, m.pct])))] },
    { name: 'Payroll', rows: [['Driver', 'Vehicle', 'Shifts', 'Salary', 'Bonus payable', 'Yango share', 'Overtime pay', 'Net pay', 'Debt'], ...pr.rows.map(r => [r.driver, r.plate, r.shifts, r.salary, r.bonusPay, r.yangoShare, r.otPay, r.net, r.debt])] },
    { name: 'Yango goal', rows: [['Week', 'Vehicle', 'Goal', 'Trips', 'Met', 'Bonus', 'Drivers share'], ...yw.map(y => [y.week, y.plate, y.goal, y.trips, y.closed ? (y.met ? 'yes' : 'no') : 'open', y.bonus, r2(Object.values(JSON.parse(y.shares || '{}')).reduce((a, x) => a + num(x), 0))])] }];
  const best = [...mf.vehicles].filter(v => v.plate).sort((a, b) => b.net - a.net);
  const text = `📈 *የወር ሪፖርት — ${month}*\n💰 ገቢ፦ ${Math.round(t.in).toLocaleString()} ብር\n💸 ወጪ፦ ${Math.round(t.out).toLocaleString()} ብር\n${t.net >= 0 ? '✅' : '🔻'} *የተጣራ፦ ${Math.round(t.net).toLocaleString()} ብር*\n🛣 ${Math.round(t.km).toLocaleString()} ኪ.ሜ · 👥 ${t.pax} ተሳፋሪ`
    + (best.length ? `\n🏆 ምርጥ፦ ${best[0].plate} (${Math.round(best[0].net)}) · ዝቅተኛ፦ ${best[best.length - 1].plate} (${Math.round(best[best.length - 1].net)})` : '')
    + (yw.length ? `\n🟡 ያንጎ ግብ፦ ${yw.filter(y => y.met).length}/${yw.filter(y => y.closed).length} ሳምንት ተሳክቷል` : '') + '\n📎 ዝርዝሩ በ Excel ፋይሉ ውስጥ ነው።';
  return { text, xlsx: xlsxBuild(sheets) };
}
async function photoMeta(env, ids) {
  if (!ids.length) return {};
  const lo = Math.min(...ids);
  const { results } = await env.DB.prepare('SELECT shift_id,kind FROM photos WHERE shift_id>=?').bind(lo).all();
  const by = {}; for (const r of results) (by[r.shift_id] ||= []).push(r.kind);
  return by;
}
// ---- v4.8 Telebirr, one payment at a time ----
// Phone time "23/10/2026 09:45:29" or statement "2026/10/23 09:45" → "2026-10-23 09:45:29" (Addis time)
function teleTs(x) {
  const t = String(x || '').trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}`;
  return null;
}
const teleNo = x => { const t = String(x || '').trim().toUpperCase(); return /^[A-Z0-9]{6,20}$/.test(t) ? t : null; };
const teleAmt = x => r2(num(String(x ?? '').replace(/[^\d.\-]/g, '')));
// Which vehicle a statement belongs to: an operator number set as a vehicle's Telebirr ID; anything else is the merchant (all vehicles)
async function teleOps(env) { return new Map((await env.DB.prepare("SELECT plate,tele_id FROM vehicles WHERE tele_id<>''").all()).results.map(v => [String(v.tele_id), v.plate])); }
// Keep the per-day Telebirr total (used by the statement check and the day close) in step with the payments the statement confirmed
async function teleSync(env, pairs, actor) {
  const ops = await teleOps(env), st = [], t = now();
  for (const k of new Set(pairs)) {
    const [plate, date] = k.split('|'); if (!plate || !date) continue;
    const opsOf = [...ops].filter(([, p]) => p === plate).map(([o]) => o);
    const r = await env.DB.prepare(`SELECT COUNT(*) n, SUM(st_amount) s FROM tele_txn WHERE st_amount IS NOT NULL AND substr(st_ts,1,10)=?
      AND (plate=? OR (plate IS NULL AND st_op IN (${opsOf.map(() => '?').join(',') || "''"})))`).bind(date, plate, ...opsOf).first();
    if (num(r?.n)) st.push(env.DB.prepare("INSERT INTO platform_trips(source,plate,trip_date,trips,km,cash,imported_by,created_at) VALUES('telebirr',?,?,?,0,?,?,?) ON CONFLICT(source,plate,trip_date) DO UPDATE SET trips=excluded.trips,cash=excluded.cash,imported_by=excluded.imported_by,created_at=excluded.created_at")
      .bind(plate, date, num(r.n), r2(num(r.s)), 'stmt:' + String(actor || '').slice(0, 40), t));
    else st.push(env.DB.prepare("DELETE FROM platform_trips WHERE source='telebirr' AND plate=? AND trip_date=? AND imported_by LIKE 'stmt:%'").bind(plate, date));
  }
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
}
// Status of each payment: ✅ matched · 💰 amount differs · ⚠️ not in a statement that covers its time · ⏳ statement not loaded yet · ℹ️ in the statement, nobody claimed it
async function teleView(env, from, to, plateOnly) {
  const ops = await teleOps(env), opPlate = o => ops.get(String(o || '')) || null;
  const imps = (await env.DB.prepare('SELECT op,from_ts,to_ts FROM tele_import WHERE to_ts>=? AND from_ts<=?').bind(from + ' 00:00:00', to + ' 23:59:59').all()).results;
  const covered = (plate, ts) => imps.some(i => i.from_ts.slice(0, 16) <= ts.slice(0, 16) && ts.slice(0, 16) <= i.to_ts.slice(0, 16) && (!opPlate(i.op) || opPlate(i.op) === plate));
  const rows = (await env.DB.prepare(`SELECT * FROM tele_txn WHERE tdate>=? AND tdate<=?${plateOnly ? ' AND (plate=? OR plate IS NULL)' : ''} ORDER BY ts`).bind(from, to, ...(plateOnly ? [plateOnly] : [])).all()).results;
  const out = [];
  for (const r of rows) {
    const plate = r.plate || opPlate(r.st_op);
    if (plateOnly && plate !== plateOnly) continue;
    const status = r.amount == null ? 'unclaimed' : r.st_amount == null ? (covered(r.plate, r.ts) ? 'missing' : 'waiting') : Math.abs(r.st_amount - r.amount) >= 0.01 ? 'diff' : 'ok';
    out.push({ txn: r.txn, date: r.tdate, ts: r.ts, amount: r.amount, plate, claimed: !!r.plate, src: r.src || '', by: r.logged_by || '', dup: r.dup || '', stAmount: r.st_amount, stTs: r.st_ts || '', stOp: r.st_op || '', status,
      res: r.res || '', resAmt: r.res_amt, resNote: r.res_note || '', resBy: r.res_by || '', problem: !r.res && (status === 'missing' || status === 'diff' || !!r.dup) });
  }
  return { rows: out, imports: imps.length };
}
// 📄 Does this day need its Telebirr statement? (smart mode: only when something looks off, plus ~1 day in 10 at random)
async function teleNeed(env, cfg, date, plates) {
  const inP = p => !plates || plates.has(p), reasons = [], add = (plate, why) => { if (inP(plate) && !reasons.some(r => r.plate === plate && r.why === why)) reasons.push({ plate, why }); };
  const rows = (await env.DB.prepare('SELECT plate,src,dup,amount,res FROM tele_txn WHERE tdate=? AND plate IS NOT NULL').bind(date).all()).results;
  if (!rows.length) return { needed: false, reasons, covered: true, payments: 0 };
  if (cfg.teleStmtMode === 'daily') for (const p of new Set(rows.map(r => r.plate))) add(p, 'daily');
  for (const r of rows) { if (r.src === 'hand' && !r.res) add(r.plate, 'hand'); if (r.dup && !r.res) add(r.plate, 'dup'); }
  for (const sh of (await env.DB.prepare("SELECT plate,calc FROM shifts WHERE shift_date=? AND status IN ('PENDING','APPROVED')").bind(date).all()).results) {
    const c = JSON.parse(sh.calc); if (c.teleLog && Math.abs(num(c.teleTotal) - c.teleLog.sum) >= 1) add(sh.plate, 'report');
  }
  // much more Telebirr than this vehicle's usual day (last 14 days)
  const day = {}; for (const r of rows) day[r.plate] = (day[r.plate] || 0) + num(r.amount);
  for (const [p, v] of Object.entries(day)) {
    const h = await env.DB.prepare('SELECT COUNT(DISTINCT tdate) d, SUM(amount) s FROM tele_txn WHERE plate=? AND tdate<? AND tdate>=? AND amount IS NOT NULL').bind(p, date, dAdd(date, -14)).first();
    if (num(h?.d) >= 3 && v > Math.max(500, 2 * num(h.s) / num(h.d))) add(p, 'unusual');
  }
  const pct = num(cfg.teleRandomPct);
  if (pct > 0 && parseInt((await hmac(env.SESSION_SECRET, 'tele-check|' + date)).slice(0, 4), 16) % 100 < pct) for (const p of new Set(rows.map(r => r.plate))) add(p, 'random');
  // covered = a statement for the whole day: the merchant's, or the operator's of each vehicle that needs it
  const ops = await teleOps(env), opPlate = o => ops.get(String(o || '')) || null;
  const full = (await env.DB.prepare("SELECT op FROM tele_import WHERE from_ts<=? AND to_ts>=?").bind(date + ' 00:00:59', date + ' 23:59:00').all()).results;
  const covered = full.some(i => !opPlate(i.op)) || reasons.every(r => full.some(i => opPlate(i.op) === r.plate));
  return { needed: reasons.length > 0, reasons, covered, payments: rows.length };
}
const TELE_WHY = { daily: 'በየቀኑ', hand: '✍️ በእጅ የተጻፈ ክፍያ', dup: '🔁 የተደገመ ቁጥር', report: '📱 ሪፖርቱና SMS-ኑ አይስማሙም', unusual: '📈 ከተለመደው በላይ ቴሌብር', random: '🎲 በዘፈቀደ ምርመራ' };
// ---- Cabby / Yango report check: compare what drivers reported with the platform's own trip report ----
const TOL = { kmAbs: 3, kmPct: 0.05, cash: 10 };
async function reconcile(env, cfg, from, to) {
  const plat = (await env.DB.prepare('SELECT * FROM platform_trips WHERE trip_date>=? AND trip_date<=?').bind(from, to).all()).results;
  if (!plat.length) return { from, to, checked: 0, matched: 0, mismatched: 0, cashGap: 0, bonusGap: 0, sources: [], rows: [] };
  const shifts = (await env.DB.prepare("SELECT * FROM shifts WHERE shift_date>=? AND shift_date<=? AND status IN ('APPROVED','PENDING') ORDER BY status='APPROVED' DESC, id DESC").bind(from, to).all()).results.map(rowOut);
  // one report per shift (approved first); a day with two shifts is compared as their sum with the platform's day
  const per = new Map(); for (const s of shifts) { const k = s.plate + '|' + s.shiftDate + '|' + (s.shiftNo || 1); if (!per.has(k)) per.set(k, s); }
  const shiftAt = new Map();
  for (const s of per.values()) {
    const k = s.plate + '|' + s.shiftDate, c = shiftAt.get(k);
    if (!c) { shiftAt.set(k, s); continue; }
    const m = { ...c, multi: (c.multi || 1) + 1 };
    for (const f of ['cabbyTrips', 'cabbyKm', 'cabbyCash', 'yangoTrips', 'yangoKm', 'yangoCash', 'teleTotal', 'totalCombinedBonus']) m[f] = num(c[f]) + num(s[f]);
    if (s.status !== 'APPROVED') m.status = s.status; shiftAt.set(k, m);
  }
  const keys = new Map();
  for (const p of plat) { const k = p.plate + '|' + p.trip_date; (keys.get(k) || keys.set(k, {}).get(k))[p.source] = p; }
  const rows = [];
  for (const [k, src] of keys) {
    const [plate, date] = k.split('|'), s = shiftAt.get(k);
    const item = { plate, date, driver: s?.driverName || '', shiftId: s?.id ?? null, status: s?.status || 'MISSING', issues: [], cashGap: 0, bonusGap: 0, compare: {} };
    const app = src.cabby || src.yango, tb = src.telebirr;
    if (!s) {
      if (app) {
        const t = (src.cabby?.trips || 0) + (src.yango?.trips || 0), c = (src.cabby?.cash || 0) + (src.yango?.cash || 0);
        item.issues.push(`No shift report, but the platform shows ${t} trip(s) and ${c} ETB cash`); item.cashGap = c;
      }
      if (tb) item.issues.push(`No shift report, but Telebirr received ${tb.cash} ETB (${tb.trips} payment(s))`);
    } else if (app && s.mode === 'route') {
      item.issues.push('Platform trips on a Route / Zone shift');
    } else if (app) {
      for (const [name, pre] of [['cabby', 'cabby'], ['yango', 'yango']]) {
        const p = src[name]; if (!p) continue;
        const rep = { trips: num(s[pre + 'Trips']), km: num(s[pre + 'Km']), cash: num(s[pre + 'Cash']) };
        item.compare[name] = { reported: rep, platform: { trips: p.trips, km: p.km, cash: p.cash } };
        const L = name === 'cabby' ? 'Cabby' : 'Yango';
        if (rep.trips !== p.trips) item.issues.push(`${L} trips: reported ${rep.trips}, platform ${p.trips}`);
        if (p.km > 0 && Math.abs(rep.km - p.km) > Math.max(TOL.kmAbs, p.km * TOL.kmPct)) item.issues.push(`${L} KM: reported ${rep.km}, platform ${r1(p.km)}`);
        if (p.cash - rep.cash > TOL.cash) { item.issues.push(`${L} cash: reported ${rep.cash}, platform ${p.cash} (${r1(p.cash - rep.cash)} ETB not declared)`); item.cashGap += p.cash - rep.cash; }
        else if (rep.cash - p.cash > TOL.cash) item.issues.push(`${L} cash: reported ${rep.cash}, platform ${p.cash}`);
      }
      // What the bonus would be with the platform's trip counts (same rates as the record)
      if ((src.cabby || src.yango) && !s.multi) {
        const f2 = { ...s, cabbyTrips: src.cabby ? src.cabby.trips : s.cabbyTrips, yangoTrips: src.yango ? src.yango.trips : s.yangoTrips };
        const c2 = await compute(env, { ...cfg, ...(s.rates || {}) }, f2, s.supervisor, s.waived);
        item.bonusGap = r1(num(s.totalCombinedBonus) - c2.totalCombinedBonus); // >0 = bonus claimed above what the platform supports
        if (item.bonusGap > 0) item.issues.push(`Bonus ${item.bonusGap} ETB higher than the platform trips support`);
      }
    }
    // Telebirr statement of the vehicle's own QR / merchant number vs the Telebirr total the driver reported
    if (s && tb) {
      const rep = num(s.teleTotal);
      item.compare.telebirr = { reported: rep, statement: tb.cash, payments: tb.trips };
      if (rep - tb.cash > TOL.cash) { item.issues.push(`Telebirr: reported ${rep}, statement ${tb.cash} (${r1(rep - tb.cash)} ETB reported as Telebirr but not received)`); item.cashGap += rep - tb.cash; }
      else if (tb.cash - rep > TOL.cash) item.issues.push(`Telebirr: reported ${rep}, statement ${tb.cash} (driver reported ${r1(tb.cash - rep)} ETB less)`);
    }
    item.ok = !item.issues.length;
    rows.push(item);
  }
  rows.sort((a, b) => (a.ok - b.ok) || b.date.localeCompare(a.date) || a.plate.localeCompare(b.plate));
  const bad = rows.filter(r => !r.ok);
  return { from, to, checked: rows.length, matched: rows.length - bad.length, mismatched: bad.length,
    cashGap: r1(bad.reduce((t, r) => t + r.cashGap, 0)), bonusGap: r1(bad.reduce((t, r) => t + Math.max(0, r.bonusGap), 0)),
    sources: [...new Set(plat.map(p => p.source))], rows };
}

// ---- Driver ranking: discipline + productivity, transparent components ----
async function ranking(env, cfg, days) {
  const from = addisDate(days - 1), to = addisDate(0);
  const vs = (await env.DB.prepare('SELECT plate,driver,mode FROM vehicles ORDER BY plate').all()).results;
  const A = Object.fromEntries((await env.DB.prepare(`SELECT plate, COUNT(*) n, SUM(n_mode='route') rt, SUM(n_due) due, SUM(n_sf) sf, SUM(n_work) work, SUM(n_km) km, SUM(n_bonus) bonus,
    SUM(n_clr) clr, COUNT(DISTINCT shift_date) days, SUM(n_pen=0) nopen FROM shifts WHERE status='APPROVED' AND shift_date>=? GROUP BY plate`).bind(from).all()).results.map(r => [r.plate, r]));
  const rec = await reconcile(env, cfg, from, to);
  const list = vs.map(v => {
    const a = A[v.plate] || {}, n = num(a.n);
    const isRoute = v.mode === 'route' || (n && num(a.rt) > n / 2);
    const cashDue = num(a.due), short = num(a.sf);
    const checked = rec.rows.filter(x => x.plate === v.plate && x.shiftId), mism = checked.filter(x => !x.ok).length;
    return { plate: v.plate, driver: v.driver, group: isRoute ? 'route' : 'cabby', shifts: n, km: num(a.km), bonus: num(a.bonus), shortfall: short,
      workPerShift: n ? num(a.work) / n : 0,
      parts: { cleared: n ? num(a.clr) / n : 0, cash: cashDue ? Math.max(0, 1 - short / cashDue) : 1,
        reporting: Math.min(1, num(a.days) / days), noPenalty: n ? num(a.nopen) / n : 0,
        platformMatch: checked.length ? 1 - mism / checked.length : 1 }, mismatches: mism };
  });
  // Productivity is compared only within the same group (Cabby trips vs Route round trips)
  for (const g of ['cabby', 'route']) {
    const mx = Math.max(0, ...list.filter(x => x.group === g).map(x => x.workPerShift));
    list.filter(x => x.group === g).forEach(x => { x.parts.productivity = mx ? x.workPerShift / mx : 0; });
  }
  const W = { cleared: 20, cash: 25, reporting: 15, noPenalty: 10, platformMatch: 10, productivity: 20 };
  for (const x of list) {
    x.score = x.shifts >= 3 ? Math.round(Object.entries(W).reduce((t, [k, w]) => t + w * x.parts[k], 0)) : null;
    for (const k in x.parts) x.parts[k] = Math.round(x.parts[k] * 100);
    x.workPerShift = r1(x.workPerShift);
  }
  const ranked = list.filter(x => x.score != null).sort((a, b) => b.score - a.score || b.km - a.km);
  ranked.forEach((x, i) => { x.rank = i + 1; });
  return { days, weights: W, total: ranked.length, list: [...ranked, ...list.filter(x => x.score == null)] };
}

// ---- Energy trends ----
async function energy(env, days) {
  const from = addisDate(days - 1);
  const chg = (await env.DB.prepare('SELECT plate,chg_date,kwh,cost FROM charging WHERE chg_date>=?').bind(from).all()).results;
  const ap = (await env.DB.prepare("SELECT plate,shift_date date,n_km km FROM shifts WHERE status='APPROVED' AND shift_date>=?").bind(from).all()).results.map(r => ({ ...r, km: num(r.km) }));
  const daily = []; for (let i = days - 1; i >= 0; i--) daily.push({ date: addisDate(i), kwh: 0, cost: 0, km: 0 });
  const dIdx = new Map(daily.map((d, i) => [d.date, i]));
  chg.forEach(c => { const i = dIdx.get(c.chg_date); if (i != null) { daily[i].kwh += num(c.kwh); daily[i].cost += num(c.cost); } });
  ap.forEach(s => { const i = dIdx.get(s.date); if (i != null) daily[i].km += s.km; });
  // Weekly efficiency only counts KM of vehicles that also have charging logged that week,
  // otherwise vehicles without charging records would make the fleet look more efficient than it is
  const wk = new Map(), wkOf = w => wk.get(w) || wk.set(w, { week: w, kwh: 0, cost: 0, km: 0, plates: new Set() }).get(w);
  for (let i = 0; i < daily.length; i++) wkOf(weekStart(daily[i].date));
  chg.forEach(c => { if (!dIdx.has(c.chg_date)) return; const o = wkOf(weekStart(c.chg_date)); o.kwh += num(c.kwh); o.cost += num(c.cost); o.plates.add(c.plate); });
  ap.forEach(s => { if (!dIdx.has(s.date)) return; const o = wkOf(weekStart(s.date)); if (o.plates.has(s.plate)) o.km += s.km; });
  wk.forEach(o => { delete o.plates; });
  const weekly = [...wk.values()].map(w => ({ ...w, kwh: r1(w.kwh), cost: r1(w.cost), km: r1(w.km), kwhPer100: w.km && w.kwh ? r1(w.kwh / w.km * 100) : null, etbPerKm: w.km && w.cost ? r2(w.cost / w.km) : null }));
  const vs = (await env.DB.prepare('SELECT plate,driver FROM vehicles ORDER BY plate').all()).results;
  const vehicles = vs.map(v => {
    const kwh = chg.filter(c => c.plate === v.plate).reduce((t, c) => t + num(c.kwh), 0), cost = chg.filter(c => c.plate === v.plate).reduce((t, c) => t + num(c.cost), 0);
    const km = ap.filter(s => s.plate === v.plate).reduce((t, s) => t + s.km, 0);
    return { plate: v.plate, driver: v.driver, kwh: r1(kwh), cost: r1(cost), km: r1(km), kwhPer100: km && kwh ? r1(kwh / km * 100) : null, etbPerKm: km && cost ? r2(cost / km) : null };
  });
  const both = vehicles.filter(v => v.kwh > 0 && v.km > 0);
  const tk = both.reduce((t, v) => t + v.kwh, 0), tkm = both.reduce((t, v) => t + v.km, 0), tc = both.reduce((t, v) => t + v.cost, 0);
  const avg = tk && tkm ? r1(tk / tkm * 100) : null;
  vehicles.forEach(v => { v.high = avg != null && v.kwhPer100 != null && v.kwhPer100 > avg * 1.15; });
  const allKwh = vehicles.reduce((t, v) => t + v.kwh, 0), allCost = vehicles.reduce((t, v) => t + v.cost, 0);
  return { days, fleet: { kwh: r1(allKwh), cost: r1(allCost), km: r1(tkm), kwhPer100: avg, etbPerKm: tkm && tc ? r2(tc / tkm) : null },
    daily: daily.map(d => ({ ...d, kwh: r1(d.kwh), cost: r1(d.cost), km: r1(d.km) })), weekly, vehicles };
}

async function tgDoc(env, filename, text, caption, chat = env.TG_CHAT_ID, mime = 'application/json') {
  if (!env.TG_TOKEN || !chat) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', chat); fd.append('caption', caption);
    fd.append('document', new Blob([text], { type: mime }), filename);
    const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendDocument`, { method: 'POST', body: fd });
    return !!(await r.json()).ok;
  } catch { return false; }
}
// ---- v4.3 messages: 🔔 in the portal + personal Telegram (each person links their own Telegram once) ----
const canRole = (cfg, role, p) => role === 'admin' || !!(cfg.perms?.[role] && p in cfg.perms[role] ? cfg.perms[role][p] : DEF.perms[role]?.[p]);
const notifyLevel = (cfg, type, role) => { const o = cfg.notify?.[type], v = o && role in o ? o[role] : NOTIFY[type]?.def?.[role]; return Math.max(0, Math.min(2, Math.floor(num(v)))); };
async function staffRecipients(env, cfg, type) {
  const links = Object.fromEntries((await env.DB.prepare('SELECT who,chat_id FROM tg_links').all()).results.map(l => [l.who, l.chat_id]));
  const out = [], la = notifyLevel(cfg, type, 'admin');
  if (la) out.push({ who: 'a', role: 'admin', name: cfg.adminName, lv: la, chat: links.a });
  for (const m of (await env.DB.prepare('SELECT id,name,role FROM managers WHERE active=1').all()).results) {
    const role = ROLES.includes(m.role) ? m.role : 'manager', lv = notifyLevel(cfg, type, role);
    if (lv) out.push({ who: 'm:' + m.id, role, name: m.name, lv, chat: links['m:' + m.id] });
  }
  return out;
}
// text: a string, or (recipient) => string | null, so e.g. money lines go only to people who may see money
function isQuietHourNow(cfg) {
  if (!cfg || !cfg.quietHoursOn) return false;
  const h = addisHour(), st = Math.min(23, Math.max(0, Math.floor(num(cfg.quietStartHour ?? 22)))), en = Math.min(23, Math.max(0, Math.floor(num(cfg.quietEndHour ?? 6))));
  if (st === en) return false;
  return st > en ? (h >= st || h < en) : (h >= st && h < en);
}
async function notify(env, cfg, type, text, opts = {}) {
  const urgentOverride = !!(opts && opts.urgent) || ['incident', 'security', 'vehicleHold'].includes(type);
  const suppressTg = isQuietHourNow(cfg) && !urgentOverride;
  if (!suppressTg && ['digest', 'closeDue', 'notClosed', 'pending', 'usage'].includes(type)) await feedText(env, typeof text === 'function' ? text({ role: 'admin', who: 'channel' }) : text); // management channel: full version
  const rs = await staffRecipients(env, cfg, type), t = now(), st = [], sends = [];
  for (const r of rs) {
    const msg = typeof text === 'function' ? text(r) : text;
    if (!msg) continue;
    st.push(env.DB.prepare('INSERT INTO notifications(who,ts,type,text) VALUES(?,?,?,?)').bind(r.who, t, type, msg.slice(0, 3000)));
    if (r.lv >= 2 && r.chat && !suppressTg) sends.push(tg(env, msg, r.chat));
  }
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  await Promise.all(sends);
  return st.length;
}
async function notifyDriver(env, did, type, text, opts = {}) {
  if (did == null || !text) return false;
  const d = await env.DB.prepare('SELECT d.active, l.chat_id FROM drivers d LEFT JOIN tg_links l ON l.who=? WHERE d.id=?').bind('d:' + did, did).first();
  if (!d || !d.active) return false;
  await env.DB.prepare('INSERT INTO notifications(who,ts,type,text) VALUES(?,?,?,?)').bind('d:' + did, now(), type, text.slice(0, 3000)).run();
  const cfg = opts && opts.cfg ? opts.cfg : await getCfg(env);
  const urgentOverride = !!(opts && opts.urgent) || ['incident', 'security'].includes(type);
  const suppressTg = isQuietHourNow(cfg) && !urgentOverride;
  if (d.chat_id && !suppressTg) await tg(env, text, d.chat_id);
  return true;
}
async function debtLine(env, cfg, did) {
  const b = (await balances(env, did))[did] || ZERO_BAL, bal = Math.max(0, Math.round(b.balance)), lock = num(cfg.debtLockEtb);
  if (!bal) return '💰 ዕዳ የለብዎትም ✅';
  return `💰 ጠቅላላ ዕዳዎ፦ *${bal} ብር*` + (lock && bal > lock ? `\n🛑 ዕዳዎ ከ${lock} ብር ገደብ በላይ ነው — እስኪከፈል መኪናው አይሰማራም` : lock && bal >= lock * 0.8 ? `\n⚠️ ዕዳዎ ወደ ${lock} ብር ገደብ ቀርቧል` : '');
}
const appOrigin = async env => (await getKV(env, 'app_origin')) || '';
const tgHookKey = async env => (await hmac(env.SESSION_SECRET, 'tg-hook')).slice(0, 32);
async function tgApi(env, method, payload) {
  try { const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) }); return await r.json(); }
  catch { return { ok: false }; }
}
// Telegram calls this when someone presses Start in the bot (after "🔗 Link Telegram" in the portal) or sends /stop
async function tgWebhook(env, upd) {
  // The management channel is linked by posting the code from ⚙️ Admin › 📢 in the channel (the bot must be a channel admin)
  const cp = upd?.channel_post;
  if (cp) {
    const rcode = (String(cp.text || '').match(/ETEV-ROSTER-([a-f0-9]{16,40})/) || [])[1];
    if (rcode) { // 📅 the drivers' assignment channel
      const c = await env.DB.prepare("SELECT who,exp FROM tg_codes WHERE code=? AND who='rchannel'").bind(rcode).first();
      if (!c || c.exp < Date.now()) return tg(env, '⌛ ኮዱ ጊዜው አልፏል — በፖርታሉ ⚙️ Admin › 📅 እንደገና ይጫኑ።', String(cp.chat.id));
      await setKV(env, 'tg_roster_channel', JSON.stringify({ id: String(cp.chat.id), title: String(cp.chat.title || '').slice(0, 80), at: now() }));
      await env.DB.batch([env.DB.prepare('DELETE FROM tg_codes WHERE code=?').bind(rcode), auditStmt(env, 'admin', 'CHANNEL', null, `assignment channel linked: ${cp.chat.title || cp.chat.id}`)]);
      return tg(env, '✅ *ETEV — የሹፌሮች ምደባ ቻናል* ተገናኝቷል። የሳምንቱ ፕሮግራም፣ የየቀኑ ምደባ እና ለውጦች እዚህ ይለጠፋሉ።', String(cp.chat.id));
    }
    const code = (String(cp.text || '').match(/ETEV-LINK-([a-f0-9]{16,40})/) || [])[1];
    if (!code) return;
    const c = await env.DB.prepare("SELECT who,exp FROM tg_codes WHERE code=? AND who='channel'").bind(code).first();
    if (!c || c.exp < Date.now()) return tg(env, '⌛ ኮዱ ጊዜው አልፏል — በፖርታሉ ⚙️ Admin › 📢 እንደገና ይጫኑ።', String(cp.chat.id));
    await setKV(env, 'tg_channel', JSON.stringify({ id: String(cp.chat.id), title: String(cp.chat.title || '').slice(0, 80), at: now() }));
    const cfg = await getCfg(env); await setKV(env, 'policy', JSON.stringify({ ...cfg, groupTg: false })); // the old shared group stops
    await env.DB.batch([env.DB.prepare('DELETE FROM tg_codes WHERE code=?').bind(code), auditStmt(env, cfg.adminName, 'CHANNEL', null, `linked: ${cp.chat.title || cp.chat.id}`)]);
    await env.DB.prepare('DELETE FROM feed').run(); // start clean: nothing older than the link
    return tg(env, '✅ *ETEV Fleet Portal* — ይህ ቻናል ተገናኝቷል። ከአሁን ጀምሮ ሁሉም እንቅስቃሴ፣ ሪፖርቶች እና ፎቶዎች እዚህ ይለጠፋሉ። የድሮው የጋራ ቡድን ቆሟል።', String(cp.chat.id));
  }
  const msg = upd?.message, chat = msg?.chat?.id, text = String(msg?.text || '').trim();
  if (!chat || msg.chat.type !== 'private') return;
  const say = t => tg(env, t, String(chat));
  if (/^\/stop/.test(text)) { await env.DB.prepare('DELETE FROM tg_links WHERE chat_id=?').bind(String(chat)).run(); return say('🔕 ETEV፦ መልዕክቶች ቆመዋል። እንደገና ለማገናኘት በፖርታሉ "🔗 ቴሌግራም አገናኝ" ይጫኑ።'); }
  const code = (text.match(/^\/start\s+([a-f0-9]{16,40})$/) || [])[1];
  if (!code) return say('👋 ETEV Fleet Portal፦ ለመገናኘት በፖርታሉ ውስጥ "🔔 › 🔗 ቴሌግራም አገናኝ" ይጫኑ።');
  const c = await env.DB.prepare('SELECT who,exp FROM tg_codes WHERE code=?').bind(code).first();
  if (!c || c.exp < Date.now()) return say('⌛ ሊንኩ ጊዜው አልፏል። በፖርታሉ እንደገና "🔗 ቴሌግራም አገናኝ" ይጫኑ።');
  let name = '';
  if (c.who === 'a') name = (await getCfg(env)).adminName;
  else if (c.who.startsWith('m:')) name = (await env.DB.prepare('SELECT name FROM managers WHERE id=? AND active=1').bind(+c.who.slice(2)).first())?.name || '';
  else if (c.who.startsWith('d:')) name = (await env.DB.prepare('SELECT name FROM drivers WHERE id=? AND active=1').bind(+c.who.slice(2)).first())?.name || '';
  if (!name) return say('❌ ይህ መለያ አይሰራም።');
  await env.DB.batch([env.DB.prepare('DELETE FROM tg_codes WHERE code=?').bind(code), env.DB.prepare('DELETE FROM tg_links WHERE chat_id=? AND who<>?').bind(String(chat), c.who),
    env.DB.prepare('INSERT INTO tg_links(who,chat_id,name,linked_at) VALUES(?,?,?,?) ON CONFLICT(who) DO UPDATE SET chat_id=excluded.chat_id,name=excluded.name,linked_at=excluded.linked_at').bind(c.who, String(chat), name, now()),
    auditStmt(env, name, 'TG_LINK', null, c.who)]);
  return say(`✅ ETEV፦ ${name}፣ ቴሌግራምዎ ተገናኝቷል። የሚመለከትዎት መልዕክት እዚህ ይደርስዎታል። ለማቆም /stop ይላኩ።`);
}

// ---- v4.3 day close: Finance closes each day (Cabby and Route separately); a closed day is locked ----
const grpOf = m => (m === 'route' ? 'route' : 'cabby');
const GRP_L = { cabby: '🔵 ካቢ', route: '🟢 ቀጠና' };
const isClosed = async (env, date, grp) => !!(await env.DB.prepare("SELECT 1 x FROM day_close WHERE cdate=? AND grp=? AND status='closed'").bind(date, grpOf(grp)).first());
const plateGrp = async (env, plate) => { const v = plate && await env.DB.prepare('SELECT mode FROM vehicles WHERE plate=?').bind(plate).first(); return v ? grpOf(v.mode) : null; };
const closedMsg = (date, grp) => `${date} ${GRP_L[grpOf(grp)]} ተዘግቷል — ፋይናንስ ቀኑን ዘግቶታል፤ ለመቀየር Super Admin መልሶ ይክፈተው። (This day is closed.)`;
async function dayChecklist(env, date, grp) {
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const all = (await q("SELECT id,plate,status,calc,reject_reason FROM shifts WHERE shift_date=? AND status IN ('PENDING','REJECTED','APPROVED')", date)).map(r => ({ ...r, c: JSON.parse(r.calc) }));
  const apMode = new Map(all.filter(s => s.status === 'APPROVED').map(s => [s.plate, grpOf(s.c.mode)]));
  const vs = await q('SELECT plate,driver,mode,status,status_since FROM vehicles ORDER BY plate');
  // A vehicle fixed to Cabby or Route belongs there; an "either" vehicle belongs where its report went (Cabby if it has none)
  const inGrp = v => (v.mode === 'cabby' || v.mode === 'route' ? v.mode === grp : (apMode.get(v.plate) || 'cabby') === grp);
  const sh = all.filter(s => grpOf(s.c.mode) === grp);
  const saved = Object.fromEntries((await q('SELECT plate,reason,note FROM day_missing WHERE cdate=?', date)).map(m => [m.plate, m]));
  // 📅 with a plan, each planned shift needs its approved report; without one, the vehicle needs at least one
  const plan = await q("SELECT plate, shift_no FROM roster WHERE rdate=? AND kind='work' AND driver_id IS NOT NULL", date);
  const apShift = new Set((await q("SELECT plate, shift_no FROM shifts WHERE shift_date=? AND status='APPROVED'", date)).map(r => r.plate + '|' + r.shift_no));
  const cfgC = await getCfg(env), lacks = v => { const p = plan.filter(x => x.plate === v.plate); return p.length ? p.filter(x => !apShift.has(v.plate + '|' + x.shift_no)).map(x => shiftDef(cfgC, v.mode === 'route' ? 'route' : 'cabby', x.shift_no)?.name || String(x.shift_no)) : (apMode.has(v.plate) ? [] : ['*']); };
  const missing = vs.filter(v => inGrp(v) && lacks(v).length).map(v => ({ plate: v.plate, driver: v.driver, shifts: lacks(v).filter(x => x !== '*'),
    auto: (v.status || 'ok') !== 'ok' && v.status_since && date > v.status_since ? 'repair' : '', reason: saved[v.plate]?.reason || '', note: saved[v.plate]?.note || '' }));
  const ap = sh.filter(s => s.status === 'APPROVED').map(s => s.c), S = f => r2(ap.reduce((t, x) => t + num(f(x)), 0));
  const plates = new Set(ap.map(x => x.plate).concat(vs.filter(inGrp).map(v => v.plate)));
  const ti = (await q("SELECT plate,cash FROM platform_trips WHERE source='telebirr' AND trip_date=?", date)).filter(t => plates.has(t.plate));
  const teleDeclared = S(x => x.teleTotal), teleImported = ti.length ? r2(ti.reduce((t, x) => t + num(x.cash), 0)) : null, teleGap = teleImported == null ? 0 : r2(teleImported - teleDeclared);
  const tv = (await teleView(env, date, date, null)).rows.filter(r => r.plate && plates.has(r.plate)), tc = k => tv.filter(r => r.status === k && !r.res).length;
  const cash = { due: S(x => x.totalCashDue), deposited: S(x => x.cashDeposited), shortfall: S(sfOf), teleDeclared, teleImported, teleGap,
    teleMissing: tc('missing'), teleDiff: tc('diff'), teleUnclaimed: tc('unclaimed'), teleDup: tv.filter(r => r.dup && !r.res).length };
  const teleStmt = await teleNeed(env, await getCfg(env), date, plates);
  const row = await env.DB.prepare('SELECT * FROM day_close WHERE cdate=? AND grp=?').bind(date, grp).first();
  return { date, mode: grp, status: row?.status === 'closed' ? 'closed' : 'open', closedBy: row?.closed_by || '', closedAt: row?.closed_at || '', note: row?.note || '',
    reopenedBy: row?.reopened_by || '', reopenedAt: row?.reopened_at || '', reopenReason: row?.reopen_reason || '', snapshot: row?.status === 'closed' ? JSON.parse(row.snapshot || '{}') : null,
    approved: ap.length, pending: sh.filter(s => s.status === 'PENDING').map(s => ({ id: s.id, plate: s.plate, driver: s.c.driverName })),
    returned: sh.filter(s => s.status === 'REJECTED').map(s => ({ id: s.id, plate: s.plate, driver: s.c.driverName, reason: s.reject_reason || '' })),
    missing, cash, teleStmt, needCashNote: cash.shortfall > 0 || Math.abs(teleGap) >= 1 || cash.teleMissing > 0 || cash.teleDiff > 0 || cash.teleDup > 0 };
}
// Breaks a driver took on a date: minutes (an open break counts until now), count, and the list for the report
async function breaksFor(env, cfg, did, date) {
  const rows = (await env.DB.prepare('SELECT * FROM breaks WHERE driver_id=? AND bdate=? ORDER BY id').bind(did, date).all()).results;
  const hhmm = ts => new Date(Date.parse(ts) + 3 * 3600e3).toISOString().slice(11, 16);
  const list = rows.map(b => ({ reason: b.reason, start: hhmm(b.start_ts), end: b.end_ts ? hhmm(b.end_ts) : '', min: Math.max(0, Math.round(((b.end_ts ? Date.parse(b.end_ts) : Date.now()) - Date.parse(b.start_ts)) / 60e3)), open: !b.end_ts }));
  const minutes = list.reduce((t, b) => t + b.min, 0), max = num(cfg.breakMaxMin), maxN = num(cfg.breakMaxCount);
  return { list, minutes, count: list.length, over: (max > 0 && list.some(b => b.min > max)) || (maxN > 0 && list.length > maxN) };
}

// 📋 Who should have inspected which vehicle by now, and who has not (today; a shift is due inspectWithinMin after its start)
const addisMin = () => { const d = new Date(Date.now() + 3 * 36e5); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
async function inspMissing(env, cfg, date) {
  const today = addisDate(0), nowM = date < today ? 1e9 : date > today ? -1 : addisMin(), out = [];
  const vs = (await env.DB.prepare("SELECT plate,mode,driver_id,status FROM vehicles ORDER BY plate").all()).results.filter(v => (v.status || 'ok') === 'ok');
  const done = new Set((await env.DB.prepare('SELECT plate, shift_no FROM inspections WHERE idate=?').bind(date).all()).results.map(r => r.plate + '|' + r.shift_no));
  const ro = (await env.DB.prepare("SELECT r.*, d.name FROM roster r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.rdate=?").bind(date).all()).results;
  const names = Object.fromEntries((await env.DB.prepare('SELECT id,name FROM drivers').all()).results.map(d => [d.id, d.name]));
  for (const v of vs) {
    const grp = v.mode === 'route' ? 'route' : 'cabby', planned = ro.filter(r => r.plate === v.plate);
    for (const sd of shiftDefs(cfg, grp)) {
      const r = planned.find(x => x.shift_no === sd.no);
      let did = r ? (r.kind === 'work' ? r.driver_id : null) : null;
      if (!r && sd.no === 1 && !planned.length) { did = await driverFor(env, v.plate, date); if (did != null && ro.some(x => x.driver_id === did && x.plate !== v.plate)) did = null; } // no plan for this vehicle: its main driver, first shift only (unless planned on another vehicle)
      if (did == null || done.has(v.plate + '|' + sd.no)) continue;
      const st = hmMin(sd.start), wait = nowM - st;
      if (wait < num(cfg.handoverGraceMin)) continue;
      // same driver as the shift before (double shift): no inspection needed
      const before = sd.no > 1 ? planned.find(x => x.shift_no === sd.no - 1) : null;
      if (before && before.driver_id === did) continue;
      out.push({ plate: v.plate, shiftNo: sd.no, shiftName: sd.name, start: sd.start, driverId: did, driver: names[did] || '', waitMin: Math.min(wait, 24 * 60), overdue: wait >= num(cfg.inspectWithinMin), handover: sd.no > 1 });
    }
  }
  return out;
}
// ---- v4.4 management channel ----
const channelOf = async env => { try { return JSON.parse((await getKV(env, 'tg_channel')) || 'null'); } catch { return null; } };
async function ensureHook(env, origin) {
  const hookUrl = `${origin}/api/tg/hook/${await tgHookKey(env)}`;
  if ((await getKV(env, 'tg_hook')) === hookUrl + '#' + HOOK_UPDATES.join(',')) return true;
  const r = await tgApi(env, 'setWebhook', { url: hookUrl, secret_token: await tgHookKey(env), allowed_updates: HOOK_UPDATES });
  if (!r.ok) return false;
  await setKV(env, 'tg_hook', hookUrl + '#' + HOOK_UPDATES.join(','));
  return true;
}
async function tgPhoto(env, chat, bytes, mime, caption) {
  if (!env.TG_TOKEN || !chat || !bytes) return false;
  try {
    const fd = new FormData(); fd.append('chat_id', chat); fd.append('caption', String(caption || '').slice(0, 1000));
    fd.append('photo', new Blob([bytes], { type: mime || 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
    return !!(await r.json()).ok;
  } catch { return false; }
}
const feedText = async (env, text) => { const ch = await channelOf(env); return ch ? tg(env, text, ch.id) : false; };
const hhmm = ts => new Date(Date.parse(ts) + 3 * 3600e3).toISOString().slice(11, 16);
const feedWho = a => `👤 ${a.actor}${a.dev ? ` · 📱 ${devShort(a.dev)}` : ''}${a.dinfo ? ` · ${a.dinfo}` : ''}${a.city ? ` · ${a.city}` : ''}`;
// Post queued audit lines: important ones one by one now; small ones (minor) as one hourly bundle
async function flushFeed(env, minor = false) {
  const ch = await channelOf(env);
  if (!ch) return 0;
  const rows = (await env.DB.prepare('SELECT f.id fid, a.* FROM feed f JOIN audit a ON a.id=f.audit_id WHERE f.sent=0 AND f.minor=? ORDER BY f.id LIMIT ?').bind(minor ? 1 : 0, minor ? 400 : 15).all()).results;
  if (!rows.length) return 0;
  const claim = async id => num((await env.DB.prepare('UPDATE feed SET sent=2 WHERE id=? AND sent=0').bind(id).run()).meta?.changes) === 1;
  let n = 0;
  if (minor) {
    const mine = []; for (const r of rows) if (await claim(r.fid)) mine.push(r);
    if (!mine.length) return 0;
    const lines = mine.map(a => `${hhmm(a.ts)} ${FEED_ICON[a.action] || '•'} ${a.actor} — ${a.action.replace(/_/g, ' ').toLowerCase()}${a.detail ? ' ' + a.detail : ''}${a.dev ? ` · ${devShort(a.dev)}` : ''}${a.dinfo ? ` · ${a.dinfo}` : ''}`);
    const head = `⚪ የሰዓቱ ጥቅል (${hhmm(mine[0].ts)}–${hhmm(mine[mine.length - 1].ts)}) · ${mine.length}`;
    let buf = head, ok = true;
    for (const l of lines) { if (buf.length + l.length > 3800) { ok = (await tg(env, buf, ch.id)) && ok; buf = head + ' (ቀጣይ)'; } buf += '\n' + l; }
    ok = (await tg(env, buf, ch.id)) && ok;
    await env.DB.prepare(`UPDATE feed SET sent=? WHERE id IN (${mine.map(() => '?').join(',')})`).bind(ok ? 1 : 0, ...mine.map(r => r.fid)).run();
    return ok ? mine.length : 0;
  }
  for (const a of rows) {
    if (!(await claim(a.fid))) continue;
    if (FEED_RICH.includes(a.action)) { await env.DB.prepare('UPDATE feed SET sent=1 WHERE id=?').bind(a.fid).run(); continue; } // posted in full elsewhere
    const text = `${FEED_ICON[a.action] || '•'} *${a.action.replace(/_/g, ' ')}* — ${a.detail || ''}\n${feedWho(a)} · 🕒 ${hhmm(a.ts)}${a.geo ? `\n📍 https://maps.google.com/?q=${a.geo}` : ''}`;
    const ok = await tg(env, text, ch.id);
    await env.DB.prepare('UPDATE feed SET sent=? WHERE id=?').bind(ok ? 1 : 0, a.fid).run();
    if (!ok) break; // Telegram busy: try again on the next request
    n++;
  }
  return n;
}
// A full approved report + its odometer / receipt photos
async function feedShift(env, shiftId, calc, title, actor) {
  const ch = await channelOf(env);
  if (!ch) return;
  const ri = env._ri || {};
  await tg(env, `${report(calc, title)}\n👔 ${actor}${ri.dev ? ` · 📱 ${devShort(ri.dev)}` : ''}`, ch.id);
  for (const p of (await env.DB.prepare('SELECT kind,mime,data,in_r2 FROM photos WHERE shift_id=?').bind(shiftId).all()).results) {
    let data = p.data;
    if (p.in_r2) { const o = env.PHOTOS && await env.PHOTOS.get(`shift/${shiftId}/${p.kind}`); data = o ? await o.arrayBuffer() : null; }
    if (data) await tgPhoto(env, ch.id, data, p.mime, `${p.kind === 'odo' ? '📷 ኦዶሜትር' : '🧾 ደረሰኝ'} — ${calc.plate} · ${calc.shiftDate}`);
  }
}

async function buildBackup(env) {
  const all = async q => (await env.DB.prepare(q).all()).results;
  return JSON.stringify({ app: APP.name, version: APP.version, copyright: APP.copyright, exportedAt: now(), note: 'PINs are not included. Restore needs a re-run of /api/setup for PINs.',
    policy: JSON.parse((await getKV(env, 'policy')) || '{}'),
    vehicles: (await all('SELECT * FROM vehicles')).map(({ pin_hash, ...v }) => v),
    managers: (await all('SELECT id,name,role,active,created_at FROM managers')),
    drivers: (await all('SELECT * FROM drivers')).map(({ pin_hash, ...d }) => d), assignments: await all('SELECT * FROM assignments'),
    expenses: await all('SELECT id,plate,exp_date,category,amount,months,ref,note,by_actor,created_at FROM expenses ORDER BY id'),
    shifts: (await all('SELECT * FROM shifts ORDER BY id')).map(r => ({ ...r, form: JSON.parse(r.form), calc: JSON.parse(r.calc) })),
    dayClose: await all('SELECT * FROM day_close'), dayMissing: await all('SELECT * FROM day_missing'), breaks: await all('SELECT * FROM breaks ORDER BY id'),
    incidents: await all('SELECT * FROM incidents ORDER BY id'), devices: await all('SELECT * FROM devices'),
    payments: await all('SELECT * FROM payments ORDER BY id'), charging: await all('SELECT * FROM charging ORDER BY id'), platformTrips: await all('SELECT * FROM platform_trips ORDER BY id'),
    audit: await all('SELECT * FROM audit ORDER BY id DESC LIMIT 5000') });
}
const pin4 = p => /^\d{4}$/.test(String(p));
const pinStaff = p => /^\d{6,12}$/.test(String(p));
const csvCell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
const sfOf = x => x.shortfall ?? Math.max(0, -x.cashVariance);
const bdOf = x => x.bonusDeduction ?? Math.min(sfOf(x), x.totalCombinedBonus);
const mpOf = x => x.driverMustPay ?? (sfOf(x) - bdOf(x));
const pfbOf = x => x.penaltyFromBonus ?? Math.min(num(x.kmPenaltyEtb), Math.max(0, num(x.totalCombinedBonus) - bdOf(x)));
const pdOf = x => x.penaltyDebt ?? (num(x.kmPenaltyEtb) - pfbOf(x));
function totals(rows) {
  const t = { shifts: 0, km: 0, bonus: 0, penalty: 0, shortfall: 0, fromBonus: 0, mustPay: 0, net: 0, roundTrips: 0, routeCash: 0, passengers: 0, overtimeHours: 0, telebirr: 0, faresShort: 0 };
  for (const r of rows) {
    t.shifts++; t.km += num(r.actualKm); t.bonus += num(r.totalCombinedBonus); t.penalty += num(r.kmPenaltyEtb);
    t.shortfall += sfOf(r); t.fromBonus += bdOf(r); t.mustPay += mpOf(r); t.roundTrips += num(r.roundTrips); t.routeCash += r.mode === 'route' ? num(r.totalCashDue) : 0;
    t.passengers += num(r.passengers); t.overtimeHours += num(r.overtimeMinutes) / 60; t.telebirr += num(r.teleTotal); t.faresShort += Math.max(0, num(r.revenueGap));
  }
  t.net = t.bonus - t.fromBonus - t.penalty; t.overtimeHours = r2(t.overtimeHours);
  return t;
}

// Remember which phones each person uses. New phone / one phone shared by two people -> alert lines.
// With deviceLock on, a driver's second phone waits for the Fleet Admin's approval.
async function trackDevice(env, cfg, who, name, isDriver) {
  const ri = env._ri || {}, dev = ri.dev;
  if (!dev) return { ok: true, alert: [] };
  const t = now(), row = await env.DB.prepare('SELECT approved FROM devices WHERE dev=? AND who=?').bind(dev, who).first();
  if (row) {
    await env.DB.prepare('UPDATE devices SET last_ts=?, info=?, name=? WHERE dev=? AND who=?').bind(t, ri.info || '', name, dev, who).run();
    return isDriver && cfg.deviceLock && !row.approved ? { ok: false, alert: [] } : { ok: true, alert: [] };
  }
  const n = num((await env.DB.prepare('SELECT COUNT(*) n FROM devices WHERE who=?').bind(who).first())?.n);
  const approved = isDriver && cfg.deviceLock && n > 0 ? 0 : 1;
  await env.DB.prepare('INSERT INTO devices(dev,who,name,info,first_ts,last_ts,approved) VALUES(?,?,?,?,?,?,?)').bind(dev, who, name, ri.info || '', t, t, approved).run();
  const others = (await env.DB.prepare('SELECT who,name FROM devices WHERE dev=? AND who<>? AND last_ts>=?').bind(dev, who, new Date(Date.now() - 30 * 864e5).toISOString()).all()).results;
  const alert = [];
  if (n > 0) alert.push(`🆕 ${name} ከአዲስ መሳሪያ ገባ — ${devShort(dev)} · ${ri.info || '?'}${ri.city ? ' · ' + ri.city : ''}`);
  if (others.length) alert.push(`⚠️ አንድ መሳሪያ በብዙ ሰዎች፦ ${devShort(dev)} — ${[name, ...new Set(others.map(o => o.name))].join(' እና ')}`);
  if (!approved) alert.push(`🔒 ${name}፦ አዲሱ ስልክ እስኪጸድቅ መግባት አይችልም (🚐 Fleet › 👤 Drivers › 📱)`);
  if (alert.length) await audit(env, name, 'DEVICE', null, alert.join(' | ').slice(0, 900));
  return { ok: !!approved, alert };
}

async function handle(req, env, ctx) {
  const url = new URL(req.url), path = url.pathname, m = req.method;
  if (!env.SESSION_SECRET) return fail('Server not configured', 500);
  await ensureSchema(env);
  const bgErr = e => console.error('ETEV background', e && e.stack || e);
  const bg = p => (ctx && ctx.waitUntil ? ctx.waitUntil(p.catch(bgErr)) : p.catch(bgErr));
  let body = {};
  const photoPath = path.match(/^\/api\/shifts\/(\d+)\/photo$/);
  if ((m === 'POST' || m === 'PUT') && !photoPath && !/^\/api\/(expenses|incidents|inspections|docs)\/\d+\/photo$/.test(path)) {
    const limit = path === '/api/platform/import' || path === '/api/tele/statement' ? 1024 * 1024 : MAX_BODY; // report imports and Telebirr statements can be large
    if (num(req.headers.get('content-length')) > limit) return fail('Request too large', 413);
    const raw = await req.text();
    if (raw.length > limit) return fail('Request too large', 413);
    try { body = raw ? JSON.parse(raw) : {}; } catch { return fail('Bad JSON'); }
    if (body === null || typeof body !== 'object') return fail('Bad JSON');
  }
  // Who is calling from where: device id (kept on the phone), phone/browser, IP, city. Goes on every audit line.
  env = { ...env, _ri: { dev: String(req.headers.get('x-device') || '').replace(/[^a-z0-9]/gi, '').slice(0, 32), ip: (req.headers.get('cf-connecting-ip') || '').slice(0, 45),
    city: [req.cf?.city, req.cf?.country].filter(Boolean).join(', ').slice(0, 60), info: devInfo(req.headers.get('user-agent'), String(req.headers.get('x-device-model') || '').slice(0, 30)), geo: '' } };

  // ---- Public ----
  if (path === '/api/version' && m === 'GET') return J(APP);
  const hook = path.match(/^\/api\/tg\/hook\/([a-f0-9]{32})$/);
  if (hook && m === 'POST') { // Telegram bot updates (Start / stop)
    const key = await tgHookKey(env);
    if (!safeEq(hook[1], key) || !safeEq(req.headers.get('x-telegram-bot-api-secret-token') || '', key)) return fail('Forbidden', 403);
    try { await tgWebhook(env, body); } catch (e) { console.error('tg hook', e); }
    return J({ ok: true });
  }
  if (path === '/api/plates' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT plate,mode FROM vehicles ORDER BY plate').all();
    return J(results.map(r => ({ plate: r.plate, mode: r.mode || 'any' })));
  }
  // ⭐ Public: the passenger's feedback page (no login). One per phone (or per network when no phone) per vehicle per day.
  const fbv = path.match(/^\/api\/feedback\/v\/([a-f0-9]{8,32})$/);
  if (fbv && m === 'GET') {
    const v = await env.DB.prepare('SELECT plate, mode FROM vehicles WHERE fb_code=?').bind(fbv[1]).first();
    if (!v) return fail('This QR code is not active (ይህ QR አይሰራም)', 404);
    return J({ plate: v.plate, mode: v.mode || 'any', tags: FB_TAGS });
  }
  if (path === '/api/feedback' && m === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    if (await locked(env, 'fb:' + ip, 30)) return fail('Too many messages — try later', 429);
    await bump(env, 'fb:' + ip);
    const v = await env.DB.prepare('SELECT plate, mode FROM vehicles WHERE fb_code=?').bind(String(body.code || '').slice(0, 32)).first();
    if (!v || !body.code) return fail('This QR code is not active', 404);
    const stars = Math.floor(num(body.stars)); if (stars < 1 || stars > 5) return fail('ኮከብ ይምረጡ (Pick 1–5 stars)');
    const tags = (Array.isArray(body.tags) ? body.tags : []).filter(t => FB_TAGS[t]).slice(0, 5), text = String(body.text || '').trim().slice(0, 500);
    const ph = String(body.phone || '').replace(/[^\d]/g, '').replace(/^251/, '0').replace(/^9/, '09');
    if (ph && !/^0[79]\d{8}$/.test(ph)) return fail('ስልክ ቁጥሩ ትክክል አይደለም (Phone number?)');
    const today = addisDate(0), who = ph ? 'p:' + (await hmac(env.SESSION_SECRET, ph)).slice(0, 24) : 'i:' + (await hmac(env.SESSION_SECRET, ip)).slice(0, 24);
    if (await env.DB.prepare('SELECT 1 x FROM feedback WHERE plate=? AND fdate=? AND who=?').bind(v.plate, today, who).first()) return fail('ዛሬ ለዚህ መኪና አስተያየት ሰጥተዋል — እናመሰግናለን! (Already sent today for this vehicle)', 409);
    const cfgF = await getCfg(env), hmNow = new Date(Date.now() + 3 * 36e5).toISOString().slice(11, 16), grp = v.mode === 'route' ? 'route' : 'cabby';
    const did = await driverFor(env, v.plate, today, shiftAt(cfgF, grp, hmNow)), complaint = stars <= 2 || tags.includes('fare') && stars <= 3 ? 1 : 0;
    await env.DB.prepare('INSERT INTO feedback(plate,driver_id,fdate,at,stars,tags,text,phone,who,complaint) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(v.plate, did ?? null, today, now(), stars, tags.join(','), text, ph, who, complaint).run();
    if (complaint) {
      const dn = did != null ? (await env.DB.prepare('SELECT name FROM drivers WHERE id=?').bind(did).first())?.name : '';
      bg(notify(env, cfgF, 'feedback', `⭐ *የተሳፋሪ ቅሬታ — ${v.plate}*${dn ? ` (${dn})` : ''}\n${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}${tags.length ? ' · ' + tags.map(t => FB_TAGS[t]).join(', ') : ''}${text ? `\n💬 ${text}` : ''}${ph ? `\n📞 ${ph}` : ''}\n${hmNow}`));
    }
    return J({ ok: true });
  }
  if (path === '/api/setup' && m === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    if (await locked(env, `setup:${ip}`, 5)) return fail('Too many attempts', 429);
    if (!env.SETUP_KEY || !safeEq(String(body.key || ''), env.SETUP_KEY)) { await bump(env, `setup:${ip}`); return fail('Forbidden', 403); }
    // Validate everything before saving anything
    const mgrs = Array.isArray(body.managers) ? body.managers : (body.managerPin ? [{ name: body.managerName || DEF.managerName, pin: body.managerPin }] : []);
    if (!pinStaff(body.adminPin)) return fail('Admin PIN must be 6-12 digits');
    const pins = new Set([String(body.adminPin)]);
    for (const g of mgrs) {
      if (!String(g.name || '').trim() || !pinStaff(g.pin)) return fail('Each manager needs a name and a 6-12 digit PIN');
      if (pins.has(String(g.pin))) return fail('Admin and manager PINs must all be different');
      pins.add(String(g.pin));
    }
    const vs = Array.isArray(body.vehicles) ? body.vehicles : [];
    for (const v of vs) {
      if (!String(v.plate || '').trim() || !pin4(v.pin)) return fail('Each vehicle needs plate and 4-digit pin');
      if (v.mode && !MODES.includes(v.mode)) return fail('Vehicle mode must be any, cabby or route');
    }
    await setKV(env, 'admin_pin', await hashPin(body.adminPin));
    await setKV(env, 'admin_lookup', await pinLookup(env, body.adminPin));
    await setKV(env, 'admin_ver', num(await getKV(env, 'admin_ver')) + 1);
    await delKV(env, 'manager_pin');
    for (const g of mgrs) {
      const name = String(g.name).trim().slice(0, 60), lk = await pinLookup(env, g.pin), h = await hashPin(g.pin);
      const ex = await env.DB.prepare('SELECT id FROM managers WHERE name=?').bind(name).first();
      await env.DB.prepare('DELETE FROM managers WHERE lookup=? AND id IS NOT ?').bind(lk, ex?.id ?? null).run();
      if (ex) await env.DB.prepare('UPDATE managers SET pin_hash=?,lookup=?,ver=ver+1,active=1 WHERE id=?').bind(h, lk, ex.id).run();
      else await env.DB.prepare('INSERT INTO managers(name,pin_hash,lookup,created_at) VALUES(?,?,?,?)').bind(name, h, lk, now()).run();
    }
    if (!(await getKV(env, 'policy'))) await setKV(env, 'policy', JSON.stringify({ ...DEF, adminName: body.adminName || DEF.adminName, managerName: body.managerName || DEF.managerName }));
    for (const v of vs) {
      await env.DB.prepare("INSERT INTO vehicles(plate,driver,phone,pin_hash,next_start_km,mode,pin_ver) VALUES(?,?,?,?,?,?,1) ON CONFLICT(plate) DO UPDATE SET driver=excluded.driver,phone=excluded.phone,pin_hash=excluded.pin_hash,mode=excluded.mode,pin_ver=vehicles.pin_ver+1")
        .bind(String(v.plate).toUpperCase().trim(), v.driver || '', v.phone || '', await hashPin(v.pin), num(v.nextStartKm), v.mode || 'any').run();
      await upsertMainDriver(env, String(v.plate).toUpperCase().trim(), v.driver, v.phone, v.pin);
    }
    await audit(env, 'setup', 'SETUP', null, `${mgrs.length} manager(s), ${vs.length} vehicle(s)`);
    return J({ ok: true });
  }
  if (path === '/api/login' && m === 'POST') {
    if (body.role === 'driver') {
      // Drivers sign in with their phone number + PIN (or, for older setups, the vehicle plate = its main driver)
      const ph = normPhone(body.phone), plate = String(body.plate || '').toUpperCase();
      let d = null;
      if (ph) d = await env.DB.prepare('SELECT * FROM drivers WHERE phone=?').bind(ph).first();
      else if (plate) d = await env.DB.prepare('SELECT d.* FROM drivers d JOIN vehicles v ON v.driver_id=d.id WHERE v.plate=?').bind(plate).first();
      const r = await guardedLogin(env, req, 'drv:' + (ph || plate), () => d && d.active && checkPin(body.pin, d.pin_hash));
      if (r === 'LOCKED') return fail('Too many attempts. Wait 15 minutes.', 429);
      if (r !== 'OK') return fail(d && !d.active ? 'This driver account is switched off' : 'Wrong phone number or PIN', 401);
      const cfg = await getCfg(env), td = await trackDevice(env, cfg, 'd:' + d.id, d.name, true);
      if (td.alert.length) bg(notify(env, cfg, 'security', td.alert.join('\n')));
      if (!td.ok) return fail('ይህ ስልክ ገና አልተፈቀደም። ፍሊት አድሚኑ እስኪያጸድቀው ይጠብቁ። (This phone is not approved yet — ask the Fleet Admin.)', 403);
      await audit(env, `Driver ${d.name}`, 'LOGIN', null, devShort(env._ri.dev));
      return J({ token: await signToken(env, { role: 'driver', did: d.id, v: d.pin_ver ?? 1 }, Math.min(30, Math.max(1, num(cfg.driverSessionDays) || 7)) * 24), days: num(cfg.driverSessionDays) || 7 });
    }
    let who = null;
    const r = await guardedLogin(env, req, 'staff', async () => !!(who = await staffLogin(env, body.pin)));
    if (r === 'LOCKED') return fail('Too many attempts. Wait 15 minutes.', 429);
    if (r !== 'OK') return fail('Wrong PIN', 401);
    const cfg = await getCfg(env);
    const sName = who.role === 'admin' ? cfg.adminName : who.name, td = await trackDevice(env, cfg, who.role === 'admin' ? 'a' : 'm:' + who.mid, sName, false);
    if (td.alert.length) bg(notify(env, cfg, 'security', td.alert.join('\n')));
    await audit(env, sName, 'LOGIN', null, devShort(env._ri.dev));
    const tok = who.role === 'admin' ? { role: 'admin', v: num(await getKV(env, 'admin_ver')) } : { role: 'staff', mid: who.mid, v: who.ver };
    return J({ token: await signToken(env, tok) });
  }

  // ---- Authenticated ----
  const me = await readToken(env, req);
  if (!me) return fail('Unauthorized', 401);
  const cfg = await getCfg(env);
  if (!cfg.groupTg) env.TG_CHAT_ID = ''; // the shared group is switched off: only personal messages
  // Session is revoked as soon as the PIN changes or the account/vehicle is removed
  let actor, myVehicle = null, myDriver = null, role;
  if (me.role === 'driver') {
    if (me.did == null && me.plate) { // a session from before v4: the vehicle's main driver
      const v0 = await env.DB.prepare('SELECT driver_id FROM vehicles WHERE plate=?').bind(me.plate).first();
      me.did = v0?.driver_id ?? -1;
    }
    myDriver = await env.DB.prepare('SELECT * FROM drivers WHERE id=?').bind(me.did ?? -1).first();
    if (!myDriver || !myDriver.active || (myDriver.pin_ver ?? 1) !== me.v) return fail('Unauthorized', 401);
    if (cfg.deviceLock && env._ri.dev) { // a phone the Fleet Admin blocked is signed out at once
      const dv = await env.DB.prepare('SELECT approved FROM devices WHERE dev=? AND who=?').bind(env._ri.dev, 'd:' + myDriver.id).first();
      if (dv && !dv.approved) return fail('Unauthorized', 401);
    }
    me.plate = await plateFor(env, myDriver.id, addisDate(0));
    myVehicle = me.plate ? await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(me.plate).first() : null;
    actor = `Driver ${myDriver.name}${me.plate ? ` (${me.plate})` : ''}`;
    role = 'driver';
  } else if (me.role === 'admin') {
    if (num(await getKV(env, 'admin_ver')) !== me.v) return fail('Unauthorized', 401);
    actor = cfg.adminName; role = 'admin';
  } else if (me.role === 'manager' || me.role === 'staff') {
    const mg = await env.DB.prepare('SELECT * FROM managers WHERE id=?').bind(me.mid ?? -1).first();
    if (!mg || !mg.active || mg.ver !== me.v) return fail('Unauthorized', 401);
    actor = mg.name; role = ROLES.includes(mg.role) ? mg.role : 'manager';
  } else return fail('Unauthorized', 401);
  const staff = role !== 'driver', admin = role === 'admin';
  const myWho = role === 'driver' ? 'd:' + myDriver.id : admin ? 'a' : 'm:' + me.mid;
  // Permission check: the Super Admin can do everything; other staff only what their role is switched on for
  const can = p => { if (admin) return true; if (!staff) return false; const pr = cfg.perms?.[role]; return !!(pr && p in pr ? pr[p] : DEF.perms[role]?.[p]); };
  const canAny = (...ps) => ps.some(can);
  const deny = () => fail('You do not have permission for this (ፈቃድ የለዎትም)', 403);

  if (path === '/api/me' && m === 'GET') {
    const btNorm = normBattThresholds(cfg);
    const pub = { bufferKm: cfg.bufferKm, minAccept: cfg.minAccept, yangoT2Min: cfg.yangoT2Min, yangoT2Max: cfg.yangoT2Max, whatsappAdmin: cfg.whatsappAdmin, managerName: cfg.managerName,
      lowBatteryPct: btNorm.any.alertPct, lowBatteryPctCabby: btNorm.cabby.alertPct, lowBatteryPctRoute: btNorm.route.alertPct, batteryThresholds: btNorm,
      maxDailyKm: cfg.maxDailyKm, requirePhotos: !!cfg.requirePhotos, routes: cfg.routes, standardHours: cfg.standardHours };
    const results = staff ? (await env.DB.prepare('SELECT * FROM vehicles ORDER BY plate').all()).results : (myVehicle ? [myVehicle] : []);
    const perms = Object.fromEntries(PERM_KEYS.map(k => [k, can(k)]));
    if (/^https:\/\//.test(url.origin) && (await appOrigin(env)) !== url.origin) await setKV(env, 'app_origin', url.origin); // links in Telegram messages
    Object.assign(pub, { breakMaxMin: num(cfg.breakMaxMin), breakMaxCount: num(cfg.breakMaxCount), fleetPhone: cfg.fleetPhone || '', emergencyPhones: cfg.emergencyPhones || '', driverMaxBackDays: num(cfg.driverMaxBackDays) || 7,
      incKinds: Object.fromEntries(Object.entries(INC_KINDS).map(([k, v]) => [k, v.l])), breakReasons: BREAK_REASONS, missReasons: MISS_REASONS, tgBot: !!env.TG_TOKEN,
      shiftTimes: cfg.shiftTimes || DEF.shiftTimes, requireInspection: !!cfg.requireInspection, handoverGraceMin: num(cfg.handoverGraceMin), routeBonus: cfg.routeBonus || DEF.routeBonus });
    const tgl = await env.DB.prepare('SELECT 1 x FROM tg_links WHERE who=?').bind(myWho).first();
    const unread = num((await env.DB.prepare('SELECT COUNT(*) n FROM notifications WHERE who=? AND seen=0').bind(myWho).first())?.n);
    const myPlan = myDriver ? (await env.DB.prepare("SELECT plate, shift_no FROM roster WHERE driver_id=? AND rdate=? AND kind='work' ORDER BY shift_no").bind(myDriver.id, addisDate(0)).all()).results.map(r => ({ plate: r.plate, shiftNo: r.shift_no })) : [];
    let myDocs = [];
    if (myDriver) { // 📄 my licence and my vehicle's papers that end within 30 days (or have ended)
      const pl = myVehicle?.plate || '', ts = Object.fromEntries([...docTypesOf(cfg, 'driver'), ...docTypesOf(cfg, 'vehicle', myVehicle?.mode)].map(t => [t.id, t.name]));
      myDocs = (await env.DB.prepare("SELECT * FROM documents WHERE ((owner_kind='driver' AND owner_id=?) OR (owner_kind='vehicle' AND owner_id=?)) AND expires<=? ORDER BY expires").bind(String(myDriver.id), pl, dAdd(addisDate(0), 30)).all()).results
        .filter(d => ts[d.type]).map(d => ({ type: d.type, name: ts[d.type], expires: d.expires, days: dDiff(addisDate(0), d.expires), permitted: !!(d.permit_until && d.permit_until >= addisDate(0)) }));
    }
    const myRating = myDriver ? await env.DB.prepare('SELECT COUNT(*) n, AVG(stars) a FROM feedback WHERE driver_id=? AND fdate>=?').bind(myDriver.id, addisDate(30)).first() : null;
    return J({ role, name: actor, plate: me.plate || null, driver: myDriver ? driverOut(myDriver) : null, today: addisDate(0), cfg: pub, myPlan, myDocs, myRating: myRating && myRating.n ? { n: myRating.n, avg: r1(myRating.a) } : null, photoStore: env.PHOTOS ? 'r2' : 'db',
      perms, vehicles: results.map(vehOut), tgLinked: !!tgl, unread, version: APP.version });
  }

  // Shared form normaliser: driver cannot choose plate, start KM, charging KM or waivers
  async function prepare(b) {
    const today = addisDate(0);
    let old = null;
    if (staff && b.id) {
      old = await env.DB.prepare('SELECT * FROM shifts WHERE id=?').bind(+b.id).first();
      if (!old) return { err: fail('Record not found', 404) };
    }
    if (staff && (!admin || b.review)) {
      // Approvers approve what the driver sent: they cannot type over the driver's numbers or enter reports themselves
      if (!can('approve')) return { err: deny() };
      if (!old) return { err: fail('Only the Super Admin can enter a report for a driver') };
      if (old.status !== 'PENDING') return { err: fail('Only the Super Admin can change a report after it is approved or returned') };
      const oc = JSON.parse(old.calc);
      const fl = b.fleet && typeof b.fleet === 'object' ? b.fleet : null; // 🛠 the approver's part: charging KM from the charging entries
      const ck = fl ? (Array.isArray(fl.charges) ? fl.charges : []).reduce((a, c) => a + Math.max(0, num(c.km)), 0) : oc.chargingKm;
      b = { ...b, waive: admin && b.review ? !!b.waive : false, form: { ...JSON.parse(old.form), plate: old.plate, shiftDate: old.shift_date, shiftNo: old.shift_no || 1, mode: oc.mode, startKm: oc.startKm, chargingKm: ck } };
    }
    const f0 = { ...(b.form || {}) };
    const shiftDate = /^\d{4}-\d{2}-\d{2}$/.test(f0.shiftDate || '') ? f0.shiftDate : today;
    // 📅 which shift (1 = first, 2 = second); checked against the group's shift list once the mode is known
    let shiftNo = Math.floor(num(f0.shiftNo)) || old?.shift_no || 1;
    let plate;
    if (!staff) {
      plate = (await plateFor(env, myDriver.id, shiftDate, shiftNo)) || await plateFor(env, myDriver.id, shiftDate);
      if (!plate) return { err: fail('No vehicle is assigned to you for this date. Ask the fleet admin. (ለዚህ ቀን መኪና አልተመደበልዎትም)') };
    } else plate = String(f0.plate || old?.plate || '').toUpperCase();
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    if (!v) return { err: fail('Unknown vehicle') };
    { const vm0 = v.mode && v.mode !== 'any' ? v.mode : (f0.mode === 'route' ? 'route' : 'cabby'); if (!shiftDef(cfg, vm0, shiftNo)) shiftNo = 1; }
    const did = !staff ? myDriver.id : (old && old.plate === plate && old.shift_date === shiftDate && (old.shift_no || 1) === shiftNo && old.driver_id != null ? old.driver_id : await driverFor(env, plate, shiftDate, shiftNo));
    if (!staff) { // the plan says someone else drives this shift
      const ro = await env.DB.prepare("SELECT r.driver_id, d.name FROM roster r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.rdate=? AND r.plate=? AND r.shift_no=? AND r.kind='work'").bind(shiftDate, plate, shiftNo).first();
      if (ro && ro.driver_id != null && ro.driver_id !== myDriver.id) return { err: fail(`📅 ይህ ፈረቃ ለ${ro.name || 'ሌላ ሹፌር'} ተመድቧል — ትክክለኛውን ፈረቃ ይምረጡ (This shift is planned for another driver)`) };
    }
    const drv = did != null ? await env.DB.prepare('SELECT * FROM drivers WHERE id=?').bind(did).first() : null;
    if (!drv) return { err: fail('This vehicle has no driver for that date. Assign one first.') };
    const f = { ...f0, plate, shiftDate, shiftNo, driverName: drv.name, driverPhone: drv.phone };
    f.mode = f.mode === 'route' ? 'route' : 'cabby';
    { const sd = shiftDef(cfg, f.mode, shiftNo); f.shiftName = sd ? sd.name : ''; f.shiftStartPlan = sd ? sd.start : ''; f.shiftEndPlan = sd ? sd.end : ''; }
    f.waiveReason = admin && b.waive ? String(b.waiveReason || '') : '';
    // A closed day is locked for everyone until the Super Admin reopens it
    if (await isClosed(env, f.shiftDate, f.mode)) return { err: fail(closedMsg(f.shiftDate, f.mode), 409) };
    if (old && old.shift_date !== f.shiftDate && await isClosed(env, old.shift_date, JSON.parse(old.calc).mode)) return { err: fail(closedMsg(old.shift_date, JSON.parse(old.calc).mode), 409) };
    // Server-side facts the driver cannot type: breaks taken (☕), incidents that day, GPS cleaned up
    const bk = await breaksFor(env, cfg, did, f.shiftDate);
    Object.assign(f, { breakMinutes: bk.minutes, breakCount: bk.count, breaks: bk.list, breakOver: bk.over,
      incidents: num((await env.DB.prepare('SELECT COUNT(*) n FROM incidents WHERE plate=? AND idate=?').bind(plate, f.shiftDate).first())?.n) });
    // 📅 the same driver on both shifts of this vehicle today (double shift)?
    const otherMine = await env.DB.prepare(`SELECT 1 x FROM shifts WHERE plate=? AND shift_date=? AND shift_no<>? AND driver_id=? AND status IN ('PENDING','APPROVED','REJECTED')
      UNION SELECT 1 FROM roster WHERE plate=? AND rdate=? AND shift_no<>? AND driver_id=? AND kind='work' UNION SELECT 1 FROM inspections WHERE plate=? AND idate=? AND shift_no<>? AND driver_id=? LIMIT 1`)
      .bind(plate, f.shiftDate, shiftNo, did, plate, f.shiftDate, shiftNo, did, plate, f.shiftDate, shiftNo, did).first();
    f.doubleShift = !!otherMine; if (!f.doubleShift) delete f.doubleShift;
    if (f.doubleShift) { // double shifts this driver worked in the last 7 days (this one included)
      const n = (await env.DB.prepare("SELECT shift_date FROM shifts WHERE driver_id=? AND shift_date>? AND shift_date<=? AND status IN ('PENDING','APPROVED') GROUP BY shift_date HAVING COUNT(DISTINCT shift_no)>1").bind(did, dAdd(f.shiftDate, -7), f.shiftDate).all()).results.length;
      f.doubleWeek = Math.max(n, 1); }
    { // 📱 Telebirr payments this driver recorded on this vehicle that day (on a double shift: split at the second shift's start)
      const s2 = shiftDef(cfg, f.mode, 2), cut = s2 ? `${f.shiftDate} ${s2.start}:00` : null;
      const win = f.doubleShift && cut ? (shiftNo === 1 ? ' AND ts<?' : ' AND ts>=?') : '';
      const tl = await env.DB.prepare(`SELECT COUNT(*) n, SUM(amount) s FROM tele_txn WHERE plate=? AND tdate=? AND amount IS NOT NULL AND (driver_id=? OR driver_id IS NULL)${win}`).bind(plate, f.shiftDate, did, ...(win ? [cut] : [])).first();
      if (num(tl?.n)) f.teleLog = { n: num(tl.n), sum: r2(num(tl.s)) }; else delete f.teleLog; }
    // 📋 this shift's inspection: lateness of this driver, overtime of the driver before, the KM read at handover
    const insp = await env.DB.prepare('SELECT * FROM inspections WHERE plate=? AND idate=? AND shift_no=?').bind(plate, f.shiftDate, shiftNo).first();
    if (insp) {
      f.inspection = { status: insp.status, km: insp.km, at: insp.at, by: insp.driver_id === did ? 'self' : 'other' };
      if (insp.driver_id === did && insp.late_min > 0) {
        f.lateMin = insp.late_min;
        const n = num((await env.DB.prepare("SELECT COUNT(*) n FROM inspections WHERE driver_id=? AND late_min>0 AND substr(idate,1,7)=? AND (idate<? OR (idate=? AND id<=?))").bind(did, f.shiftDate.slice(0, 7), f.shiftDate, f.shiftDate, insp.id).first())?.n);
        f.lateCount = n; if (n > num(cfg.lateFreePerMonth)) f.lateFine = Math.round(insp.late_min * num(cfg.overtimeRate) / 60);
      }
    } else delete f.inspection;
    { const nx = await env.DB.prepare('SELECT ot_min, driver_id FROM inspections WHERE plate=? AND idate=? AND shift_no=?').bind(plate, f.shiftDate, shiftNo + 1).first();
      if (nx && nx.ot_min > 0 && nx.driver_id !== did) f.reliefLateMin = nx.ot_min; else delete f.reliefLateMin; }
    { // 🟣 Cabby Reserve runs this driver finished on this vehicle and shift (paid online — no cash)
      const rr = (await env.DB.prepare("SELECT * FROM reserve_runs WHERE plate=? AND rdate=? AND shift_no=? AND driver_id=? AND status='done'").bind(plate, f.shiftDate, shiftNo, did).all()).results;
      if (rr.length) f.reserve = rsvSum(rr); else delete f.reserve;
      if (f.reserve?.last) { // how the last run ended against the end of the shift and the place the report is sent from (for the manager)
        const L = f.reserve.last, endHm = new Date(Date.parse(L.at) + 3 * 36e5).toISOString().slice(11, 16), pe = hmMin(f.shiftEndPlan), le = hmMin(endHm);
        if (pe != null && le != null) L.minToShiftEnd = (pe - le + 1440) % 1440 > 720 ? (pe - le + 1440) % 1440 - 1440 : (pe - le + 1440) % 1440;
        L.endHm = endHm; const g0 = cleanGeo(f0.geo);
        if (g0 && L.lat != null) L.kmToReport = r1(gpsKm(L.lat, L.lng, g0.lat, g0.lng));
      }
      f.reserveOpen = num((await env.DB.prepare("SELECT COUNT(*) n FROM reserve_runs WHERE plate=? AND rdate=? AND shift_no=? AND driver_id=? AND status='run'").bind(plate, f.shiftDate, shiftNo, did).first())?.n); if (!f.reserveOpen) delete f.reserveOpen; }
    const g = cleanGeo(f0.geo); if (g) f.geo = g; else delete f.geo;
    if (DEP_METHODS[f0.depMethod]) f.depMethod = f0.depMethod; else delete f.depMethod;
    if (!staff) {
      const back = Math.min(31, Math.max(1, num(cfg.driverMaxBackDays) || 7));
      if (f.shiftDate > today || f.shiftDate < addisDate(back)) return { err: fail(`Date must be today or up to ${back} days back (ቀኑ ዛሬ ወይም እስከ ${back} ቀን ወደኋላ መሆን አለበት)`) };
      if ((v.status || 'ok') !== 'ok' && v.status_since && f.shiftDate > v.status_since)
        return { err: fail(`⏸ ${plate} is off the road (${v.status === 'repair' ? 'ጥገና ላይ ነው' : 'በምርመራ ላይ ነው'}) since ${v.status_since}. Ask the Fleet Admin. (መኪናው ከስራ ውጭ ነው)`, 409) };
      f.chargingKm = 0;
      // Start KM comes from the last approved shift; if an earlier shift is still pending, continue from its End KM
      f.startKm = v.next_start_km;
      const prev = await env.DB.prepare(`SELECT calc FROM shifts WHERE plate=? AND status='PENDING' AND ${SHIFT_BEFORE} ORDER BY shift_date DESC, shift_no DESC, id DESC LIMIT 1`).bind(plate, f.shiftDate, f.shiftDate, shiftNo).first();
      if (prev) { const pe = num(JSON.parse(prev.calc).endKm); if (pe > f.startKm) f.startKm = pe; }
      // the shift before today's has no report yet: start from the odometer read at the handover
      const sameDayBefore = await env.DB.prepare("SELECT 1 x FROM shifts WHERE plate=? AND shift_date=? AND shift_no<? AND status IN ('PENDING','APPROVED') LIMIT 1").bind(plate, f.shiftDate, shiftNo).first();
      if (insp && !sameDayBefore && num(insp.km) > f.startKm) f.startKm = num(insp.km);
      // 📋 no report before the shift's inspection (unless the same driver goes on from the shift before)
      if (insp && insp.status === 'held' && (v.status || 'ok') !== 'ok') return { err: fail('⏸ መኪናው በፍተሻ ቆሟል — ፍሊት አድሚኑ እስኪወስን ሪፖርት አይላክም (Vehicle held at the inspection)', 409) };
      if (cfg.requireInspection && !insp && !(f.doubleShift && shiftNo > 1)) return { err: fail('📋 መጀመሪያ የመኪናውን ፍተሻ ያድርጉ (Do the vehicle inspection for this shift first)') };
      { const dl = await docBlocks(env, cfg, did, plate, f.shiftDate); if (dl.length) return { err: fail(docBlockMsg(dl), 409) }; }
      if (f.reserveOpen) return { err: fail('🟣 ያልተጨረሰ የካቢ ሪዘርቭ ጉዞ አለ — መጀመሪያ "🏁 ደረስኩ" ወይም "ሰርዝ" ይበሉ (Finish the open Cabby Reserve run first)', 409) };
    } else if (f.shiftDate > today) return { err: fail('Date cannot be in the future') };
    // Fixed vehicle mode (Cabby or Route) — enforced for drivers and for new staff entries
    const vm = v.mode || 'any';
    if (vm !== 'any' && f.mode !== vm && (me.role === 'driver' || !old))
      return { err: fail(vm === 'route' ? 'This vehicle is registered as a Route / Zone vehicle (🟢 ቀጠና)' : 'This vehicle is registered as a Cabby vehicle (🔵 ካቢ)') };
    // Re-editing an approved record keeps the bonus/penalty rates it was approved with
    let useCfg = cfg;
    if (old && old.status === 'APPROVED') {
      const oc = JSON.parse(old.calc), r = oc.rates; if (r) useCfg = { ...cfg, ...r };
      if (oc.tripsCount) useCfg = { ...useCfg, fareOverride: { full: oc.fullFare, short: oc.shortFare } };
      if (oc.standardHours) useCfg = { ...useCfg, stdHoursOverride: oc.standardHours };
      if (oc.routeTarget != null) useCfg = { ...useCfg, routeTargetOverride: oc.routeTarget };
      if (oc.mode !== 'route' && oc.cashRule !== 2) useCfg = { ...useCfg, cashRuleOld: true };
    }
    return { v, f, old, did, calc: await compute(env, useCfg, f, actor, admin && !!b.waive) };
  }

  if (path === '/api/preview' && m === 'POST') {
    const p = await prepare(body);
    if (p.err) return p.err;
    return J({ calc: p.calc, report: report(p.calc, 'PREVIEW') });
  }

  if (path === '/api/shifts' && m === 'POST') {
    const p = await prepare(body);
    if (p.err) return p.err;
    if (!staff && p.f.mode !== 'route' && num(p.f.cabbyTrips) > 0 && String((body.form || {}).cabbyAccept ?? '').trim() === '') return fail('Cabby Accept % ከአፑ አይተው ያስገቡ (Enter the acceptance % from the app)');
    const { v, calc, old, did } = p;
    if (String(p.f.batterySoc ?? '').trim() === '') return fail('Enter the battery % (የባትሪ መጠን ያስገቡ)');
    const editReason = String(body.editReason || '').trim().slice(0, 160);
    if (admin && old && old.status === 'APPROVED' && editReason.length < 3) return fail('Write why this approved report is being changed (የማስተካከያ ምክንያት ይጻፉ)');
    // ✏️ the Super Admin changing a driver's numbers: what changed (from → to), with a reason; the driver is told
    let diff = [];
    if (admin && old && !body.review && body.form) { const of = JSON.parse(old.form), nf = body.form;
      const same = (x, y) => { const a = String(x ?? '').trim(), b = String(y ?? '').trim(); return a === b || (/^-?[\d.]*$/.test(a) && /^-?[\d.]*$/.test(b) && num(a) === num(b)); };
      diff = DIFF_KEYS.filter(k => k in nf && !same(of[k], nf[k])).map(k => `${k}: ${String(of[k] ?? '') || '—'} → ${String(nf[k] ?? '') || '—'}`);
      if (diff.length && old.submitted_by !== actor && editReason.length < 3) return fail('Write why you change the driver\'s numbers (የማስተካከያ ምክንያት ይጻፉ)'); }
    // 🛠 the approver's part: charging after/during the shift and the next start KM
    let charges = null, nextKm = null;
    if (staff && body.fleet && typeof body.fleet === 'object') {
      const fl = body.fleet;
      charges = (Array.isArray(fl.charges) ? fl.charges : []).slice(0, 5).map(c => ({ kwh: r2(num(c.kwh)), cost: r2(Math.max(0, num(c.cost))), socFrom: String(c.socFrom ?? '') === '' ? null : Math.min(100, Math.max(0, num(c.socFrom))),
        socTo: String(c.socTo ?? '') === '' ? null : Math.min(100, Math.max(0, num(c.socTo))), km: r1(Math.max(0, num(c.km))), location: String(c.location || '').trim().slice(0, 60) }));
      if (charges.some(c => !(c.kwh > 0) || c.kwh > 500)) return fail('⚡ የቻርጁን kWh ያስገቡ (kWh for each charge)');
      if (!charges.length && !fl.none) return fail('⚡ ቻርጁን ያስገቡ ወይም "ቻርጅ አልተደረገም" ይበሉ (Enter the charging or tick "no charging")');
      calc.charges = charges;
      if (String(fl.nextStartKm ?? '').trim() !== '') {
        const want = num(fl.nextStartKm), why = String(fl.nextReason || '').trim().slice(0, 160);
        if (want < calc.endKm) return fail(`ሚቀጥለው መነሻ ከ End KM (${calc.endKm}) ያነሰ ሊሆን አይችልም`);
        if (Math.abs(want - calc.nextDayStartKm) > 0.5) {
          if (why.length < 3) return fail(`ሚቀጥለው መነሻ ከስሌቱ (${calc.nextDayStartKm}) የተለየ ነው — ምክንያት ይጻፉ (reason for the different next start KM)`);
          nextKm = { calc: calc.nextDayStartKm, set: want, reason: why, by: actor }; calc.nextKm = nextKm; calc.nextDayStartKm = want;
        }
      }
    }
    if (calc.waived && calc.waivedPenalty > 0 && calc.waiveReason.length < 3) return fail('Write the reason for waiving the KM penalty (የይቅርታ ምክንያት ይጻፉ)');
    if (calc.mode === 'route' && calc.tripsCount) {
      const bad = calc.trips.find(t => !t.start || !t.end);
      if (bad) return fail(`Trip ${bad.n}: enter start and end time (የጉዞ ${bad.n} ሰዓት ያስገቡ)`);
      if (calc.trips.some(t => t.paxFull + t.paxShort === 0 && t.cash + t.tele > 0)) return fail('A trip has money but no passengers');
    }
    if (staff && cfg.requirePhotos && old && old.status !== 'APPROVED') {
      const have = (await env.DB.prepare('SELECT kind FROM photos WHERE shift_id=?').bind(old.id).all()).results.map(r => r.kind);
      const miss = Object.keys(PHOTO_KINDS).filter(k => !have.includes(k));
      if (miss.length && !admin) return fail(`Photo proof missing: ${miss.map(k => PHOTO_KINDS[k]).join(', ')}. Reject it or ask the Super Admin.`);
    }
    const sNo = calc.shiftNo || 1;
    if (!staff && await env.DB.prepare("SELECT 1 x FROM shifts WHERE plate=? AND shift_date=? AND shift_no=? AND status='APPROVED' LIMIT 1").bind(v.plate, calc.shiftDate, sNo).first())
      return fail('This shift is already approved. Ask the Fleet Manager to edit it. (ይህ ፈረቃ ጸድቋል)');
    // one report per vehicle, day and shift: another driver's report for the same shift is refused
    if (!staff) { const o = await env.DB.prepare("SELECT driver_id FROM shifts WHERE plate=? AND shift_date=? AND shift_no=? AND status IN ('PENDING','REJECTED') AND driver_id<>? LIMIT 1").bind(v.plate, calc.shiftDate, sNo, did).first();
      if (o) return fail('📅 ሌላ ሹፌር ለዚህ ፈረቃ ሪፖርት ልኳል — ትክክለኛውን ፈረቃ ይምረጡ (Another driver already reported this shift)'); }
    if (calc.endKm < calc.startKm) return fail('End KM cannot be lower than Start KM');
    if (calc.actualKm > MAX_SHIFT_KM) return fail(`Shift KM ${calc.actualKm} is over ${MAX_SHIFT_KM} — please check the odometer numbers`);
    if (calc.kmState === 'UNDERRUN') return fail('Invalid KM: shift KM is lower than app trip KM');
    const status = staff ? 'APPROVED' : 'PENDING';
    const approvedBy = staff ? actor : null;
    let id = old ? old.id : null;
    if (!staff) {
      const ex = await env.DB.prepare("SELECT id FROM shifts WHERE plate=? AND shift_date=? AND shift_no=? AND status IN ('PENDING','REJECTED') ORDER BY id DESC LIMIT 1").bind(v.plate, calc.shiftDate, sNo).first();
      id = ex?.id ?? null;
    }
    if (staff) {
      // Double approval guard: same vehicle, date and End KM already approved under another record
      const dupA = await env.DB.prepare("SELECT id FROM shifts WHERE plate=? AND shift_date=? AND shift_no=? AND status='APPROVED' AND json_extract(calc,'$.endKm')=? AND id IS NOT ? LIMIT 1").bind(v.plate, calc.shiftDate, sNo, calc.endKm, id).first();
      if (dupA) return fail('This shift is already approved (same vehicle, date and End KM)');
    }
    if (calc.txnRef !== 'N/A') {
      const dup = await env.DB.prepare("SELECT plate,shift_date FROM shifts WHERE n_ref=lower(?) AND id IS NOT ? LIMIT 1").bind(calc.txnRef, id).first();
      if (dup) return fail(`Telebirr reference already used for ${dup.plate} on ${dup.shift_date}`);
    }
    // Expected start = vehicle's current next start (for the newest shift only)
    const newerApproved = await env.DB.prepare(`SELECT 1 x FROM shifts WHERE plate=? AND status='APPROVED' AND ${SHIFT_AFTER} AND id IS NOT ? LIMIT 1`).bind(v.plate, calc.shiftDate, calc.shiftDate, sNo, id).first();
    const expectedStart = staff && !newerApproved && !(old && old.status === 'APPROVED') ? v.next_start_km : null;
    if (!staff && calc.geo) env._ri.geo = `${calc.geo.lat},${calc.geo.lng}`;
    // 🌙 late / 📤 offline mark: set when the driver sends; approvals and edits keep the driver's mark
    { const si = !staff ? sentInfo(body.sent, calc, cfg) : (old ? (({ late, clockSkewMin }) => ({ late, clockSkewMin }))(JSON.parse(old.calc)) : {});
      if (si.late) calc.late = si.late; else delete calc.late;
      if (si.clockSkewMin) calc.clockSkewMin = si.clockSkewMin; else delete calc.clockSkewMin; }
    const t = now(), form = JSON.stringify(old && staff && !admin ? JSON.parse(old.form) : body.form || {}), cj = JSON.stringify(calc);
    // All-or-nothing: the record, the vehicle's next Start KM and the audit entry are saved together
    const action = staff ? (old && old.status === 'APPROVED' ? 'EDIT' : 'APPROVE') : 'SUBMIT';
    const detail = `${v.plate} ${calc.shiftDate} ${calc.mode} bonus=${calc.totalCombinedBonus} pen=${calc.kmPenaltyEtb}${calc.penaltyDebt ? ` penDebt=${calc.penaltyDebt}` : ''}${calc.waived && calc.waivedPenalty ? ` WAIVED ${calc.waivedPenalty} (${calc.waiveReason})` : ''}${editReason && action === 'EDIT' ? ` · reason: ${editReason}` : ''}`;
    const stmts = [];
    if (id) {
      stmts.push(env.DB.prepare(`UPDATE shifts SET plate=?,shift_date=?,shift_no=?,status=?,form=?,calc=?,hash=?,approved_by=?,reject_reason=NULL,updated_at=?,driver_id=?,${N_SET} WHERE id=?`)
        .bind(v.plate, calc.shiftDate, sNo, status, form, cj, calc.hash, approvedBy, t, did, ...shiftNums(calc), id));
      stmts.push(auditStmt(env, actor, action, id, detail));
    } else {
      stmts.push(env.DB.prepare(`INSERT INTO shifts(plate,shift_date,shift_no,status,form,calc,hash,submitted_by,approved_by,created_at,updated_at,driver_id,${N_COLS.join(',')}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,${N_COLS.map(() => '?').join(',')})`)
        .bind(v.plate, calc.shiftDate, sNo, status, form, cj, calc.hash, actor, approvedBy, t, t, did, ...shiftNums(calc)));
      stmts.push(auditStmt(env, actor, action, null, detail, true));
    }
    if (staff && !newerApproved) stmts.push(env.DB.prepare('UPDATE vehicles SET next_start_km=? WHERE plate=?').bind(calc.nextDayStartKm, v.plate));
    if (diff.length) stmts.push(auditStmt(env, actor, 'EDIT_DIFF', id, `${v.plate} ${calc.shiftDate}: ${diff.join('; ')}${editReason ? ` · reason: ${editReason}` : ''}`.slice(0, 900)));
    if (nextKm) stmts.push(auditStmt(env, actor, 'NEXT_KM', id, `${v.plate}: next start ${nextKm.calc} → ${nextKm.set} · ${nextKm.reason}`));
    const res = await env.DB.batch(stmts);
    if (!id) id = res[0].meta.last_row_id;
    if (charges) { // ⚡ the charging entered at the approval goes to the charging list, linked to this report
      const cs = [env.DB.prepare('DELETE FROM charging WHERE shift_id=?').bind(id)];
      for (const c of charges) cs.push(env.DB.prepare('INSERT INTO charging(plate,chg_date,kwh,cost,soc_from,soc_to,odo_km,location,by_actor,created_at,shift_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(v.plate, calc.shiftDate, c.kwh, c.cost, c.socFrom, c.socTo, calc.endKm, c.location, actor, t, id));
      await env.DB.batch(cs);
    }
    if (nextKm) bg(notify(env, cfg, 'shiftAlert', `🔢 ${actor}፦ ${v.plate} ሚቀጥለው መነሻ ኪ.ሜ ${nextKm.calc} → *${nextKm.set}* ተቀይሯል\n📝 ${nextKm.reason}`));
    if (diff.length && did != null) bg(notifyDriver(env, did, 'returned', `✏️ *Super Admin ሪፖርትዎን አስተካክሏል* — ${v.plate} · ${calc.shiftDate}\n${diff.join('\n')}${editReason ? `\n📝 ${editReason}` : ''}`));
    // Telegram runs in the background so a slow Telegram never delays saving
    if (cfg.autoPushTg) {
      bg(tg(env, (staff || calc.mode === 'route') ? report(calc, staff ? 'APPROVED' : 'PENDING') :
        `🔔 *NEW PENDING SHIFT*\n🚐 ${v.plate} | ${calc.driverName}\n📅 ${calc.shiftDate}${lateLine(calc)}\n• Shift: ${calc.actualKm} KM (End ${calc.endKm})\n• Cabby ${calc.cabbyTrips} (+${calc.cabbyBonus}) | Yango ${calc.yangoTrips} (+${calc.yangoBonus})\n• Cash due ${calc.totalCashDue} | Deposited ${calc.cashDeposited} (Ref ${calc.txnRef})\n⏳ Waiting for Fleet Manager`));
    }
    const why = alertReasons(calc, cfg, expectedStart, staff);
    const bal = (await balances(env, did))[did], locked = debtLocked(cfg, bal);
    if (staff && locked) why.push(`🛑 Gate locked: driver owes ${Math.round(bal.balance)} ETB (limit ${cfg.debtLockEtb})`);
    if (cfg.alertsTg && why.length) bg(tg(env, `🚨 *ETEV ALERT* — ${v.plate} (${calc.driverName})\n📅 ${calc.shiftDate} · ${staff ? 'Approved by ' + actor : 'Driver submission'}\n${why.map(w => '• ' + w).join('\n')}`));
    if (why.length) bg(notify(env, cfg, 'shiftAlert', `🔔 ${v.plate} (${calc.driverName}) · ${calc.shiftDate}\n${why.map(w => '• ' + w).join('\n')}`));
    // Smart Fleet Alerts: serviceDue, debtLimit, lowBatteryRepeat
    {
      const vNow = { ...v, next_start_km: staff && !newerApproved ? calc.nextDayStartKm : v.next_start_km };
      const svc = serviceState(vNow, cfg);
      if (staff && svc) {
        bg(notify(env, cfg, 'serviceDue', `🔧 *የሰርቪስ ማስጠንቀቂያ (Service Due)* — ${v.plate} (${calc.driverName})\n• የአሁን ኪ.ሜ፦ *${Math.round(vNow.next_start_km)} KM* (ሰርቪስ በ${svc.dueAt} KM)\n• ${svc.overdue ? `🚨 ከሰርቪስ ኪ.ሜ በ*${Math.round(-svc.left)} KM* አልፏል (OVERDUE)` : `⚠️ ለሰርቪስ *${Math.round(svc.left)} KM* ብቻ ቀርቶታል`}`));
      }
      if (staff && locked && bal) {
        bg(notify(env, cfg, 'debtLimit', r => r.role === 'admin' || canRole(cfg, r.role, 'reports') || canRole(cfg, r.role, 'payments')
          ? `💸 *የሹፌር ዕዳ ከገደብ አለፈ (Debt Lock)* — ${calc.driverName} (${v.plate})\n• ጠቅላላ ዕዳ፦ *${Math.round(bal.balance).toLocaleString()} ብር* (ገደብ ${cfg.debtLockEtb} ብር)\n• 🛑 ክፍያ እስኪፈጸም የመኪናው Gate Pass ተቆልፏል።`
          : `🛑 *Gate Pass ተቆልፏል* — ${calc.driverName} (${v.plate}) የዕዳ ገደብ አልፏል።`));
      }
      if (calc.batterySoc < calc.lowBatteryPct) {
        bg((async () => {
          const from7 = addisDate(6);
          const lowCnt = num((await env.DB.prepare("SELECT COUNT(*) n FROM shifts WHERE plate=? AND shift_date>=? AND n_batt<? AND status IN ('APPROVED','PENDING')").bind(v.plate, from7, calc.lowBatteryPct).first())?.n);
          if (lowCnt >= 2) {
            await notify(env, cfg, 'lowBatteryRepeat', `🔋 *ተደጋጋሚ ዝቅተኛ ባትሪ (Repeated Low Battery)* — ${v.plate} (${calc.driverName})\n• ዛሬ የተመዘገበው፦ *${calc.batterySoc}%* (የምድብ ገደብ <${calc.lowBatteryPct}%)\n• ባለፉት 7 ቀናት ውስጥ *${lowCnt} ጊዜ* ከገደብ በታች ገብቷል። የቻርጅ ልምድ ወይም የባትሪ ጤና ይፈተሽ።`);
          }
        })());
      }
    }
    if (staff) bg(feedShift(env, id, calc, action === 'EDIT' ? `EDITED — ${editReason}` : 'APPROVED', actor));
    if (!staff) bg(notify(env, cfg, 'newPending', `📥 አዲስ ሪፖርት፦ ${v.plate} · ${calc.driverName} · ${calc.shiftDate} ${calc.mode === 'route' ? '🟢' : '🔵'}${calc.late ? (calc.late.queued ? ' · 🌙📤 ያለ ኢንተርኔት ተሞልቶ ዘግይቶ የተላከ' : ' · 🌙 ዘግይቶ የተላከ') : ''} — ⏳ ማጽደቅ ይጠብቃል`));
    else bg((async () => { // tell the driver: approved, money result, debt
      const isR = calc.mode === 'route', o = await appOrigin(env);
      const lines = [`✅ *ሪፖርትዎ ጸድቋል* — ${v.plate} · ${calc.shiftDate}${action === 'EDIT' ? ' (ተስተካክሏል)' : ''}`];
      if (isR) lines.push(`🔄 ${calc.roundTrips} ዙር${calc.passengers != null ? ` · 👥 ${calc.passengers} ተሳፋሪ` : ''}${calc.revenueGap > 0 ? `\n⚠️ የታሪፍ ጉድለት፦ ${calc.revenueGap} ብር` : ''}`);
      else lines.push(`🎯 ቦነስ፦ +${calc.totalCombinedBonus} ብር`, ...(calc.kmPenaltyEtb ? [`📏 የኪ.ሜ ቅጣት፦ -${calc.kmPenaltyEtb} ብር${calc.penaltyDebt ? ` (${calc.penaltyDebt} ብር ዕዳ ላይ ተጨምሯል)` : ''}`] : []));
      if (calc.shortfall) lines.push(`💵 የገንዘብ ጉድለት፦ ${calc.shortfall} ብር — ከቦነስ ${calc.bonusDeduction}፣ የሚከፍሉት ${calc.driverMustPay} ብር`);
      if (calc.overtimeMinutes) lines.push(`⏰ ትርፍ ሰዓት፦ ${fmtMin(calc.overtimeMinutes)}${calc.overtimePay ? ` (${calc.overtimePay} ብር)` : ''}`);
      lines.push(await debtLine(env, cfg, did));
      if (o) lines.push(`🔗 ${o}`);
      await notifyDriver(env, did, 'approved', lines.join('\n'));
    })());
    return J({ ok: true, id, nextStartKm: calc.nextDayStartKm, alerts: why, debt: Math.max(0, num(bal?.balance)), debtLocked: locked });
  }

  if (path === '/api/shifts' && m === 'GET') {
    const q = staff ? 'SELECT * FROM shifts ORDER BY shift_date DESC, shift_no DESC, id DESC LIMIT 200'
      : 'SELECT * FROM shifts WHERE driver_id=? ORDER BY shift_date DESC, shift_no DESC, id DESC LIMIT 60';
    const { results } = await (staff ? env.DB.prepare(q) : env.DB.prepare(q).bind(myDriver.id)).all();
    const ph = await photoMeta(env, results.map(r => r.id));
    return J(results.map(r => ({ ...rowOut(r), photos: ph[r.id] || [] })));
  }

  // Manager rejects a pending submission with a reason; the driver sees it and can resubmit
  // 🔍 one pending report for the approver: the numbers, the warnings, the report text, photos and the charging already entered
  const rvw = path.match(/^\/api\/shifts\/(\d+)\/review$/);
  if (rvw && m === 'GET') {
    if (!can('approve')) return deny();
    const row = await env.DB.prepare('SELECT * FROM shifts WHERE id=?').bind(+rvw[1]).first(); if (!row) return fail('Record not found', 404);
    const c = JSON.parse(row.calc), v = await env.DB.prepare('SELECT next_start_km FROM vehicles WHERE plate=?').bind(row.plate).first();
    const newer = await env.DB.prepare(`SELECT 1 x FROM shifts WHERE plate=? AND status='APPROVED' AND ${SHIFT_AFTER} AND id<>? LIMIT 1`).bind(row.plate, row.shift_date, row.shift_date, row.shift_no || 1, row.id).first();
    const photos = (await env.DB.prepare('SELECT kind FROM photos WHERE shift_id=?').bind(row.id).all()).results.map(x => x.kind);
    const chg = (await env.DB.prepare('SELECT kwh,cost,soc_from,soc_to,location FROM charging WHERE shift_id=?').bind(row.id).all()).results;
    return J({ ...rowOut(row), photos, alerts: alertReasons(c, cfg, row.status === 'PENDING' && !newer ? v?.next_start_km : null, false), report: report(c, row.status), rejFields: REJ_FIELDS,
      chargesSaved: chg.map(x => ({ kwh: x.kwh, cost: x.cost, socFrom: x.soc_from, socTo: x.soc_to, location: x.location })) });
  }
  const rej = path.match(/^\/api\/shifts\/(\d+)\/reject$/);
  if (rej && m === 'POST') {
    if (!can('approve')) return deny();
    const reason = String(body.reason || '').trim().slice(0, 200), rf = (Array.isArray(body.fields) ? body.fields : []).filter(k => REJ_FIELDS[k]).slice(0, 12);
    if (reason.length < 3) return fail('Write a reason for the driver');
    const row = await env.DB.prepare('SELECT * FROM shifts WHERE id=?').bind(+rej[1]).first();
    if (!row) return fail('Record not found', 404);
    if (row.status !== 'PENDING') return fail('Only pending submissions can be rejected');
    if (await isClosed(env, row.shift_date, JSON.parse(row.calc).mode)) return fail(closedMsg(row.shift_date, JSON.parse(row.calc).mode), 409);
    await env.DB.batch([
      env.DB.prepare("UPDATE shifts SET status='REJECTED',reject_reason=?,reject_fields=?,approved_by=?,updated_at=? WHERE id=?").bind(reason, rf.join(','), actor, now(), row.id),
      auditStmt(env, actor, 'REJECT', row.id, `${row.plate} ${row.shift_date}: ${reason}${rf.length ? ` [${rf.join(', ')}]` : ''}`),
    ]);
    if (cfg.autoPushTg) bg(tg(env, `❌ *SHIFT RETURNED TO DRIVER*\n🚐 ${row.plate} | 📅 ${row.shift_date}\n👔 ${actor}\n📝 ${reason}`));
    bg((async () => { const o = await appOrigin(env); await notifyDriver(env, row.driver_id, 'returned', `↩️ *ሪፖርትዎ ተመልሷል* — ${row.plate} · ${row.shift_date}\n📝 ምክንያት፦ ${reason}${rf.length ? `\n🔴 የሚስተካከሉ፦ ${rf.map(k => REJ_FIELDS[k]).join('፣ ')}` : ''}\n✏️ አስተካክለው እንደገና ይላኩ፤ ቀኑ ከመዘጋቱ በፊት።${o ? `\n🔗 ${o}` : ''}`); })());
    return J({ ok: true });
  }

  // Photo proof: odometer + Telebirr/cash receipt. Stored in R2 if the PHOTOS bucket is bound, otherwise in D1 (auto-deleted after photoKeepDays)
  if (photoPath) {
    const sid = +photoPath[1], kind = url.searchParams.get('kind');
    if (!PHOTO_KINDS[kind]) return fail('kind must be odo or cash');
    const row = await env.DB.prepare('SELECT id,plate,status,driver_id FROM shifts WHERE id=?').bind(sid).first();
    if (!row || (!staff && row.driver_id !== myDriver.id)) return fail('Record not found', 404);
    if (staff && !canAny('photos', 'approve')) return deny();
    const key = `shift/${sid}/${kind}`;
    if (m === 'PUT') {
      if (!staff && row.status === 'APPROVED') return fail('This shift is already approved');
      if (staff && !admin) return fail('Only the driver adds photos to a report');
      const mime = (req.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return fail('Photo must be JPEG, PNG or WebP');
      if (num(req.headers.get('content-length')) > MAX_PHOTO) return fail('Photo too large', 413);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return fail('Photo too large', 413);
      if (env.PHOTOS) await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: mime } });
      await env.DB.prepare('INSERT INTO photos(shift_id,kind,mime,size,data,in_r2,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(shift_id,kind) DO UPDATE SET mime=excluded.mime,size=excluded.size,data=excluded.data,in_r2=excluded.in_r2,created_at=excluded.created_at')
        .bind(sid, kind, mime, buf.byteLength, env.PHOTOS ? null : buf, env.PHOTOS ? 1 : 0, now()).run();
      await audit(env, actor, 'PHOTO', sid, `${row.plate} ${kind} ${Math.round(buf.byteLength / 1024)}KB`);
      return J({ ok: true });
    }
    if (m === 'GET') {
      const p = await env.DB.prepare('SELECT mime,data,in_r2 FROM photos WHERE shift_id=? AND kind=?').bind(sid, kind).first();
      if (!p) return fail('No photo', 404);
      let data = p.data;
      if (p.in_r2) { const o = env.PHOTOS && await env.PHOTOS.get(key); if (!o) return fail('No photo', 404); data = await o.arrayBuffer(); }
      return new Response(data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : new Uint8Array(data), { headers: { 'content-type': p.mime, 'cache-control': 'private, max-age=600' } });
    }
  }

  // Driver payments (settling "driver must pay" amounts)
  // A driver id from ?driver= / body.driverId, or (older pages) the main driver of ?plate= / body.plate
  const pickDriver = async (did, plate) => {
    if (did != null && did !== '') return (await env.DB.prepare('SELECT * FROM drivers WHERE id=?').bind(+did).first()) || null;
    if (plate) return (await env.DB.prepare('SELECT d.* FROM drivers d JOIN vehicles v ON v.driver_id=d.id WHERE v.plate=?').bind(String(plate).toUpperCase()).first()) || null;
    return null;
  };
  if (path === '/api/payments' && m === 'GET') {
    if (staff && !canAny('payments', 'reports')) return deny();
    const d = staff ? await pickDriver(url.searchParams.get('driver'), url.searchParams.get('plate')) : myDriver;
    if (staff && (url.searchParams.get('driver') || url.searchParams.get('plate')) && !d) return fail('Unknown driver');
    const rows = (await (d ? env.DB.prepare('SELECT * FROM payments WHERE driver_id=? ORDER BY pay_date DESC, id DESC LIMIT 200').bind(d.id) : env.DB.prepare('SELECT * FROM payments ORDER BY pay_date DESC, id DESC LIMIT 200')).all()).results;
    const bal = await balances(env, d ? d.id : null);
    return J({ payments: rows.map(r => ({ id: r.id, plate: r.plate, driverId: r.driver_id, date: r.pay_date, amount: r.amount, kind: r.kind || 'cash', ref: r.ref, note: r.note, by: r.by_actor })),
      balances: bal, balance: d ? bal[d.id] || ZERO_BAL : undefined });
  }
  if (path === '/api/payments' && m === 'POST') {
    if (!can('payments')) return deny();
    const d = await pickDriver(body.driverId, body.plate);
    if (!d) return fail('Unknown driver');
    const plate = String(body.plate || (await env.DB.prepare('SELECT plate FROM vehicles WHERE driver_id=? ORDER BY plate LIMIT 1').bind(d.id).first())?.plate || '').toUpperCase();
    const amount = num(body.amount), ref = String(body.ref || '').trim().slice(0, 60);
    const kind = body.kind === 'penalty' ? 'penalty' : 'cash';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : addisDate(0);
    if (!(amount > 0) || amount > 1e6) return fail('Amount must be more than 0');
    if (date > addisDate(0)) return fail('Date cannot be in the future');
    { const g = await plateGrp(env, plate); if (g && await isClosed(env, date, g)) return fail(closedMsg(date, g), 409); }
    if (ref) {
      const d1 = await env.DB.prepare('SELECT plate,pay_date FROM payments WHERE lower(ref)=lower(?) LIMIT 1').bind(ref).first();
      const d2 = await env.DB.prepare("SELECT plate,shift_date FROM shifts WHERE n_ref=lower(?) LIMIT 1").bind(ref).first();
      if (d1 || d2) return fail(`Reference already used (${(d1 || d2).plate})`);
    }
    const t = now();
    const res = await env.DB.batch([
      env.DB.prepare('INSERT INTO payments(plate,pay_date,amount,kind,ref,note,by_actor,created_at,driver_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(plate, date, amount, kind, ref, String(body.note || '').slice(0, 120), actor, t, d.id),
      auditStmt(env, actor, 'PAYMENT', null, `${d.name} (${plate}) ${date} ${amount} ETB ${kind} ${ref}`),
    ]);
    const bal = (await balances(env, d.id))[d.id] || ZERO_BAL;
    if (cfg.autoPushTg) bg(tg(env, `💵 *DRIVER PAYMENT RECEIVED*\n👤 ${d.name} · 🚐 ${plate} | 📅 ${date}\n• Paid: ${amount} ETB — ${kind === 'penalty' ? 'KM penalty' : 'cash shortfall'}${ref ? ` (Ref ${ref})` : ''}\n• Still owes: ${Math.max(0, bal.balance)} ETB${debtLocked(cfg, bal) ? ' 🛑 gate locked' : ''}\n👔 ${actor}`));
    bg((async () => notifyDriver(env, d.id, 'payment', `💵 *ክፍያዎ ተመዝግቧል*፦ ${amount} ብር — ${kind === 'penalty' ? 'የኪ.ሜ ቅጣት' : 'የገንዘብ ጉድለት'}${ref ? ` (Ref ${ref})` : ''} · ${date}\n${await debtLine(env, cfg, d.id)}`))());
    return J({ ok: true, id: res[0].meta.last_row_id, balance: bal });
  }
  const payDel = path.match(/^\/api\/payments\/(\d+)$/);
  if (payDel && m === 'DELETE') {
    if (!admin) return fail('Forbidden', 403);
    const p = await env.DB.prepare('SELECT * FROM payments WHERE id=?').bind(+payDel[1]).first();
    if (!p) return fail('Not found', 404);
    { const g = await plateGrp(env, p.plate); if (g && await isClosed(env, p.pay_date, g)) return fail(closedMsg(p.pay_date, g), 409); }
    await env.DB.batch([env.DB.prepare('DELETE FROM payments WHERE id=?').bind(p.id),
      auditStmt(env, actor, 'PAYMENT_DELETE', null, `${p.plate} ${p.pay_date} ${p.amount} ${p.kind || 'cash'}`)]);
    return J({ ok: true });
  }

  // EV charging log
  if (path === '/api/charging' && m === 'GET') {
    if (!staff && !me.plate) return J([]);
    const plate = staff ? String(url.searchParams.get('plate') || '').toUpperCase() : me.plate;
    const days = Math.min(365, Math.max(1, num(url.searchParams.get('days')) || 30));
    const from = addisDate(days - 1);
    const rows = (await (plate ? env.DB.prepare('SELECT * FROM charging WHERE plate=? AND chg_date>=? ORDER BY chg_date DESC, id DESC').bind(plate, from) : env.DB.prepare('SELECT * FROM charging WHERE chg_date>=? ORDER BY chg_date DESC, id DESC').bind(from)).all()).results;
    return J(rows.map(r => ({ id: r.id, plate: r.plate, date: r.chg_date, kwh: r.kwh, cost: r.cost, socFrom: r.soc_from, socTo: r.soc_to, odoKm: r.odo_km, location: r.location, by: r.by_actor })));
  }
  if (path === '/api/charging' && m === 'POST') {
    if (!can('charging')) return deny();
    const plate = String(body.plate || '').toUpperCase(), kwh = num(body.kwh), cost = num(body.cost);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : addisDate(0);
    if (!(await env.DB.prepare('SELECT 1 x FROM vehicles WHERE plate=?').bind(plate).first())) return fail('Unknown vehicle');
    if (!(kwh > 0) || kwh > 300) return fail('kWh must be between 0 and 300');
    if (cost < 0) return fail('Cost cannot be negative');
    if (date > addisDate(0)) return fail('Date cannot be in the future');
    { const g = await plateGrp(env, plate); if (g && await isClosed(env, date, g)) return fail(closedMsg(date, g), 409); }
    const soc = x => (String(x ?? '') === '' ? null : Math.min(100, Math.max(0, num(x))));
    const odo = String(body.odoKm ?? '') === '' ? null : num(body.odoKm);
    const res = await env.DB.prepare('INSERT INTO charging(plate,chg_date,kwh,cost,soc_from,soc_to,odo_km,location,by_actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(plate, date, kwh, cost, soc(body.socFrom), soc(body.socTo), odo, String(body.location || 'M8trix').slice(0, 60), actor, now()).run();
    await audit(env, actor, 'CHARGE', null, `${plate} ${date} ${kwh}kWh ${cost}ETB`);
    return J({ ok: true, id: res.meta.last_row_id });
  }
  const chgDel = path.match(/^\/api\/charging\/(\d+)$/);
  if (chgDel && m === 'DELETE') {
    if (!admin) return fail('Forbidden', 403);
    { const c = await env.DB.prepare('SELECT plate,chg_date FROM charging WHERE id=?').bind(+chgDel[1]).first(), g = c && await plateGrp(env, c.plate); if (g && await isClosed(env, c.chg_date, g)) return fail(closedMsg(c.chg_date, g), 409); }
    await env.DB.prepare('DELETE FROM charging WHERE id=?').bind(+chgDel[1]).run();
    await audit(env, actor, 'CHARGE_DELETE', null, String(chgDel[1]));
    return J({ ok: true });
  }

  // ---- v4.8 Telebirr, one payment at a time ----
  // Driver's phone records payments (from the SMS, pasted, or typed); the same transaction number counts once
  if (path === '/api/tele/log' && m === 'POST') {
    if (staff && !admin) return deny();
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200);
    if (!items.length) return fail('Nothing to record');
    const out = [], touched = [], t = now(); let added = 0, sum = 0;
    for (const it of items) {
      const txn = teleNo(it.txn), ts = teleTs(it.ts), amount = teleAmt(it.amount), src = ['sms', 'paste', 'hand'].includes(it.src) ? it.src : 'hand';
      if (!txn) { out.push({ txn: String(it.txn || '').slice(0, 20), ok: false, err: 'የግብይት ቁጥሩ ትክክል አይደለም (bad transaction number)' }); continue; }
      if (!ts || !(amount > 0) || amount > 100000) { out.push({ txn, ok: false, err: 'መጠን ወይም ሰዓት ትክክል አይደለም (bad amount or time)' }); continue; }
      const date = ts.slice(0, 10);
      if (date > addisDate(0) || date < addisDate(31)) { out.push({ txn, ok: false, err: 'ቀኑ ትክክል አይደለም (date out of range)' }); continue; }
      let plate, did;
      if (!staff) { did = myDriver.id; plate = await plateFor(env, did, date); if (!plate) { out.push({ txn, ok: false, err: 'በዚህ ቀን መኪና አልተመደበልዎትም (no vehicle that day)' }); continue; } }
      else { plate = String(body.plate || '').toUpperCase(); if (!(await env.DB.prepare('SELECT 1 x FROM vehicles WHERE plate=?').bind(plate).first())) return fail('Unknown vehicle'); did = await driverFor(env, plate, date); }
      { const g = await plateGrp(env, plate); if (g && await isClosed(env, date, g)) { out.push({ txn, ok: false, err: closedMsg(date, g) }); continue; } }
      const ex = await env.DB.prepare('SELECT * FROM tele_txn WHERE txn=?').bind(txn).first();
      if (ex && ex.plate && ex.plate !== plate) {
        await env.DB.batch([env.DB.prepare('UPDATE tele_txn SET dup=? WHERE txn=?').bind(`${plate} (${actor})`.slice(0, 80), txn), auditStmt(env, actor, 'TELE_DUP', null, `${txn} ${amount} ETB already recorded by ${ex.plate}`)]);
        out.push({ txn, ok: false, dup: true, err: `ይህ ቁጥር በ${ex.plate} ተመዝግቧል (already recorded by another vehicle)` }); continue;
      }
      if (ex && ex.plate === plate) { out.push({ txn, ok: true, again: true }); continue; } // same phone sent it twice: fine
      if (ex) await env.DB.prepare('UPDATE tele_txn SET amount=?,ts=?,plate=?,driver_id=?,src=?,logged_by=?,logged_at=? WHERE txn=?').bind(amount, ts, plate, did, src, actor, t, txn).run();
      else await env.DB.prepare('INSERT INTO tele_txn(txn,tdate,ts,amount,plate,driver_id,src,logged_by,logged_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(txn, date, ts, amount, plate, did, src, actor, t).run();
      if (ex && ex.st_amount != null) touched.push(plate + '|' + ex.st_ts.slice(0, 10));
      added++; sum += amount; out.push({ txn, ok: true, plate, date, matched: !!ex && ex.st_amount != null });
    }
    if (added) await audit(env, actor, 'TELE_LOG', null, `📱 ${added} Telebirr payment(s) ${r2(sum)} ETB`);
    if (touched.length) await teleSync(env, touched, actor);
    return J({ ok: true, results: out });
  }
  if (path === '/api/tele' && m === 'GET') {
    const d = /^\d{4}-\d{2}-\d{2}$/, date = url.searchParams.get('date'), from = url.searchParams.get('from') || date, to = url.searchParams.get('to') || date;
    if (!d.test(from || '') || !d.test(to || '') || dDiff(from, to) > 62) return fail('Pick a date range (up to 62 days)');
    if (!staff) {
      const plate = await plateFor(env, myDriver.id, from);
      if (!plate) return J({ rows: [], plate: null });
      const v = await teleView(env, from, from, plate);
      return J({ plate, rows: v.rows.filter(r => r.claimed).map(({ txn, ts, amount, src, status, dup }) => ({ txn, ts, amount, src, status, dup })) });
    }
    if (!canAny('platform', 'reports', 'closeDay')) return deny();
    const v = await teleView(env, from, to, url.searchParams.get('plate') || null);
    const by = {};
    for (const r of v.rows) { const k = r.plate || '—'; const b = by[k] ||= { plate: r.plate, logged: 0, statement: 0, ok: 0, diff: 0, missing: 0, waiting: 0, unclaimed: 0, dup: 0, resolved: 0, debt: 0 };
      if (r.amount != null) b.logged = r2(b.logged + r.amount); if (r.stAmount != null) b.statement = r2(b.statement + r.stAmount);
      if (r.res) { b.resolved++; if (r.res === 'debt') b.debt = r2(b.debt + num(r.resAmt)); if (r.status === 'ok' || r.status === 'waiting') b[r.status]++; }
      else { b[r.status]++; if (r.dup) b.dup++; } }
    const cfgN = cfg, needs = [];
    if (dDiff(from, to) <= 31) for (let d = from; d <= to; d = dAdd(d, 1)) { const n = await teleNeed(env, cfgN, d, null); if (n.needed && !n.covered) needs.push({ date: d, reasons: n.reasons }); }
    return J({ from, to, imports: v.imports, mode: cfg.teleStmtMode, needs, byPlate: Object.values(by).sort((a, b) => String(a.plate || '~').localeCompare(String(b.plate || '~'))), rows: v.rows });
  }
  const teleDel = path.match(/^\/api\/tele\/([A-Za-z0-9]{6,20})$/);
  if (teleDel && m === 'DELETE') {
    const r = await env.DB.prepare('SELECT * FROM tele_txn WHERE txn=?').bind(teleDel[1].toUpperCase()).first();
    if (!r || !r.plate || (!admin && (staff || r.driver_id !== myDriver.id))) return fail('Not found', 404);
    if (!admin && r.st_amount != null) return fail('የቴሌብር መግለጫው ያረጋገጠውን ማጥፋት አይቻልም (confirmed by the statement)');
    { const g = await plateGrp(env, r.plate); if (g && await isClosed(env, r.tdate, g)) return fail(closedMsg(r.tdate, g), 409); }
    if (!admin && await env.DB.prepare("SELECT 1 x FROM shifts WHERE plate=? AND shift_date=? AND status='APPROVED'").bind(r.plate, r.tdate).first()) return fail('This day is already approved');
    if (r.st_amount != null) await env.DB.prepare('UPDATE tele_txn SET amount=NULL,plate=NULL,driver_id=NULL,src=NULL,logged_by=NULL,logged_at=NULL,dup=NULL WHERE txn=?').bind(r.txn).run();
    else await env.DB.prepare('DELETE FROM tele_txn WHERE txn=?').bind(r.txn).run();
    await audit(env, actor, 'TELE_DELETE', null, `${r.txn} ${r.amount} ETB ${r.plate}`);
    if (r.st_amount != null) await teleSync(env, [r.plate + '|' + r.st_ts.slice(0, 10)], actor);
    return J({ ok: true });
  }
  // Finance: give a payment nobody recorded to the right vehicle
  if (path === '/api/tele/assign' && m === 'POST') {
    if (!can('platform')) return deny();
    const r = await env.DB.prepare('SELECT * FROM tele_txn WHERE txn=?').bind(teleNo(body.txn) || '').first(), plate = String(body.plate || '').toUpperCase(), note = String(body.note || '').trim().slice(0, 160);
    if (!r || r.st_amount == null) return fail('Payment not found in a statement', 404);
    if (r.plate) return fail(`Already recorded by ${r.plate}`);
    if (!(await env.DB.prepare('SELECT 1 x FROM vehicles WHERE plate=?').bind(plate).first())) return fail('Unknown vehicle');
    if (note.length < 3) return fail('Write how you know (ማስታወሻ)');
    const date = r.st_ts.slice(0, 10); { const g = await plateGrp(env, plate); if (g && await isClosed(env, date, g)) return fail(closedMsg(date, g), 409); }
    const t = now();
    await env.DB.batch([env.DB.prepare("UPDATE tele_txn SET plate=?,driver_id=?,amount=st_amount,src='fin',logged_by=?,logged_at=?,res='ok',res_note=?,res_by=?,res_at=? WHERE txn=?")
      .bind(plate, await driverFor(env, plate, date), actor, t, note, actor, t, r.txn), auditStmt(env, actor, 'TELE_ASSIGN', null, `${r.txn} ${r.st_amount} ETB → ${plate}: ${note}`)]);
    await teleSync(env, [plate + '|' + date], actor);
    return J({ ok: true });
  }
  // Finance closes a problem: explained (✔), or the money that never came goes on the driver's debt (💸); or opens it again
  if (path === '/api/tele/resolve' && m === 'POST') {
    if (!can('platform')) return deny();
    const r = await env.DB.prepare('SELECT * FROM tele_txn WHERE txn=?').bind(teleNo(body.txn) || '').first(), act = body.action, note = String(body.note || '').trim().slice(0, 160);
    if (!r || !r.plate) return fail('Payment not found', 404);
    const g = await plateGrp(env, r.plate); if (g && await isClosed(env, r.tdate, g)) return fail(closedMsg(r.tdate, g), 409);
    if (act === 'reopen') {
      await env.DB.batch([env.DB.prepare('UPDATE tele_txn SET res=NULL,res_amt=NULL,res_note=NULL,res_by=NULL,res_at=NULL WHERE txn=?').bind(r.txn), auditStmt(env, actor, 'TELE_RESOLVE', null, `${r.txn} ${r.plate}: reopened`)]);
      return J({ ok: true });
    }
    if (!['ok', 'debt'].includes(act)) return fail('Pick explained or debt');
    if (note.length < 3) return fail('Write a note (ማስታወሻ)');
    const gap = r.st_amount == null ? num(r.amount) : r2(num(r.amount) - num(r.st_amount));
    if (act === 'debt' && !(gap > 0)) return fail('Nothing missing to put on the debt');
    if (act === 'debt' && r.driver_id == null) return fail('No driver for this payment');
    await env.DB.batch([env.DB.prepare('UPDATE tele_txn SET res=?,res_amt=?,res_note=?,res_by=?,res_at=? WHERE txn=?').bind(act, act === 'debt' ? gap : null, note, actor, now(), r.txn),
      auditStmt(env, actor, 'TELE_RESOLVE', null, `${r.txn} ${r.plate} ${act === 'debt' ? `💸 ${gap} ETB to the driver's debt` : '✔ explained'}: ${note}`)]);
    if (act === 'debt') bg(notifyDriver(env, r.driver_id, 'teleDebt', `💸 *የቴሌብር ልዩነት* — ${r.plate} · ${r.tdate}\nየመዘገቡት ክፍያ ${r.txn} (${r.amount} ብር) በቴሌብር መግለጫው ውስጥ ${r.st_amount == null ? 'የለም' : `${r.st_amount} ብር ነው`}።\n${gap} ብር በዕዳዎ ላይ ተጨምሯል።\n📝 ${note}`));
    return J({ ok: true, debt: act === 'debt' ? gap : 0 });
  }
  // Finance loads the Telebirr merchant statement (the merchant's, or one operator's = one vehicle). Rows were read from the .xlsx by the page.
  if (path === '/api/tele/statement' && m === 'POST') {
    if (!can('platform')) return deny();
    const op = String(body.op || '').replace(/\D/g, '').slice(0, 20), rows = Array.isArray(body.rows) ? body.rows : [];
    if (!op) return fail('Which Telebirr number is this statement for? (merchant or operator)');
    if (rows.length > 20000) return fail('Too many rows');
    const ops = await teleOps(env), opPlate = ops.get(op) || null, t = now(), st = [], pairs = [];
    let ok = 0, bad = 0, minTs = null, maxTs = null;
    for (const r of rows) {
      const txn = teleNo(r.txn), ts = teleTs(r.ts), amount = teleAmt(r.amount);
      if (!txn || !ts || !Number.isFinite(amount)) { bad++; continue; }
      if (!(amount > 0)) { bad++; continue; } // only money received
      minTs = !minTs || ts < minTs ? ts : minTs; maxTs = !maxTs || ts > maxTs ? ts : maxTs;
      st.push(env.DB.prepare(`INSERT INTO tele_txn(txn,tdate,ts,st_amount,st_ts,st_type,st_op,st_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(txn) DO UPDATE SET st_amount=excluded.st_amount, st_ts=excluded.st_ts, st_type=excluded.st_type, st_at=excluded.st_at,
        st_op=CASE WHEN tele_txn.st_op IS NULL OR ?<>'' THEN excluded.st_op ELSE tele_txn.st_op END`)
        .bind(txn, ts.slice(0, 10), ts, amount, ts, String(r.type || '').slice(0, 40), op, t, opPlate ? 'y' : ''));
      ok++;
    }
    if (!ok) return fail(`No payments found in the file${bad ? ` (${bad} row(s) could not be read)` : ''}`);
    const from = teleTs(body.from) || minTs, to = teleTs(body.to) || maxTs;
    st.push(env.DB.prepare('INSERT INTO tele_import(op,from_ts,to_ts,rows,file,by_actor,created_at) VALUES(?,?,?,?,?,?,?)').bind(op, from, to, ok, String(body.file || '').slice(0, 120), actor, t));
    st.push(auditStmt(env, actor, 'TELE_STMT', null, `${opPlate ? opPlate + ' operator ' : 'merchant '}${op}: ${ok} payment(s) ${from.slice(0, 16)} → ${to.slice(0, 16)}`));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    // refresh the day totals of every vehicle these payments belong to
    const ds = [...new Set(rows.map(r => (teleTs(r.ts) || '').slice(0, 10)).filter(Boolean))];
    for (const d of ds) for (const p of (await env.DB.prepare('SELECT DISTINCT plate FROM tele_txn WHERE substr(st_ts,1,10)=? AND plate IS NOT NULL').bind(d).all()).results) pairs.push(p.plate + '|' + d);
    if (opPlate) for (const d of ds) pairs.push(opPlate + '|' + d);
    await teleSync(env, pairs, actor);
    const v = await teleView(env, from.slice(0, 10), to.slice(0, 10), null);
    const cnt = k => v.rows.filter(r => r.status === k).length;
    return J({ ok: true, op, plate: opPlate, rows: ok, bad, from, to, summary: { ok: cnt('ok'), diff: cnt('diff'), missing: cnt('missing'), unclaimed: cnt('unclaimed'), waiting: cnt('waiting') } });
  }

  // Cabby / Yango trip report import (rows already mapped to plate/date/trips/km/cash by the page)
  if (path === '/api/platform/import' && m === 'POST') {
    if (!can('platform')) return deny();
    const source = ['yango', 'cabby', 'telebirr'].includes(body.source) ? body.source : null;
    if (!source) return fail('Source must be cabby, yango or telebirr');
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length || rows.length > 20000) return fail('No rows to import');
    const match = plateMatcher((await env.DB.prepare('SELECT plate,tele_id FROM vehicles').all()).results);
    const agg = new Map(), unknown = new Set(); let badDate = 0;
    for (const r of rows) {
      const plate = match(r.plate), date = String(r.date || '');
      if (!plate) { if (r.plate) unknown.add(String(r.plate).slice(0, 30)); continue; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > addisDate(0)) { badDate++; continue; }
      const k = plate + '|' + date, o = agg.get(k) || agg.set(k, { plate, date, trips: 0, km: 0, cash: 0 }).get(k);
      o.trips += source === 'telebirr' ? 1 : Math.max(0, Math.round(num(r.trips))); o.km += source === 'telebirr' ? 0 : Math.max(0, num(r.km)); o.cash += Math.max(0, num(r.cash));
    }
    if (!agg.size) return fail(`Nothing matched your vehicles. ${unknown.size ? 'Unknown plates: ' + [...unknown].slice(0, 8).join(', ') : ''}${badDate ? ` · ${badDate} row(s) with a bad date` : ''}`);
    const t = now(), st = [];
    for (const o of agg.values()) st.push(env.DB.prepare('INSERT INTO platform_trips(source,plate,trip_date,trips,km,cash,imported_by,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,plate,trip_date) DO UPDATE SET trips=excluded.trips,km=excluded.km,cash=excluded.cash,imported_by=excluded.imported_by,created_at=excluded.created_at')
      .bind(source, o.plate, o.date, o.trips, r1(o.km), r1(o.cash), actor, t));
    const dates = [...agg.values()].map(o => o.date).sort();
    st.push(auditStmt(env, actor, 'PLATFORM_IMPORT', null, `${source} ${agg.size} day-rows ${dates[0]}..${dates[dates.length - 1]}`));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    const rec = await reconcile(env, cfg, dates[0], dates[dates.length - 1]);
    if (cfg.alertsTg && rec.mismatched) bg(tg(env, `🔍 *${source.toUpperCase()} REPORT CHECK* (${dates[0]} → ${dates[dates.length - 1]})\n• Checked: ${rec.checked} vehicle-days\n• ⚠️ Mismatches: ${rec.mismatched}\n• Cash not declared: ${rec.cashGap} ETB\n• Bonus above platform: ${rec.bonusGap} ETB\n👔 ${actor}`));
    return J({ ok: true, imported: agg.size, unknownPlates: [...unknown].slice(0, 20), badDates: badDate, from: dates[0], to: dates[dates.length - 1], summary: { checked: rec.checked, mismatched: rec.mismatched, cashGap: rec.cashGap, bonusGap: rec.bonusGap } });
  }
  if (path === '/api/platform/reconcile' && m === 'GET') {
    if (!can('platform')) return deny();
    const days = [7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 30;
    return J(await reconcile(env, cfg, addisDate(days - 1), addisDate(0)));
  }
  if (path === '/api/ranking' && m === 'GET') {
    if (!canAny('opsDash', 'reports')) return deny();
    const days = [7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 30;
    return J(await ranking(env, cfg, days));
  }
  if (path === '/api/energy' && m === 'GET') {
    if (!canAny('opsDash', 'reports')) return deny();
    const days = [30, 90, 180].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 90;
    return J(await energy(env, days));
  }

  // Maintenance: mark a vehicle as serviced
  const svc = path.match(/^\/api\/vehicles\/([^/]+)\/serviced$/);
  if (svc && m === 'POST') {
    if (!can('service')) return deny();
    const plate = decodeURIComponent(svc[1]).toUpperCase();
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    if (!v) return fail('Unknown vehicle');
    const km = String(body.km ?? '') === '' ? v.next_start_km : num(body.km);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : addisDate(0);
    const every = num(body.everyKm) > 0 ? num(body.everyKm) : (v.service_every_km || 10000);
    await env.DB.prepare('UPDATE vehicles SET last_service_km=?, last_service_date=?, service_every_km=? WHERE plate=?').bind(km, date, every, plate).run();
    await audit(env, actor, 'SERVICED', null, `${plate} at ${km} KM ${date} ${String(body.note || '').slice(0, 80)}`);
    return J({ ok: true });
  }

  // ---- Finance dashboard + payroll (money reports permission) ----
  if (path === '/api/finance' && m === 'GET') {
    if (!can('reports')) return deny();
    const today = addisDate(0);
    let from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!isDay(to) || to > today) to = today;
    if (!isDay(from)) from = to.slice(0, 7) + '-01';
    if (from > to) return fail('"From" must be before "to"');
    if (dDiff(from, to) > 400) return fail('Pick at most 400 days');
    const n = dDiff(from, to) + 1, pFrom = dAdd(from, -n), pTo = dAdd(from, -1);
    const group = ['cabby', 'route'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : '';
    const [cur, prev] = await Promise.all([moneyFlow(env, cfg, from, to, group), moneyFlow(env, cfg, pFrom, pTo, group)]);
    const step = n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
    const key = d => step === 'day' ? d : step === 'week' ? weekStart(d) : d.slice(0, 7);
    const B = {};
    for (const d of cur.days) { const o = B[key(d.date)] ||= { bucket: key(d.date), in: 0, out: 0, net: 0, pax: 0, km: 0, ...Object.fromEntries(MONEY_KEYS.map(k => [k, 0])) }; for (const k in o) if (k !== 'bucket') o[k] += num(d[k]); }
    const series = Object.values(B).map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])));
    const kpi = t => ({ in: t.in, out: t.out, net: t.net, pax: t.pax, km: t.km, shifts: t.shifts, kwh: r2(t.kwh), ...Object.fromEntries(MONEY_KEYS.map(k => [k, t[k]])),
      perKm: t.km ? r2(t.in / t.km) : null, netPerKm: t.km ? r2(t.net / t.km) : null });
    const plates = (await env.DB.prepare('SELECT plate,driver,mode FROM vehicles ORDER BY plate').all()).results.filter(v => !group || v.mode === group || cur.vehicles.some(x => x.plate === v.plate && (x.in || x.out)));
    const vehicles = plates.map(v => ({ plate: v.plate, driver: v.driver, ...(cur.vehicles.find(x => x.plate === v.plate) || { in: 0, out: 0, net: 0, km: 0, pax: 0 }) }))
      .concat(cur.vehicles.filter(x => !plates.some(v => v.plate === x.plate) && (x.in || x.out)).map(x => ({ ...x, plate: x.plate || '', driver: x.plate ? '(removed)' : 'Company-wide' })))
      .map(v => ({ ...v, perKm: v.km ? r2(v.in / v.km) : null }));
    let aging = await debtAging(env);
    if (group) { // debts of drivers whose main vehicle is in this group
      const dm = Object.fromEntries((await env.DB.prepare('SELECT driver_id,mode FROM vehicles WHERE driver_id IS NOT NULL').all()).results.map(v => [v.driver_id, v.mode]));
      const list = aging.list.filter(a => dm[a.driverId] === group), T = k => r2(list.reduce((t, x) => t + x[k], 0));
      aging = { list, total: { d0_7: T('d0_7'), d8_30: T('d8_30'), d31: T('d31'), total: T('total') } };
    }
    return J({ from, to, prevFrom: pFrom, prevTo: pTo, group: step, mode: group || 'all', kpi: kpi(cur.total), prev: kpi(prev.total), series, sources: cur.sources, cats: cur.cats, vehicles,
      aging, salaryVisible: can('salary') });
  }
  if (path === '/api/payroll' && m === 'GET') {
    if (!can('reports')) return deny();
    const q = url.searchParams.get('month') || '', mo = /^\d{4}-\d{2}$/.test(q) ? q : addisDate(0).slice(0, 7);
    const pmode = ['cabby', 'route'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : '';
    const pr = await payroll(env, cfg, mo, pmode);
    if (!can('salary')) pr.rows.forEach(r => { delete r.salary; delete r.net; delete r.afterDebt; }), delete pr.total.salary, delete pr.total.net, delete pr.total.afterDebt;
    if (url.searchParams.get('format') === 'csv') {
      const cols = [['driver', 'Driver'], ['plate', 'Vehicle'], ['shifts', 'Shifts'], ['salaryDays', 'SalaryDays'], ['salary', 'Salary'], ['bonus', 'Bonus'], ['fromBonusCash', 'CashShortfallFromBonus'], ['fromBonusPenalty', 'KMPenaltyFromBonus'], ['bonusPay', 'BonusPayable'],
        ['workHours', 'WorkHours'], ['otHours', 'OvertimeHours'], ['otPay', 'OvertimePay'], ['net', 'NetPay'], ['debt', 'OutstandingDebt'], ['afterDebt', 'NetAfterDebt'], ['passengers', 'Passengers'], ['km', 'KM']].filter(([k]) => k in (pr.rows[0] || pr.total) || !['salary', 'net', 'afterDebt'].includes(k));
      await audit(env, actor, 'EXPORT_PAYROLL', null, mo + (pmode ? ' ' + pmode : ''));
      return new Response(['Month,' + cols.map(c => c[1]).join(','), ...pr.rows.map(r => [mo, ...cols.map(([k]) => r[k] ?? '')].map(csvCell).join(','))].join('\n'), { headers: { 'content-type': 'text/csv', 'cache-control': 'no-store' } });
    }
    return J({ ...pr, salaryVisible: can('salary') });
  }

  // ---- Expenses (Finance: all categories; Fleet Admin: repair-type categories) ----
  const catOk = c => { const k = (cfg.expenseCats || DEF.expenseCats).find(x => x.id === c); return k && (can('expenses') || (can('repairs') && k.fleet)); };
  if (path === '/api/expenses' && m === 'GET') {
    if (!canAny('expenses', 'repairs', 'reports')) return deny();
    let from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!isDay(to)) to = addisDate(0); if (!isDay(from)) from = dAdd(to, -89);
    if (from > to) return fail('"From" must be before "to"');
    const plateQ = String(url.searchParams.get('plate') || '').trim().toUpperCase();
    const rows = (await env.DB.prepare('SELECT id,plate,exp_date,category,amount,months,ref,note,photo_mime,by_actor,created_at FROM expenses WHERE exp_date>=? AND exp_date<=? ORDER BY exp_date DESC, id DESC LIMIT 500').bind(from, to).all()).results;
    const allOutRows = rows.map(r => ({ id: r.id, plate: r.plate, date: r.exp_date, category: r.category, amount: r.amount, months: r.months, ref: r.ref, note: r.note, hasPhoto: !!r.photo_mime, by: r.by_actor }));
    const outRows = plateQ ? allOutRows.filter(r => String(r.plate || 'Company').toUpperCase().includes(plateQ)) : allOutRows;
    return J({ from, to, total: r2(outRows.reduce((s, r) => s + num(r.amount), 0)), cats: cfg.expenseCats || DEF.expenseCats, rows: outRows });
  }
  if (path === '/api/expenses' && m === 'POST') {
    if (!canAny('expenses', 'repairs')) return deny();
    const cat = String(body.category || ''), amount = num(body.amount), months = Math.floor(num(body.months) || 1), plate = String(body.plate || '').toUpperCase();
    const date = isDay(body.date) ? body.date : addisDate(0), ref = String(body.ref || '').trim().slice(0, 60);
    if (!catOk(cat)) return fail(can('repairs') && !can('expenses') ? 'You can record repair-type expenses only' : 'Pick an expense category');
    if (!(amount > 0) || amount > 1e8) return fail('Amount must be more than 0');
    if (months < 1 || months > 36) return fail('Spread over 1 to 36 months');
    if (date > addisDate(0)) return fail('Date cannot be in the future');
    if (plate && !(await env.DB.prepare('SELECT 1 x FROM vehicles WHERE plate=?').bind(plate).first())) return fail('Unknown vehicle');
    if (!plate && !can('expenses')) return fail('Pick the vehicle');
    if (plate ? await isClosed(env, date, await plateGrp(env, plate)) : (await isClosed(env, date, 'cabby') && await isClosed(env, date, 'route'))) return fail(closedMsg(date, plate ? await plateGrp(env, plate) : 'cabby'), 409);
    if (ref && await env.DB.prepare('SELECT 1 x FROM expenses WHERE lower(ref)=lower(?)').bind(ref).first()) return fail('That receipt number is already recorded');
    const res = await env.DB.prepare('INSERT INTO expenses(plate,exp_date,category,amount,months,ref,note,by_actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(plate, date, cat, amount, months, ref, String(body.note || '').slice(0, 160), actor, now()).run();
    await audit(env, actor, 'EXPENSE', null, `${plate || 'company'} ${date} ${cat} ${amount} ETB${months > 1 ? ` over ${months} months` : ''} ${ref}`);
    if (cfg.alertsTg && amount >= 10000) bg(tg(env, `🧾 *EXPENSE RECORDED*\n${plate ? '🚐 ' + plate : '🏢 Company'} | 📅 ${date}\n• ${cat}: ${amount} ETB${months > 1 ? ` (spread over ${months} months)` : ''}\n👔 ${actor}`));
    return J({ ok: true, id: res.meta.last_row_id });
  }
  const expPh = path.match(/^\/api\/expenses\/(\d+)\/photo$/);
  if (expPh) {
    const e = await env.DB.prepare('SELECT id,category,by_actor,photo_mime FROM expenses WHERE id=?').bind(+expPh[1]).first();
    if (!e) return fail('Not found', 404);
    if (m === 'PUT') {
      if (!catOk(e.category)) return deny();
      const mime = (req.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return fail('Photo must be JPEG, PNG or WebP');
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return fail('Photo too large', 413);
      await env.DB.prepare('UPDATE expenses SET photo=?, photo_mime=? WHERE id=?').bind(buf, mime, e.id).run();
      return J({ ok: true });
    }
    if (m === 'GET') {
      if (!canAny('expenses', 'repairs', 'reports')) return deny();
      const p = await env.DB.prepare('SELECT photo,photo_mime FROM expenses WHERE id=?').bind(e.id).first();
      if (!p?.photo_mime) return fail('No photo', 404);
      return new Response(p.photo instanceof ArrayBuffer || ArrayBuffer.isView(p.photo) ? p.photo : new Uint8Array(p.photo), { headers: { 'content-type': p.photo_mime, 'cache-control': 'private, max-age=600' } });
    }
  }
  const expDel = path.match(/^\/api\/expenses\/(\d+)$/);
  if (expDel && m === 'DELETE') {
    if (!admin) return fail('Only the Super Admin can delete an expense', 403);
    const e = await env.DB.prepare('SELECT * FROM expenses WHERE id=?').bind(+expDel[1]).first();
    if (!e) return fail('Not found', 404);
    if (e.plate ? await isClosed(env, e.exp_date, await plateGrp(env, e.plate)) : (await isClosed(env, e.exp_date, 'cabby') && await isClosed(env, e.exp_date, 'route'))) return fail(closedMsg(e.exp_date, e.plate ? await plateGrp(env, e.plate) : 'cabby'), 409);
    await env.DB.batch([env.DB.prepare('DELETE FROM expenses WHERE id=?').bind(e.id), auditStmt(env, actor, 'EXPENSE_DELETE', null, `${e.plate || 'company'} ${e.exp_date} ${e.category} ${e.amount}`)]);
    return J({ ok: true });
  }

  // ---- Fleet: drivers, vehicles, day assignments, next start KM (Fleet Admin + Super Admin, by permission) ----
  if (path === '/api/fleet' && m === 'GET') {
    if (!canAny('vehicles', 'assign', 'driverPin', 'salary', 'payments', 'startKm', 'service', 'charging', 'reports')) return deny();
    const drivers = (await env.DB.prepare('SELECT * FROM drivers ORDER BY active DESC, name').all()).results.map(d => driverOut(d, can('salary')));
    const vehicles = (await env.DB.prepare('SELECT * FROM vehicles ORDER BY plate').all()).results.map(vehOut);
    const assignments = (await env.DB.prepare('SELECT a.plate,a.adate,a.driver_id,a.by_actor,d.name FROM assignments a LEFT JOIN drivers d ON d.id=a.driver_id WHERE a.adate>=? ORDER BY a.adate,a.plate').bind(addisDate(2)).all()).results
      .map(a => ({ plate: a.plate, date: a.adate, driverId: a.driver_id, driver: a.name || '', by: a.by_actor }));
    return J({ drivers, vehicles, assignments, today: addisDate(0) });
  }
  if (path === '/api/fleet/drivers' && m === 'PUT') {
    if (!canAny('vehicles', 'driverPin')) return deny();
    const list = Array.isArray(body) ? body.slice(0, 500) : [];
    if (!list.length) return fail('Nothing to save');
    const phones = new Set();
    for (const d of list) { // validate everything first
      const onlyPin = !can('vehicles');
      if (onlyPin && (!d.id || Object.keys(d).some(k => !['id', 'pin'].includes(k)))) return deny();
      if (d.pin && !can('driverPin')) return fail('You cannot change driver PINs');
      if (d.pin && !pin4(d.pin)) return fail('Driver PIN must be 4 digits');
      if (d.id && !(await env.DB.prepare('SELECT id FROM drivers WHERE id=?').bind(+d.id).first())) return fail('Driver not found', 404);
      if (onlyPin) continue;
      if (!String(d.name || '').trim()) return fail('Each driver needs a name');
      if (!d.id && !d.pin) return fail(`New driver ${d.name} needs a 4-digit PIN`);
      const ph = normPhone(d.phone);
      if (String(d.phone || '').trim() && !ph) return fail(`Phone number for ${d.name} is not valid`);
      if (ph) {
        if (phones.has(ph)) return fail(`Phone ${d.phone} is listed twice`);
        phones.add(ph);
        if (await env.DB.prepare('SELECT 1 x FROM drivers WHERE phone=? AND id IS NOT ?').bind(ph, d.id ? +d.id : null).first()) return fail(`Phone ${d.phone} already belongs to another driver`);
      }
    }
    const done = [];
    for (const d of list) {
      if (!can('vehicles')) {
        await env.DB.prepare('UPDATE drivers SET pin_hash=?, pin_ver=pin_ver+1 WHERE id=?').bind(await hashPin(d.pin), +d.id).run();
        done.push(`#${d.id}[PIN]`); continue;
      }
      const name = String(d.name).trim().slice(0, 60), ph = normPhone(d.phone), active = d.active === false ? 0 : 1;
      const salary = admin && 'salary' in d ? Math.max(0, num(d.salary)) : null;
      if (d.id) {
        await env.DB.prepare('UPDATE drivers SET name=?, phone=?, pin_ver=CASE WHEN active<>? THEN pin_ver+1 ELSE pin_ver END, active=? WHERE id=?').bind(name, ph, active, active, +d.id).run();
        if (d.pin) await env.DB.prepare('UPDATE drivers SET pin_hash=?, pin_ver=pin_ver+1 WHERE id=?').bind(await hashPin(d.pin), +d.id).run();
        if (salary != null) await env.DB.prepare('UPDATE drivers SET salary=? WHERE id=?').bind(salary, +d.id).run();
        if (!active) await env.DB.prepare('DELETE FROM tg_links WHERE who=?').bind('d:' + (+d.id)).run();
      } else {
        await env.DB.prepare('INSERT INTO drivers(name,phone,pin_hash,active,salary,created_at) VALUES(?,?,?,?,?,?)').bind(name, ph, await hashPin(d.pin), active, salary ?? 0, now()).run();
      }
      done.push(`${name}${active ? '' : ' (off)'}${d.pin ? ' [PIN]' : ''}${salary != null ? ' [salary]' : ''}`);
    }
    await syncVehicleDrivers(env);
    await audit(env, actor, 'DRIVERS_UPDATE', null, done.join(', ').slice(0, 900));
    return J({ ok: true });
  }
  if (path === '/api/fleet/vehicles' && m === 'PUT') {
    if (!can('vehicles')) return deny();
    const list = Array.isArray(body) ? body.slice(0, 300) : [];
    if (!list.length) return fail('Nothing to save');
    const seen = new Set();
    for (const v of list) {
      const plate = String(v.plate || '').toUpperCase().trim();
      if (!plate) return fail('Plate required');
      if (seen.has(plate)) return fail(`Plate ${plate} is listed twice`);
      seen.add(plate); v._plate = plate;
      if (v.mode && !MODES.includes(v.mode)) return fail('Vehicle mode must be any, cabby or route');
      if (v.driverId != null && v.driverId !== '' && !(await env.DB.prepare('SELECT 1 x FROM drivers WHERE id=? AND active=1').bind(+v.driverId).first())) return fail(`Driver for ${plate} not found or switched off`);
      const tid = String(v.teleId || '').replace(/[^\d]/g, '');
      if (tid && (list.some(o => o !== v && String(o.teleId || '').replace(/[^\d]/g, '') === tid) || await env.DB.prepare('SELECT 1 x FROM vehicles WHERE tele_id=? AND plate<>?').bind(tid, plate).first())) return fail(`Telebirr number ${tid} is used by two vehicles`);
      v._ex = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    }
    for (const v of list) {
      const did = v.driverId != null && v.driverId !== '' ? +v.driverId : null, tid = String(v.teleId || '').replace(/[^\d]/g, '').slice(0, 20);
      if (v._ex) {
        await env.DB.prepare('UPDATE vehicles SET mode=?, tele_id=?, driver_id=?, seats=?, service_every_km=?, last_service_km=?, last_service_date=? WHERE plate=?')
          .bind(v.mode || v._ex.mode || 'any', 'teleId' in v ? tid : v._ex.tele_id, 'driverId' in v ? did : v._ex.driver_id, 'seats' in v ? Math.min(60, Math.max(1, Math.floor(num(v.seats)) || 4)) : (v._ex.seats ?? 4),
            'serviceEveryKm' in v ? Math.max(0, num(v.serviceEveryKm)) : v._ex.service_every_km, 'lastServiceKm' in v ? Math.max(0, num(v.lastServiceKm)) : v._ex.last_service_km,
            /^\d{4}-\d{2}-\d{2}$/.test(v.lastServiceDate || '') ? v.lastServiceDate : v._ex.last_service_date, v._plate).run();
      } else {
        await env.DB.prepare("INSERT INTO vehicles(plate,driver,phone,pin_hash,next_start_km,mode,pin_ver,service_every_km,last_service_km,tele_id,driver_id,seats) VALUES(?,'','','-',?,?,1,?,?,?,?,?)")
          .bind(v._plate, Math.max(0, num(v.nextStartKm)), v.mode || 'any', Math.max(0, num(v.serviceEveryKm)), Math.max(0, num(v.lastServiceKm)), tid, did, Math.min(60, Math.max(1, Math.floor(num(v.seats)) || 4))).run();
      }
    }
    await syncVehicleDrivers(env);
    await audit(env, actor, 'VEHICLES_UPDATE', null, list.map(v => `${v._plate}${v._ex ? '' : ' (new)'}:${v.mode || 'any'}${v.driverId ? ' driver#' + v.driverId : ''}`).join(', ').slice(0, 900));
    return J({ ok: true });
  }
  if (path === '/api/fleet/assign' && m === 'POST') {
    if (!can('assign')) return deny();
    const plate = String(body.plate || '').toUpperCase(), date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < addisDate(2) || date > addisDate(-14)) return fail('Pick a date from 2 days ago up to 2 weeks ahead');
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    if (!v) return fail('Unknown vehicle');
    if (await isClosed(env, date, v.mode)) return fail(closedMsg(date, v.mode), 409);
    const prevA = await env.DB.prepare('SELECT driver_id FROM assignments WHERE plate=? AND adate=?').bind(plate, date).first();
    const before = prevA ? prevA.driver_id : v.driver_id; // who had the vehicle that day before this change
    const tell = (did, text) => { if (did != null && date >= addisDate(0)) bg(notifyDriver(env, did, 'assign', text)); };
    if (body.driverId == null || body.driverId === '') {
      await env.DB.prepare('DELETE FROM assignments WHERE plate=? AND adate=?').bind(plate, date).run();
      await audit(env, actor, 'ASSIGN', null, `${plate} ${date} back to main driver`);
      if (before !== v.driver_id) { tell(v.driver_id, `🚐 ${date}፦ *${plate}* ተመልሶ ተመድቦልዎታል።`); tell(before, `🔁 ${date}፦ ${plate} ለዋናው ሹፌር ተመልሷል፤ እርስዎ አልተመደቡም።`); }
      return J({ ok: true });
    }
    if ((v.status || 'ok') !== 'ok' && date >= addisDate(0)) return fail(`⏸ ${plate} is off the road (${v.status === 'repair' ? `ጥገና ላይ ነው${v.repair_until ? ' እስከ ' + v.repair_until : ''}` : 'በምርመራ ላይ ነው'}). Put it back in service first. (መኪናው ከስራ ውጭ ነው)`, 409);
    const d = await env.DB.prepare('SELECT * FROM drivers WHERE id=? AND active=1').bind(+body.driverId).first();
    if (!d) return fail('Driver not found or switched off');
    const other = await env.DB.prepare('SELECT plate FROM assignments WHERE driver_id=? AND adate=? AND plate<>?').bind(d.id, date, plate).first();
    if (other) return fail(`${d.name} is already assigned to ${other.plate} on ${date}`);
    await env.DB.prepare('INSERT INTO assignments(plate,adate,driver_id,by_actor,created_at) VALUES(?,?,?,?,?) ON CONFLICT(plate,adate) DO UPDATE SET driver_id=excluded.driver_id,by_actor=excluded.by_actor,created_at=excluded.created_at')
      .bind(plate, date, d.id, actor, now()).run();
    await audit(env, actor, 'ASSIGN', null, `${plate} ${date} → ${d.name}`);
    if (cfg.autoPushTg) bg(tg(env, `🔁 *DRIVER ASSIGNED*\n🚐 ${plate} | 📅 ${date}\n👤 ${d.name}\n👔 ${actor}`));
    if (before !== d.id) { tell(d.id, `🚐 ${date}፦ *${plate}* ተመድቦልዎታል።`); tell(before, `🔁 ${date}፦ ${plate} ለ${d.name} ተሰጥቷል፤ እርስዎ አልተመደቡም።`); }
    return J({ ok: true });
  }
  const skm = path.match(/^\/api\/vehicles\/([^/]+)\/startkm$/);
  if (skm && m === 'POST') {
    if (!can('startKm')) return deny();
    const plate = decodeURIComponent(skm[1]).toUpperCase();
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    if (!v) return fail('Unknown vehicle');
    const km = num(body.km), reason = String(body.reason || '').trim().slice(0, 160);
    if (!(km > 0) || String(body.km ?? '').trim() === '') return fail('Enter the odometer KM');
    if (reason.length < 3) return fail('Write the reason (ምክንያት ይጻፉ)');
    if (Math.abs(km - v.next_start_km) > MAX_SHIFT_KM) return fail(`That is more than ${MAX_SHIFT_KM} KM away from ${v.next_start_km}. Check the number.`);
    await env.DB.batch([env.DB.prepare('UPDATE vehicles SET next_start_km=? WHERE plate=?').bind(km, plate),
      auditStmt(env, actor, 'START_KM', null, `${plate} ${v.next_start_km} → ${km}: ${reason}`)]);
    if (cfg.alertsTg) bg(tg(env, `🔢 *NEXT START KM CHANGED*\n🚐 ${plate}: ${v.next_start_km} → ${km} (${km >= v.next_start_km ? '+' : ''}${r1(km - v.next_start_km)} KM)\n📝 ${reason}\n👔 ${actor}`));
    return J({ ok: true, nextStartKm: km });
  }
  // Manager performance: approvals, returns and how long reports waited
  if (path === '/api/staffstats' && m === 'GET') {
    if (!can('mgrStats')) return deny();
    const days = [7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 30;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const users = (await env.DB.prepare('SELECT id,name,role,active FROM managers ORDER BY name').all()).results;
    const appr = (await env.DB.prepare("SELECT a.actor approved_by, s.created_at, a.ts updated_at FROM audit a JOIN shifts s ON s.id=a.shift_id WHERE a.action='APPROVE' AND a.ts>=? AND s.submitted_by LIKE 'Driver%'").bind(since).all()).results;
    const rejs = (await env.DB.prepare("SELECT actor,COUNT(*) n FROM audit WHERE action='REJECT' AND ts>=? GROUP BY actor").bind(since).all()).results;
    const pend = (await env.DB.prepare("SELECT MIN(created_at) oldest, COUNT(*) n FROM shifts WHERE status='PENDING'").first()) || {};
    const list = [...users.map(u => ({ name: u.name, role: u.role || 'manager', active: !!u.active })), { name: cfg.adminName, role: 'admin', active: true }].map(u => {
      const a = appr.filter(x => x.approved_by === u.name), hrs = a.map(x => (Date.parse(x.updated_at) - Date.parse(x.created_at)) / 36e5).filter(h => h >= 0);
      return { ...u, approved: a.length, returned: num(rejs.find(x => x.actor === u.name)?.n), avgHours: hrs.length ? r1(hrs.reduce((t, h) => t + h, 0) / hrs.length) : null };
    }).filter(u => u.approved || u.returned || u.role === 'manager');
    return J({ days, list, pending: num(pend.n), oldestPendingHours: pend.oldest ? r1((Date.now() - Date.parse(pend.oldest)) / 36e5) : null });
  }
  const del = path.match(/^\/api\/shifts\/(\d+)$/);
  if (del && m === 'DELETE') {
    if (!admin) return fail('Forbidden', 403);
    const row = await env.DB.prepare('SELECT * FROM shifts WHERE id=?').bind(+del[1]).first();
    if (!row) return fail('Record not found', 404);
    if (await isClosed(env, row.shift_date, JSON.parse(row.calc).mode)) return fail(closedMsg(row.shift_date, JSON.parse(row.calc).mode), 409);
    const stmts = [env.DB.prepare('DELETE FROM shifts WHERE id=?').bind(row.id), env.DB.prepare('DELETE FROM photos WHERE shift_id=?').bind(row.id),
      auditStmt(env, actor, 'DELETE', row.id, `${row.plate} ${row.shift_date} ${row.status}`)];
    // Keep the odometer chain right: if this was the newest approved shift, roll Next Start KM back
    if (row.status === 'APPROVED') {
      const c = JSON.parse(row.calc);
      const newer = await env.DB.prepare("SELECT 1 x FROM shifts WHERE plate=? AND status='APPROVED' AND (shift_date>? OR (shift_date=? AND (shift_no>? OR (shift_no=? AND id>?)))) LIMIT 1").bind(row.plate, row.shift_date, row.shift_date, row.shift_no || 1, row.shift_no || 1, row.id).first();
      if (!newer) {
        const prev = await env.DB.prepare("SELECT calc FROM shifts WHERE plate=? AND status='APPROVED' AND id<>? ORDER BY shift_date DESC, shift_no DESC, id DESC LIMIT 1").bind(row.plate, row.id).first();
        const back = prev ? num(JSON.parse(prev.calc).nextDayStartKm) : num(c.startKm);
        stmts.push(env.DB.prepare('UPDATE vehicles SET next_start_km=? WHERE plate=?').bind(back, row.plate));
      }
    }
    await env.DB.batch(stmts);
    if (env.PHOTOS) bg(Promise.all(Object.keys(PHOTO_KINDS).map(k => env.PHOTOS.delete(`shift/${row.id}/${k}`))));
    return J({ ok: true });
  }
  if (path === '/api/export.csv' && m === 'GET') {
    if (!can('reports')) return deny();
    const fr = url.searchParams.get('from') || '0000-00-00', to = url.searchParams.get('to') || '9999-99-99';
    const { results } = await env.DB.prepare('SELECT * FROM shifts WHERE shift_date>=? AND shift_date<=? ORDER BY shift_date DESC, id DESC').bind(fr, to).all();
    const H = ['Date', 'Status', 'VerifiedBy', 'Hash', 'Plate', 'Driver', 'StartKM', 'EndKM', 'ChargingKM', 'NextStartKM', 'ShiftKM', 'AuthLimitKM', 'PenaltyETB', 'CabbyTrips', 'CabbyBonus', 'YangoTrips', 'YangoBonus', 'TotalBonus', 'CashDue', 'CashDeposited', 'TxnRef', 'Shortfall', 'DeductedFromBonus', 'DriverMustPay', 'NetDriverBalance', 'BatteryPct', 'Gate', 'Mode', 'Route', 'RoundTrips', 'Trips', 'Passengers', 'FaresExpected', 'CashCollected', 'Telebirr', 'FaresShort', 'FirstStart', 'LastEnd', 'WorkHours', 'OvertimeHours', 'BatteryStartPct', 'RejectReason'];
    const rows = results.map(rowOut).map(s => [s.shiftDate, s.status, s.approvedBy || '', s.hash, s.plate, s.driverName, s.startKm, s.endKm, s.chargingKm, s.nextDayStartKm, s.actualKm, s.authorizedCeilingKm, s.kmPenaltyEtb, s.cabbyTrips, s.cabbyBonus, s.yangoTrips, s.yangoBonus, s.totalCombinedBonus, s.totalCashDue, s.cashDeposited, s.txnRef, sfOf(s), bdOf(s), mpOf(s), s.netDriverBalance ?? '', s.batterySoc, s.isCleared ? 'CLEARED' : 'LOCKED', s.mode || 'cabby', s.routeName || '', s.roundTrips ?? '', s.tripsCount ?? '', s.passengers ?? '', s.expectedRevenue ?? '', s.tripsCount ? s.cashTotal : '', s.teleTotal ?? '', s.tripsCount ? Math.max(0, s.revenueGap) : '', s.firstStart || '', s.lastEnd || '', s.tripsCount ? r2(s.workMinutes / 60) : '', s.tripsCount ? r2(s.overtimeMinutes / 60) : '', s.batteryStart ?? '', s.rejectReason || ''].map(csvCell).join(','));
    await audit(env, actor, 'EXPORT_CSV');
    return new Response([H.join(','), ...rows].join('\n'), { headers: { 'content-type': 'text/csv', 'cache-control': 'no-store' } });
  }

  if (path === '/api/payouts' && m === 'GET') {
    if (!can('reports')) return deny();
    const q = url.searchParams.get('month') || '';
    const mo = /^\d{4}-\d{2}$/.test(q) ? q : addisDate(0).slice(0, 7);
    const { results } = await env.DB.prepare("SELECT * FROM shifts WHERE status='APPROVED' AND substr(shift_date,1,7)=?").bind(mo).all();
    const by = {};
    const dmap = Object.fromEntries((await env.DB.prepare('SELECT id,name FROM drivers').all()).results.map(d => [d.id, d.name]));
    const plates = {};
    for (const r of results) { const k = r.driver_id ?? 'x'; (plates[k] ||= new Set()).add(r.plate); }
    for (const r of results.map(x => ({ ...rowOut(x), _did: x.driver_id ?? 'x' }))) {
      const o = by[r._did] ||= { did: r._did, plate: [...plates[r._did]].join(' '), driver: dmap[r._did] || r.driverName, shifts: 0, km: 0, bonus: 0, pen: 0, pfb: 0, pd: 0, pw: 0, sf: 0, bd: 0, mp: 0, pax: 0, otm: 0, wm: 0 };
      o.shifts++; o.km += r.actualKm; o.bonus += r.totalCombinedBonus; o.pen += r.kmPenaltyEtb; o.pfb += pfbOf(r); o.pd += pdOf(r); o.pw += num(r.waivedPenalty); o.sf += sfOf(r); o.bd += bdOf(r); o.mp += mpOf(r);
      o.pax += num(r.passengers); o.otm += num(r.overtimeMinutes); o.wm += num(r.workMinutes);
    }
    const paid = {}, paidPen = {};
    for (const r of (await env.DB.prepare('SELECT driver_id k,kind,SUM(amount) s FROM payments WHERE substr(pay_date,1,7)=? GROUP BY driver_id,kind').bind(mo).all()).results) {
      paid[r.k] = (paid[r.k] || 0) + num(r.s); if (r.kind === 'penalty') paidPen[r.k] = (paidPen[r.k] || 0) + num(r.s);
    }
    const bal = await balances(env, null);
    const H = ['Month', 'Vehicle(s)', 'Driver', 'Shifts', 'TotalKM', 'Bonus', 'KMPenalty', 'PenaltyFromBonus', 'PenaltyToDebt', 'PenaltyWaived', 'CashShortfall', 'DeductedFromBonus', 'DriverMustPay', 'NetBonusPayable(negative=driver owes)', 'PaidByDriverThisMonth', 'PenaltyPaidThisMonth', 'OutstandingPenaltyAllTime', 'OutstandingDebtAllTime', 'GateLockedForDebt', 'Passengers', 'WorkHours', 'OvertimeHours'];
    const rows = Object.values(by).map(o => [mo, o.plate, o.driver, o.shifts, o.km, o.bonus, o.pen, o.pfb, o.pd, o.pw, o.sf, o.bd, o.mp, o.bonus - o.bd - o.pen, paid[o.did] || 0, paidPen[o.did] || 0, Math.max(0, bal[o.did]?.penalty?.balance || 0), Math.max(0, bal[o.did]?.balance || 0), debtLocked(cfg, bal[o.did]) ? 'YES' : 'NO', o.pax, r2(o.wm / 60), r2(o.otm / 60)].map(csvCell).join(','));
    await audit(env, actor, 'EXPORT_PAYOUT', null, mo);
    return new Response([H.join(','), ...rows].join('\n'), { headers: { 'content-type': 'text/csv', 'cache-control': 'no-store' } });
  }

  // Driver summary: drivers see their own; staff can pick any plate
  if (path === '/api/summary' && m === 'GET') {
    // Driver: their own record. Staff: ?driver=<id> (that driver) or ?plate= (that vehicle; money = its main driver's)
    if (staff && !canAny('opsDash', 'payments', 'reports')) return deny();
    let v = null, d = null, byDriver = !staff || !!url.searchParams.get('driver');
    if (!staff) { d = myDriver; v = myVehicle; }
    else if (url.searchParams.get('driver')) {
      d = await pickDriver(url.searchParams.get('driver'), null); if (!d) return fail('Unknown driver');
      v = await env.DB.prepare('SELECT * FROM vehicles WHERE driver_id=? ORDER BY plate LIMIT 1').bind(d.id).first();
    } else {
      v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(String(url.searchParams.get('plate') || '').toUpperCase()).first();
      if (!v) return fail('Unknown vehicle');
      d = v.driver_id != null ? await env.DB.prepare('SELECT * FROM drivers WHERE id=?').bind(v.driver_id).first() : null;
    }
    const plate = v?.plate || null;
    const bal = (d && (await balances(env, d.id))[d.id]) || ZERO_BAL;
    const pays = d ? (await env.DB.prepare('SELECT pay_date,amount,kind,ref FROM payments WHERE driver_id=? ORDER BY pay_date DESC, id DESC LIMIT 10').bind(d.id).all()).results : [];
    const monthStart = addisDate(0).slice(0, 7) + '-01', weekStart = addisDate(6);
    const from = monthStart < weekStart ? monthStart : weekStart;
    const rows = (await (byDriver ? env.DB.prepare('SELECT * FROM shifts WHERE driver_id=? AND shift_date>=? ORDER BY shift_date DESC, id DESC').bind(d.id, from)
      : env.DB.prepare('SELECT * FROM shifts WHERE plate=? AND shift_date>=? ORDER BY shift_date DESC, id DESC').bind(plate, from)).all()).results.map(rowOut);
    const ap = rows.filter(r => r.status === 'APPROVED');
    const day = r => ({ date: r.shiftDate, status: r.status, mode: r.mode || 'cabby', km: r.actualKm, bonus: r.totalCombinedBonus, penalty: r.kmPenaltyEtb, penaltyFromBonus: pfbOf(r), penaltyDebt: pdOf(r), waivedPenalty: num(r.waivedPenalty), waiveReason: r.waiveReason || '',
      shortfall: sfOf(r), fromBonus: bdOf(r), mustPay: mpOf(r), net: r.netDriverBalance ?? (r.totalCombinedBonus - bdOf(r) - r.kmPenaltyEtb), cleared: r.isCleared, route: r.routeName || '', roundTrips: r.roundTrips ?? 0,
      passengers: r.passengers ?? null, workMinutes: r.workMinutes ?? null, overtimeMinutes: r.overtimeMinutes ?? null, faresShort: Math.max(0, num(r.revenueGap)) });
    const out = { plate, driver: d ? d.name : (v?.driver || ''), driverId: d ? d.id : null, mode: v?.mode || 'any', nextStartKm: v?.next_start_km ?? null, today: addisDate(0),
      week: totals(ap.filter(r => r.shiftDate >= weekStart)), month: totals(ap.filter(r => r.shiftDate >= monthStart)),
      pending: rows.filter(r => r.status === 'PENDING').length, rejected: rows.filter(r => r.status === 'REJECTED').map(r => ({ date: r.shiftDate, reason: r.rejectReason })),
      debt: { owed: bal.owed, paid: bal.paid, balance: bal.balance, cash: bal.cash || null, penalty: bal.penalty || null, locked: debtLocked(cfg, bal), lockAt: num(cfg.debtLockEtb),
        recent: pays.map(p => ({ date: p.pay_date, amount: p.amount, kind: p.kind || 'cash', ref: p.ref })) },
      service: v ? serviceState(v, cfg) : null, rank: await (async () => { if (!plate) return null; const rk = await ranking(env, cfg, 30); const me2 = rk.list.find(x => x.plate === plate); return me2 ? { rank: me2.rank ?? null, of: rk.total, score: me2.score, parts: me2.parts } : null; })(),
      days: rows.filter(r => r.shiftDate >= addisDate(13)).map(r => ({ ...day(r), plate: r.plate, driver: r.driverName })) };
    if (staff && !canAny('payments', 'reports')) { // operations view: no money
      out.debt = null; out.money = false;
      for (const t of [out.week, out.month]) ['bonus', 'penalty', 'shortfall', 'fromBonus', 'mustPay', 'net', 'routeCash', 'telebirr', 'faresShort'].forEach(k => delete t[k]);
      out.days = out.days.map(({ bonus, penalty, penaltyFromBonus, penaltyDebt, waivedPenalty, shortfall, fromBonus, mustPay, net, faresShort, ...rest }) => rest);
    } else out.money = true;
    return J(out);
  }

  if (path === '/api/dashboard' && m === 'GET') {
    if (!canAny('opsDash', 'reports')) return deny();
    const days = [1, 7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 7;
    const modeFilter = ['cabby', 'route'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : '';
    const today = addisDate(0), from = addisDate(days - 1);
    const prevTo = addisDate(days), prevFrom = addisDate(days * 2 - 1);
    const modeSql = modeFilter ? ' AND n_mode=?' : '';
    const modeArgs = modeFilter ? [modeFilter] : [];
    // All totals are added up by the database; only the reports that raise an alert are read in full
    const P = (await env.DB.prepare(`SELECT plate, COUNT(*) n, SUM(n_km) km, SUM(n_bonus) bonus, SUM(n_pen) pen, SUM(n_sf) sf, SUM(n_mp) mp, SUM(n_batt) batt, SUM(1-n_clr) locked, SUM(n_clr) clr,
      SUM(n_due) due, SUM(n_dep) dep, SUM(n_mode='route') rt, SUM(n_pax) pax, SUM(n_otmin) otm, SUM(n_rgap) rgap, SUM(n_tele) tele FROM shifts WHERE status='APPROVED' AND shift_date>=?${modeSql} GROUP BY plate`).bind(from, ...modeArgs).all()).results;
    const byPlate = Object.fromEntries(P.map(r => [r.plate, r])), T = k => P.reduce((t, r) => t + num(r[k]), 0);
    const st = Object.fromEntries((await env.DB.prepare(`SELECT status, COUNT(*) n FROM shifts WHERE shift_date>=?${modeSql} GROUP BY status`).bind(from, ...modeArgs).all()).results.map(r => [r.status, num(r.n)]));
    const repToday = new Set((await env.DB.prepare(`SELECT DISTINCT plate FROM shifts WHERE shift_date=?${modeSql}`).bind(today, ...modeArgs).all()).results.map(r => r.plate));
    const allVs = (await env.DB.prepare('SELECT * FROM vehicles ORDER BY plate').all()).results;
    const vs = modeFilter ? allVs.filter(v => v.mode === modeFilter || (v.mode === 'any' && byPlate[v.plate])) : allVs;
    const vsSet = new Set(vs.map(v => v.plate));
    const chg = (await env.DB.prepare('SELECT plate,kwh,cost,chg_date FROM charging WHERE chg_date>=?').bind(from).all()).results.filter(c => vsSet.has(c.plate));
    const rawExps = (await env.DB.prepare("SELECT plate,exp_date,category,amount,months,note FROM expenses WHERE exp_date<=? AND plate IS NOT NULL AND plate<>''").bind(today).all()).results.filter(e => vsSet.has(e.plate));
    const maintByPlate = {};
    for (const e of rawExps) {
      const { st: est, en: een, daily: edaily } = expSpan(e);
      const a = est > from ? est : from, b = een < today ? een : today;
      if (a <= b) {
        const spanDays = dDiff(a, b) + 1;
        maintByPlate[e.plate] = (maintByPlate[e.plate] || 0) + edaily * spanDays;
      }
    }
    const bal = await balances(env, null);
    const sum = (a, f) => a.reduce((t, r) => t + num(f(r)), 0);
    const btDash = normBattThresholds(cfg);
    const vehicles = vs.map(v => {
      const r = byPlate[v.plate] || {}, n = num(r.n), c = chg.filter(x => x.plate === v.plate);
      const km = num(r.km), kwh = sum(c, x => x.kwh), cost = sum(c, x => x.cost);
      const maintCost = r2(maintByPlate[v.plate] || 0);
      const totalOpCost = r2(cost + maintCost);
      const cashDeposited = num(r.dep), telebirr = num(r.tele), cashDue = num(r.due);
      const faresCollected = cashDeposited + telebirr;
      const vMode = v.mode || 'any';
      const vbCfg = battCfgForMode(cfg, vMode);
      const avgBattery = n ? Math.round(num(r.batt) / n) : null;
      const batteryAlertState = avgBattery == null ? 'none' : avgBattery < vbCfg.alertPct ? 'critical' : avgBattery < vbCfg.warnPct ? 'warn' : 'ok';
      return { plate: v.plate, driver: v.driver, phone: v.phone || '', mode: vMode, shifts: n, km, cashDeposited, telebirr, cashDue, faresCollected,
        faresPerKm: km ? r2(faresCollected / km) : null, passengers: num(r.pax), bonus: num(r.bonus),
        penalty: num(r.pen), shortfall: num(r.sf), mustPay: num(r.mp), driverId: v.driver_id ?? null, debt: Math.max(0, bal[v.driver_id]?.balance || 0),
        penaltyDebt: Math.max(0, bal[v.driver_id]?.penalty?.balance || 0), debtLocked: debtLocked(cfg, bal[v.driver_id]),
        kwh, chargeCost: cost, maintCost, totalOpCost,
        kwhPer100: km && kwh ? Math.round(kwh / km * 1000) / 10 : null,
        etbPerKm: km && cost ? Math.round(cost / km * 100) / 100 : null,
        maintPerKm: km && maintCost ? r2(maintCost / km) : 0,
        totalCostPerKm: km && totalOpCost ? r2(totalOpCost / km) : null,
        avgBattery, lowBatteryThreshold: vbCfg.alertPct, warnBatteryThreshold: vbCfg.warnPct, batteryAlertState,
        locked: num(r.locked),
        reportedToday: repToday.has(v.plate), service: serviceState(v, cfg),
        nextStartKm: num(v.next_start_km), serviceEveryKm: num(v.service_every_km), lastServiceKm: num(v.last_service_km), lastServiceDate: v.last_service_date || '',
        status: v.status || 'ok', repairUntil: v.repair_until || '', statusNote: v.status_note || '' };
    });
    const totKm = T('km'), totKwh = sum(chg, x => x.kwh), totCost = sum(chg, x => x.cost), totFares = T('dep') + T('tele');
    const totMaintCost = r2(vehicles.reduce((t, v) => t + num(v.maintCost), 0));
    const totOpCost = r2(totCost + totMaintCost);
    const fleetCostPerKm = totKm > 0 && totOpCost > 0 ? r2(totOpCost / totKm) : null;
    vehicles.forEach(v => {
      if (fleetCostPerKm && v.totalCostPerKm != null) {
        v.costBenchmarkRatio = r2(v.totalCostPerKm / fleetCostPerKm);
        v.pctAboveBenchmark = Math.round((v.totalCostPerKm - fleetCostPerKm) / fleetCostPerKm * 100);
        v.highCostKm = v.totalCostPerKm > fleetCostPerKm * 1.2;
      } else {
        v.costBenchmarkRatio = null;
        v.pctAboveBenchmark = 0;
        v.highCostKm = false;
      }
    });
    const costPerKmAlerts = vehicles.filter(v => v.highCostKm).sort((a, b) => (b.totalCostPerKm || 0) - (a.totalCostPerKm || 0));

    // Previous equivalent period KPI calculation (prevFrom .. prevTo)
    const Pprev = (await env.DB.prepare(`SELECT COUNT(*) n, SUM(n_km) km, SUM(n_bonus) bonus, SUM(n_pen) pen, SUM(n_sf) sf, SUM(n_mp) mp, SUM(n_batt) batt, SUM(1-n_clr) locked, SUM(n_clr) clr,
      SUM(n_due) due, SUM(n_dep) dep, SUM(n_mode='route') rt, SUM(n_pax) pax, SUM(n_otmin) otm, SUM(n_rgap) rgap, SUM(n_tele) tele, SUM(n_work) trips
      FROM shifts WHERE status='APPROVED' AND shift_date>=? AND shift_date<=?${modeSql}`).bind(prevFrom, prevTo, ...modeArgs).first()) || {};
    const stPrev = Object.fromEntries((await env.DB.prepare(`SELECT status, COUNT(*) n FROM shifts WHERE shift_date>=? AND shift_date<=?${modeSql} GROUP BY status`).bind(prevFrom, prevTo, ...modeArgs).all()).results.map(r => [r.status, num(r.n)]));
    const repPrevDay = new Set((await env.DB.prepare(`SELECT DISTINCT plate FROM shifts WHERE shift_date=?${modeSql}`).bind(prevTo, ...modeArgs).all()).results.map(r => r.plate));
    const chgPrevRows = (await env.DB.prepare('SELECT plate, kwh, cost FROM charging WHERE chg_date>=? AND chg_date<=?').bind(prevFrom, prevTo).all()).results.filter(c => vsSet.has(c.plate));
    const balPrev = await balances(env, null, prevTo);
    const prevShifts = num(Pprev.n), prevKm = num(Pprev.km), prevKwh = sum(chgPrevRows, x => x.kwh), prevCost = sum(chgPrevRows, x => x.cost);
    const prevDep = num(Pprev.dep), prevTele = num(Pprev.tele), prevFares = prevDep + prevTele;
    const prevTrips = num(Pprev.trips);
    const prevAvgTripsPerShift = prevShifts > 0 ? r1(prevTrips / prevShifts) : 0;
    const prevKpi = {
      shifts: prevShifts,
      pending: stPrev.PENDING || 0,
      km: prevKm,
      totalFaresCollected: prevFares,
      faresCollected: prevFares,
      faresPerKm: prevKm ? r2(prevFares / prevKm) : null,
      bonus: num(Pprev.bonus),
      penalty: num(Pprev.pen),
      cashDue: num(Pprev.due),
      cashDeposited: prevDep,
      cleared: num(Pprev.clr),
      driverMustPay: num(Pprev.mp),
      routeShifts: num(Pprev.rt),
      passengers: num(Pprev.pax),
      overtimeHours: r1(num(Pprev.otm) / 60),
      faresShort: num(Pprev.rgap),
      telebirr: prevTele,
      notReported: vs.filter(v => !repPrevDay.has(v.plate)).length,
      rejected: stPrev.REJECTED || 0,
      debt: Object.values(balPrev).reduce((t, b) => t + Math.max(0, b.balance), 0),
      debtLocked: Object.values(balPrev).filter(b => debtLocked(cfg, b)).length,
      debtLockEtb: num(cfg.debtLockEtb),
      penaltyLedger: Object.values(balPrev).reduce((t, b) => ({
        total: t.total + b.penalty.total,
        fromBonus: t.fromBonus + b.penalty.fromBonus,
        paid: t.paid + b.penalty.paid,
        outstanding: t.outstanding + Math.max(0, b.penalty.balance),
        waived: t.waived + b.penalty.waived
      }), { total: 0, fromBonus: 0, paid: 0, outstanding: 0, waived: 0 }),
      kwh: prevKwh,
      chargeCost: prevCost,
      kwhPer100: prevKm && prevKwh ? Math.round(prevKwh / prevKm * 1000) / 10 : null,
      etbPerKm: prevKm && prevCost ? Math.round(prevCost / prevKm * 100) / 100 : null,
      avgTripsPerShift: prevAvgTripsPerShift
    };

    const daily = []; for (let i = days - 1; i >= 0; i--) daily.push({ date: addisDate(i), shifts: 0, trips: 0, passengers: 0, km: 0, bonus: 0, cashDeposited: 0, telebirr: 0, faresCollected: 0 });
    for (const r of (await env.DB.prepare(`SELECT shift_date d, COUNT(*) n, SUM(n_work) trips, SUM(n_pax) pax, SUM(n_km) km, SUM(n_bonus) bonus, SUM(n_dep) dep, SUM(n_tele) tele FROM shifts WHERE status='APPROVED' AND shift_date>=?${modeSql} GROUP BY shift_date`).bind(from, ...modeArgs).all()).results) {
      const d = daily.find(x => x.date === r.d);
      if (d) { d.shifts = num(r.n); d.trips = num(r.trips); d.passengers = num(r.pax); d.km = num(r.km); d.bonus = num(r.bonus); d.cashDeposited = num(r.dep); d.telebirr = num(r.tele); d.faresCollected = num(r.dep) + num(r.tele); }
    }
    const from30 = addisDate(29);
    const faresTrend30d = []; for (let i = 29; i >= 0; i--) faresTrend30d.push({ date: addisDate(i), shifts: 0, trips: 0, passengers: 0, km: 0, bonus: 0, cashDeposited: 0, telebirr: 0, faresCollected: 0 });
    for (const r of (await env.DB.prepare(`SELECT shift_date d, COUNT(*) n, SUM(n_work) trips, SUM(n_pax) pax, SUM(n_km) km, SUM(n_bonus) bonus, SUM(n_dep) dep, SUM(n_tele) tele FROM shifts WHERE status='APPROVED' AND shift_date>=?${modeSql} GROUP BY shift_date`).bind(from30, ...modeArgs).all()).results) {
      const d = faresTrend30d.find(x => x.date === r.d);
      if (d) { d.shifts = num(r.n); d.trips = num(r.trips); d.passengers = num(r.pax); d.km = num(r.km); d.bonus = num(r.bonus); d.cashDeposited = num(r.dep); d.telebirr = num(r.tele); d.faresCollected = num(r.dep) + num(r.tele); }
    }
    const routeWarnBatt = btDash.route.warnPct;
    const cabbyWarnBatt = btDash.cabby.warnPct;
    const cand = (await env.DB.prepare(`SELECT * FROM shifts WHERE status='APPROVED' AND shift_date>=?${modeSql} AND (((n_mode='route' AND n_batt<?) OR (n_mode<>'route' AND n_batt<?)) OR n_rgap>0 OR n_km>? OR n_sf>0 OR n_clr=0
      OR json_extract(calc,'$.kmState')='EXCESS' OR json_extract(calc,'$.breakOver')=1 OR COALESCE(json_extract(calc,'$.incidents'),0)>0) ORDER BY shift_date DESC, id LIMIT 60`).bind(from, ...modeArgs, routeWarnBatt, cabbyWarnBatt, num(cfg.maxDailyKm)).all()).results.map(rowOut);
    const alerts = cand.map(r => ({ id: r.id, date: r.shiftDate, plate: r.plate, driver: r.driverName, why: alertReasons(r, cfg, null, true) })).filter(a => a.why.length).slice(0, 12);

    // Driver productivity comparison: trips per shift over selected days
    const drvRows = (await env.DB.prepare(`SELECT
      COALESCE(s.driver_id, d.id, 0) did,
      COALESCE(d.name, json_extract(s.calc,'$.driverName'), v.driver, 'Unknown') driver,
      COALESCE(s.plate, v.plate, '') plate,
      COALESCE(s.n_mode, v.mode, 'cabby') mode,
      COUNT(*) shifts,
      SUM(s.n_work) trips,
      SUM(s.n_km) km
    FROM shifts s
    LEFT JOIN drivers d ON (s.driver_id = d.id)
    LEFT JOIN vehicles v ON (s.plate = v.plate)
    WHERE s.status='APPROVED' AND s.shift_date>=?${modeFilter ? ' AND s.n_mode=?' : ''}
    GROUP BY driver`).bind(from, ...modeArgs).all()).results;

    const drivers = drvRows.map(r => {
      const shifts = num(r.shifts);
      const trips = num(r.trips);
      const km = num(r.km);
      const tripsPerShift = shifts > 0 ? r1(trips / shifts) : 0;
      const kmPerShift = shifts > 0 ? r1(km / shifts) : 0;
      return {
        driverId: r.did,
        driver: r.driver,
        plate: r.plate,
        mode: r.mode || 'cabby',
        shifts,
        trips,
        tripsPerShift,
        km,
        kmPerShift
      };
    }).sort((a, b) => b.tripsPerShift - a.tripsPerShift || b.trips - a.trips);

    const totDriverShifts = drivers.reduce((t, d) => t + d.shifts, 0);
    const totDriverTrips = drivers.reduce((t, d) => t + d.trips, 0);
    const avgTripsPerShift = totDriverShifts > 0 ? r1(totDriverTrips / totDriverShifts) : 0;

    const out = { days, mode: modeFilter || 'all', from, today, prevFrom, prevTo, fleetCostPerKm, costPerKmAlerts, kpi: { shifts: T('n'), pending: st.PENDING || 0, km: totKm, totalFaresCollected: totFares, faresCollected: totFares,
      faresPerKm: totKm ? r2(totFares / totKm) : null, bonus: T('bonus'),
      penalty: T('pen'), cashDue: T('due'), cashDeposited: T('dep'), cleared: T('clr'), driverMustPay: T('mp'), routeShifts: T('rt'), passengers: T('pax'), overtimeHours: r1(T('otm') / 60), faresShort: T('rgap'), telebirr: T('tele'),
      notReported: vehicles.filter(v => !v.reportedToday).length, rejected: st.REJECTED || 0,
      debt: Object.values(bal).reduce((t, b) => t + Math.max(0, b.balance), 0), debtLocked: Object.values(bal).filter(b => debtLocked(cfg, b)).length, debtLockEtb: num(cfg.debtLockEtb),
      penaltyLedger: Object.values(bal).reduce((t, b) => ({ total: t.total + b.penalty.total, fromBonus: t.fromBonus + b.penalty.fromBonus, paid: t.paid + b.penalty.paid,
        outstanding: t.outstanding + Math.max(0, b.penalty.balance), waived: t.waived + b.penalty.waived }), { total: 0, fromBonus: 0, paid: 0, outstanding: 0, waived: 0 }),
      kwh: totKwh, chargeCost: totCost, maintCost: totMaintCost, totalOpCost: totOpCost,
      kwhPer100: totKm && totKwh ? Math.round(totKwh / totKm * 1000) / 10 : null, etbPerKm: totKm && totCost ? Math.round(totCost / totKm * 100) / 100 : null,
      totalCostPerKm: fleetCostPerKm,
      avgTripsPerShift },
      prevKpi,
      batteryThresholds: btDash,
      vehicles, drivers, driverProductivity: drivers, avgTripsPerShift, prevAvgTripsPerShift, daily, faresTrend30d, alerts, serviceDue: vehicles.filter(v => v.service).map(v => v.service) };
    if (!can('reports')) { // operations view: no money figures
      const MONEY = ['totalFaresCollected', 'faresCollected', 'faresPerKm', 'bonus', 'penalty', 'cashDue', 'cashDeposited', 'driverMustPay', 'faresShort', 'telebirr', 'debt', 'penaltyLedger', 'chargeCost', 'maintCost', 'totalOpCost', 'etbPerKm', 'totalCostPerKm'];
      MONEY.forEach(k => { delete out.kpi[k]; if (out.prevKpi) delete out.prevKpi[k]; });
      out.vehicles.forEach(v => ['cashDeposited', 'telebirr', 'cashDue', 'faresCollected', 'faresPerKm', 'bonus', 'penalty', 'shortfall', 'mustPay', 'debt', 'penaltyDebt', 'chargeCost', 'maintCost', 'totalOpCost', 'etbPerKm', 'maintPerKm', 'totalCostPerKm'].forEach(k => delete v[k]));
      out.daily.forEach(d => ['bonus', 'cashDeposited', 'telebirr', 'faresCollected'].forEach(k => delete d[k])); delete out.faresTrend30d; delete out.costPerKmAlerts; delete out.fleetCostPerKm; out.money = false;
    } else out.money = true;
    return J(out);
  }

  // ---- v4.3+: 🔔 notifications (everyone sees their own + broadcast + individual read/clear) ----
  if (path === '/api/notifications' && m === 'GET') {
    const list = (await env.DB.prepare('SELECT id,ts,type,text,seen FROM notifications WHERE who=? ORDER BY id DESC LIMIT 80').bind(myWho).all()).results;
    const drivers = staff ? (await env.DB.prepare('SELECT d.id, d.name, v.plate, v.mode FROM drivers d LEFT JOIN vehicles v ON v.driver_id=d.id WHERE d.active=1 ORDER BY d.name').all()).results : undefined;
    return J({
      unread: list.filter(n => !n.seen).length,
      quietHours: { on: !!cfg.quietHoursOn, activeNow: isQuietHourNow(cfg), start: cfg.quietStartHour ?? 22, end: cfg.quietEndHour ?? 6 },
      drivers,
      list: list.map(n => ({ id: n.id, ts: n.ts, type: n.type, text: n.text, seen: !!n.seen }))
    });
  }
  if (path === '/api/notifications/seen' && m === 'POST') {
    if (body && body.id != null) {
      const seenVal = body.seen === false ? 0 : 1;
      await env.DB.prepare('UPDATE notifications SET seen=? WHERE who=? AND id=?').bind(seenVal, myWho, +body.id).run();
    } else {
      await env.DB.prepare('UPDATE notifications SET seen=1 WHERE who=? AND seen=0').bind(myWho).run();
    }
    const left = num((await env.DB.prepare('SELECT COUNT(*) n FROM notifications WHERE who=? AND seen=0').bind(myWho).first())?.n);
    return J({ ok: true, unread: left });
  }
  if (path === '/api/notifications' && m === 'DELETE') {
    const delId = url.searchParams.get('id');
    if (delId) {
      await env.DB.prepare('DELETE FROM notifications WHERE who=? AND id=?').bind(myWho, +delId).run();
    } else {
      await env.DB.prepare('DELETE FROM notifications WHERE who=? AND seen=1').bind(myWho).run();
    }
    const left = num((await env.DB.prepare('SELECT COUNT(*) n FROM notifications WHERE who=? AND seen=0').bind(myWho).first())?.n);
    return J({ ok: true, unread: left });
  }
  if (path === '/api/notifications/broadcast' && m === 'POST') {
    if (!staff) return deny();
    const target = String(body.target || 'all_drivers').trim();
    const rawMsg = String(body.message || '').trim().slice(0, 1200);
    const urgent = !!body.urgent;
    if (rawMsg.length < 2) return fail('እባክዎ የሚላከውን መልዕክት ይጻፉ (Please enter a message)');
    const head = urgent ? `🚨 *አስቸኳይ ማስታወቂያ (URGENT)* — ከ${actor}` : `📢 *የአስተዳደር ማስታወቂያ (Announcement)* — ከ${actor}`;
    const fullText = `${head}\n${rawMsg}`;
    let sentCount = 0;
    if (target === 'all_staff') {
      sentCount = await notify(env, cfg, 'broadcast', fullText, { urgent });
    } else if (target === 'driver' || target.startsWith('driver:')) {
      const did = +(target.startsWith('driver:') ? target.split(':')[1] : body.driverId);
      if (!did) return fail('እባክዎ ሹፌር ይምረጡ (Select a driver)');
      if (await notifyDriver(env, did, urgent ? 'incident' : 'broadcast', fullText, { cfg, urgent })) sentCount = 1;
    } else {
      const drvs = (await env.DB.prepare('SELECT d.id, d.name, v.mode, v.plate FROM drivers d LEFT JOIN vehicles v ON v.driver_id=d.id WHERE d.active=1').all()).results;
      const seenIds = new Set();
      for (const d of drvs) {
        if (seenIds.has(d.id)) continue;
        if (target === 'cabby_drivers' && d.mode === 'route') continue;
        if (target === 'route_drivers' && d.mode !== 'route') continue;
        seenIds.add(d.id);
        if (await notifyDriver(env, d.id, urgent ? 'incident' : 'broadcast', fullText, { cfg, urgent })) sentCount++;
      }
    }
    await audit(env, actor, 'CHANNEL', null, `Broadcast (${target}${urgent ? ' URGENT' : ''}) to ${sentCount}: ${rawMsg.slice(0, 120)}`);
    return J({ ok: true, sentCount });
  }
  // ---- v4.3: link my own Telegram (press the link, then Start in the bot) ----
  if (path === '/api/tg/link' && m === 'POST') {
    if (!env.TG_TOKEN) return fail('The Telegram bot is not set up yet (TG_TOKEN). Ask the Super Admin.');
    if (!(await ensureHook(env, url.origin))) return fail('Could not connect the Telegram bot. Check TG_TOKEN.');
    let bot = await getKV(env, 'tg_bot');
    if (!bot) { const r = await tgApi(env, 'getMe'); bot = r?.result?.username || ''; if (!bot) return fail('Could not read the bot name. Check TG_TOKEN.'); await setKV(env, 'tg_bot', bot); }
    const code = hex(crypto.getRandomValues(new Uint8Array(12)));
    await env.DB.batch([env.DB.prepare('DELETE FROM tg_codes WHERE exp<? OR who=?').bind(Date.now(), myWho), env.DB.prepare('INSERT INTO tg_codes(code,who,exp) VALUES(?,?,?)').bind(code, myWho, Date.now() + 15 * 60e3)]);
    return J({ url: `https://t.me/${bot}?start=${code}`, bot });
  }
  if (path === '/api/tg/link' && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM tg_links WHERE who=?').bind(myWho).run();
    await audit(env, actor, 'TG_UNLINK', null, myWho);
    return J({ ok: true });
  }

  // ---- v4.3: day close (Finance). Cabby and Route close separately; a closed day is locked until the Super Admin reopens it ----
  if (path === '/api/dayclose/list' && m === 'GET') {
    if (!canAny('closeDay', 'reports')) return deny();
    const days = Math.min(31, Math.max(1, num(url.searchParams.get('days')) || 10));
    // all the days at once (each day's checks run side by side, not one after another)
    const out = await Promise.all(Array.from({ length: days }, async (_, i) => { const d = addisDate(i), row = { date: d };
      await Promise.all(['cabby', 'route'].map(async g => { const c = await dayChecklist(env, d, g); row[g] = { status: c.status, closedBy: c.closedBy, approved: c.approved, pending: c.pending.length, returned: c.returned.length, missing: c.missing.length, unexplained: c.missing.filter(x => !x.auto && !x.reason).length, needCashNote: c.needCashNote }; }));
      return row; }));
    return J({ today: addisDate(0), list: out, vehicles: { cabby: (await env.DB.prepare("SELECT COUNT(*) n FROM vehicles WHERE mode<>'route'").first()).n, route: (await env.DB.prepare("SELECT COUNT(*) n FROM vehicles WHERE mode='route'").first()).n } });
  }
  if (path === '/api/dayclose' && m === 'GET') {
    if (!canAny('closeDay', 'reports')) return deny();
    const date = url.searchParams.get('date'), g = url.searchParams.get('mode');
    if (!isDay(date) || !['cabby', 'route'].includes(g)) return fail('Pick a date and Cabby or Route');
    return J(await dayChecklist(env, date, g));
  }
  if (path === '/api/dayclose' && m === 'POST') {
    if (!can('closeDay')) return deny();
    const date = String(body.date || ''), g = body.mode;
    if (!isDay(date) || !['cabby', 'route'].includes(g)) return fail('Pick a date and Cabby or Route');
    if (date > addisDate(0)) return fail('You cannot close a day that has not happened');
    if (await isClosed(env, date, g)) return fail('This day is already closed');
    // Returned reports the driver will not fix can be cancelled here, with a reason
    const cancel = body.cancel && typeof body.cancel === 'object' ? body.cancel : {}, st = [];
    for (const [id, why] of Object.entries(cancel)) {
      const r0 = await env.DB.prepare("SELECT id,plate,shift_date,calc,reject_reason FROM shifts WHERE id=? AND status='REJECTED'").bind(+id).first();
      if (!r0 || r0.shift_date !== date || grpOf(JSON.parse(r0.calc).mode) !== g) return fail(`Report #${id} is not a returned report of this day`);
      const reason = String(why || '').trim().slice(0, 160);
      if (reason.length < 3) return fail(`Write why report #${id} (${r0.plate}) is cancelled`);
      st.push(env.DB.prepare("UPDATE shifts SET status='CANCELLED', reject_reason=?, updated_at=? WHERE id=?").bind(`${r0.reject_reason || ''} · ✖ ${reason}`.slice(0, 300), now(), r0.id), auditStmt(env, actor, 'CANCEL', r0.id, `${r0.plate} ${date}: ${reason}`));
    }
    const c = await dayChecklist(env, date, g), cIds = new Set(Object.keys(cancel).map(Number));
    if (c.pending.length) return fail(`⏳ ${c.pending.length} report(s) still waiting for approval: ${c.pending.map(p => p.plate).join(', ')}`);
    const ret = c.returned.filter(r => !cIds.has(r.id));
    if (ret.length) return fail(`↩️ ${ret.length} returned report(s) not fixed: ${ret.map(p => p.plate).join(', ')}. Wait for the driver or cancel them with a reason.`);
    const miss = body.missing && typeof body.missing === 'object' ? body.missing : {};
    for (const x of c.missing) {
      if (x.auto) { st.push(env.DB.prepare('INSERT INTO day_missing(cdate,plate,reason,note,by_actor,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(cdate,plate) DO UPDATE SET reason=excluded.reason,note=excluded.note,by_actor=excluded.by_actor').bind(date, x.plate, 'repair', 'auto', actor, now())); continue; }
      const mm = miss[x.plate] || {}, reason = String(mm.reason || ''), note = String(mm.note || '').trim().slice(0, 120);
      if (!MISS_REASONS[reason]) return fail(`🚐 ${x.plate} sent no report: pick a reason (ምክንያት ይምረጡ)`);
      if (reason === 'other' && note.length < 3) return fail(`🚐 ${x.plate}: write what happened`);
      st.push(env.DB.prepare('INSERT INTO day_missing(cdate,plate,reason,note,by_actor,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(cdate,plate) DO UPDATE SET reason=excluded.reason,note=excluded.note,by_actor=excluded.by_actor').bind(date, x.plate, reason, note, actor, now()));
    }
    if (c.teleStmt.needed && !c.teleStmt.covered) return fail(`📄 የ${date} የቴሌብር መግለጫ ያስፈልጋል (${[...new Set(c.teleStmt.reasons.map(r => TELE_WHY[r.why]))].join(' · ')})። ከመርቻንት ፖርታሉ አውርደው በ📱 ቴሌብር ገጽ ይጫኑ። (Upload the Telebirr statement first.)`);
    const cashNote = String(body.cashNote || '').trim().slice(0, 300);
    if (c.needCashNote && cashNote.length < 3) return fail(`💵 Money does not match (short ${c.cash.shortfall} ETB${c.cash.teleGap ? `, Telebirr difference ${c.cash.teleGap} ETB` : ''}). Write a note.`);
    if (body.confirm !== true) return fail('Tick that cash and Telebirr were checked against the bank and the statement');
    const mf = await moneyFlow(env, cfg, date, date, g), snap = { ...mf.total, approved: c.approved, missing: c.missing.length, cash: c.cash };
    st.push(env.DB.prepare("INSERT INTO day_close(cdate,grp,status,closed_by,closed_at,snapshot,note) VALUES(?,?,'closed',?,?,?,?) ON CONFLICT(cdate,grp) DO UPDATE SET status='closed',closed_by=excluded.closed_by,closed_at=excluded.closed_at,snapshot=excluded.snapshot,note=excluded.note")
      .bind(date, g, actor, now(), JSON.stringify(snap), cashNote), auditStmt(env, actor, 'DAY_CLOSE', null, `${date} ${g} in=${snap.in} out=${snap.out} reports=${c.approved} missing=${c.missing.length}${cashNote ? ' · ' + cashNote : ''}`.slice(0, 900)));
    await env.DB.batch(st);
    bg(notify(env, cfg, 'dayClosed', `📕 ${date} ${GRP_L[g]} ተዘግቷል — ${actor}\n📋 ${c.approved} ሪፖርት · 🚐 ${c.missing.length} ያልሰሩ${cashNote ? `\n📝 ${cashNote}` : ''}`));
    return J({ ok: true, snapshot: snap });
  }
  if (path === '/api/dayclose/reopen' && m === 'POST') {
    if (!admin) return fail('Only the Super Admin can reopen a closed day', 403);
    const date = String(body.date || ''), g = body.mode, reason = String(body.reason || '').trim().slice(0, 200);
    if (!isDay(date) || !['cabby', 'route'].includes(g)) return fail('Pick a date and Cabby or Route');
    if (!(await isClosed(env, date, g))) return fail('This day is not closed');
    if (reason.length < 3) return fail('Write why the day is reopened (ምክንያት ይጻፉ)');
    await env.DB.batch([env.DB.prepare("UPDATE day_close SET status='open',reopened_by=?,reopened_at=?,reopen_reason=? WHERE cdate=? AND grp=?").bind(actor, now(), reason, date, g),
      auditStmt(env, actor, 'DAY_REOPEN', null, `${date} ${g}: ${reason}`)]);
    bg(notify(env, cfg, 'dayClosed', `📖 ${date} ${GRP_L[g]} እንደገና ተከፍቷል — ${actor}\n📝 ${reason}`));
    return J({ ok: true });
  }

  // ---- v4.3: breaks (☕) and the driver's live status ----
  if (path === '/api/status' && m === 'GET') {
    if (staff) return deny();
    const bk = await breaksFor(env, cfg, myDriver.id, addisDate(0));
    const inc = (await env.DB.prepare("SELECT id,plate,idate,kind,note,status,created_at FROM incidents WHERE driver_id=? AND (status='open' OR idate>=?) ORDER BY id DESC LIMIT 10").bind(myDriver.id, addisDate(2)).all()).results;
    return J({ plate: me.plate, today: addisDate(0), breaks: bk, open: bk.list.find(b => b.open) || null, incidents: inc,
      vehicle: myVehicle ? { status: myVehicle.status || 'ok', since: myVehicle.status_since || '', until: myVehicle.repair_until || '' } : null });
  }
  if (path === '/api/breaks/start' && m === 'POST') {
    if (staff) return deny();
    if (!me.plate) return fail('No vehicle is assigned to you today (ለዛሬ መኪና አልተመደበልዎትም)');
    const reason = BREAK_REASONS[body.reason] ? body.reason : 'rest';
    if (await env.DB.prepare('SELECT 1 x FROM breaks WHERE driver_id=? AND end_ts IS NULL').bind(myDriver.id).first()) return fail('You are already on a break. Press ▶️ first.');
    await env.DB.prepare('INSERT INTO breaks(driver_id,plate,bdate,reason,start_ts) VALUES(?,?,?,?,?)').bind(myDriver.id, me.plate, addisDate(0), reason, now()).run();
    await audit(env, actor, 'BREAK_START', null, `${me.plate} ${reason}`);
    return J({ ok: true });
  }
  if (path === '/api/breaks/end' && m === 'POST') {
    if (staff) return deny();
    const b0 = await env.DB.prepare('SELECT * FROM breaks WHERE driver_id=? AND end_ts IS NULL ORDER BY id DESC LIMIT 1').bind(myDriver.id).first();
    if (!b0) return fail('You are not on a break');
    await env.DB.prepare('UPDATE breaks SET end_ts=? WHERE id=?').bind(now(), b0.id).run();
    const bk = await breaksFor(env, cfg, myDriver.id, b0.bdate), last = bk.list[bk.list.length - 1];
    await audit(env, actor, 'BREAK_END', null, `${b0.plate} ${b0.reason} ${last ? last.min : 0} min`);
    if (bk.over) bg(notify(env, cfg, 'breakOver', `☕ ${myDriver.name} (${b0.plate})፦ ${bk.count} እረፍት · ${bk.minutes} ደቂቃ ዛሬ — ገደብ ${cfg.breakMaxMin} ደቂቃ / ${cfg.breakMaxCount} ጊዜ`));
    return J({ ok: true, minutes: last ? last.min : 0, today: bk });
  }

  // ---- v4.9 📅 weekly plan, days off ----
  if (path === '/api/roster' && m === 'GET') {
    if (!staff || !canAny('assign', 'vehicles', 'opsDash')) return deny();
    const ws = weekStart(isDay(url.searchParams.get('week') || '') ? url.searchParams.get('week') : addisDate(0)), W = await rosterWeek(env, cfg, ws);
    const pend = (await env.DB.prepare("SELECT l.*, d.name FROM leaves l JOIN drivers d ON d.id=l.driver_id WHERE l.status='pending' OR l.to_date>=? ORDER BY l.status='pending' DESC, l.from_date LIMIT 100").bind(addisDate(0)).all()).results;
    return J({ week: ws, days: W.days, canEdit: can('assign'), shifts: { cabby: shiftDefs(cfg, 'cabby'), route: shiftDefs(cfg, 'route') },
      vehicles: W.vehicles.map(v => ({ plate: v.plate, mode: v.mode || 'any', status: v.status || 'ok', until: v.repair_until || '' })),
      drivers: W.drivers.map(d => ({ id: d.id, name: d.name, homePlate: d.home_plate, homeShift: d.home_shift, restDow: d.rest_dow, standby: !!d.standby })),
      rows: W.rows.map(r => ({ date: r.rdate, plate: r.plate, shiftNo: r.shift_no, driverId: r.driver_id, kind: r.kind, published: !!r.published })),
      off: Object.fromEntries(W.days.map(d => [d, W.drivers.filter(x => offOn(W, x.id, d)).map(x => ({ id: x.id, why: offOn(W, x.id, d) }))])),
      leaves: pend.map(l => ({ id: l.id, driverId: l.driver_id, name: l.name, from: l.from_date, to: l.to_date, kind: l.kind, note: l.note, status: l.status, decidedBy: l.decided_by || '', decisionNote: l.decision_note || '' })),
      published: W.rows.length > 0 && W.rows.every(r => r.published), channel: !!(await rosterChannel(env)), restNames: DOW_AM, leaveKinds: LEAVE_KINDS });
  }
  if (path === '/api/roster/pairings' && m === 'PUT') {
    if (!canAny('assign', 'vehicles')) return deny();
    const list = Array.isArray(body) ? body.slice(0, 500) : [], st = [];
    const plates = new Set((await env.DB.prepare('SELECT plate FROM vehicles').all()).results.map(v => v.plate)), seen = new Set();
    for (const x of list) {
      const id = Math.floor(num(x.driverId)), hp = String(x.homePlate || '').toUpperCase(), hs = Math.min(3, Math.max(1, Math.floor(num(x.homeShift)) || 1)), rd = Math.floor(num(x.restDow ?? -1));
      if (hp && !plates.has(hp)) return fail(`Unknown vehicle ${hp}`);
      if (hp && !x.standby) { const k = hp + '|' + hs; if (seen.has(k)) return fail(`${hp} · ፈረቃ ${hs}: two drivers have it as their usual shift`); seen.add(k); }
      st.push(env.DB.prepare('UPDATE drivers SET home_plate=?, home_shift=?, rest_dow=?, standby=? WHERE id=?').bind(x.standby ? '' : hp, hs, rd >= 0 && rd <= 6 ? rd : -1, x.standby ? 1 : 0, id));
    }
    st.push(auditStmt(env, actor, 'ROSTER_PAIRINGS', null, `${list.length} driver(s)`));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    return J({ ok: true });
  }
  if (path === '/api/roster/draft' && m === 'POST') {
    if (!can('assign')) return deny();
    const ws = weekStart(isDay(body.week || '') ? body.week : addisDate(-7)), W = await rosterWeek(env, cfg, ws);
    if (W.rows.some(r => r.published) && !body.force) return fail('📢 ይህ ሳምንት ታትሟል — ለመቀየር እያንዳንዱን ቦታ ይቀይሩ (This week is published)', 409);
    const draft = rosterDraft(cfg, W), t = now();
    const st = [env.DB.prepare('DELETE FROM roster WHERE rdate>=? AND rdate<=? AND published=0').bind(W.days[0], W.days[6])];
    for (const x of draft) st.push(env.DB.prepare("INSERT INTO roster(rdate,plate,shift_no,driver_id,kind,published,by_actor,created_at) VALUES(?,?,?,?,'work',0,?,?) ON CONFLICT(rdate,plate,shift_no) DO NOTHING").bind(x.date, x.plate, x.shiftNo, x.driverId, actor, t));
    st.push(auditStmt(env, actor, 'ROSTER_DRAFT', null, `${ws}: ${draft.length} shift(s), ${draft.filter(x => x.driverId == null).length} gap(s)`));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    return J({ ok: true, shifts: draft.length, gaps: draft.filter(x => x.driverId == null).length });
  }
  if (path === '/api/roster/cell' && m === 'PUT') {
    if (!can('assign')) return deny();
    const date = String(body.date || ''), plate = String(body.plate || '').toUpperCase(), sn = Math.floor(num(body.shiftNo)), did = body.driverId == null || body.driverId === '' ? null : Math.floor(num(body.driverId));
    if (!isDay(date) || !sn) return fail('Pick a day and a shift');
    if (date < addisDate(0)) return fail('Past days cannot be changed');
    const v = await env.DB.prepare('SELECT plate,mode FROM vehicles WHERE plate=?').bind(plate).first(); if (!v) return fail('Unknown vehicle');
    if (!shiftDef(cfg, v.mode === 'route' ? 'route' : 'cabby', sn)) return fail('Unknown shift');
    const d = did != null ? await env.DB.prepare('SELECT id,name FROM drivers WHERE id=? AND active=1').bind(did).first() : null;
    if (did != null && !d) return fail('Unknown driver');
    if (did != null) { const clash = await env.DB.prepare("SELECT plate FROM roster WHERE rdate=? AND shift_no=? AND driver_id=? AND plate<>? AND kind='work'").bind(date, sn, did, plate).first();
      if (clash) return fail(`${d.name} በዚያው ሰዓት ${clash.plate} ላይ ተመድቧል (already on ${clash.plate} at that shift)`); }
    const old = await env.DB.prepare('SELECT * FROM roster WHERE rdate=? AND plate=? AND shift_no=?').bind(date, plate, sn).first();
    const wk = weekStart(date), pub = !!(await env.DB.prepare('SELECT 1 x FROM roster WHERE rdate>=? AND rdate<=? AND published=1 LIMIT 1').bind(wk, dAdd(wk, 6)).first());
    await env.DB.batch([env.DB.prepare("INSERT INTO roster(rdate,plate,shift_no,driver_id,kind,published,by_actor,created_at) VALUES(?,?,?,?,'work',?,?,?) ON CONFLICT(rdate,plate,shift_no) DO UPDATE SET driver_id=excluded.driver_id, published=excluded.published, by_actor=excluded.by_actor, created_at=excluded.created_at")
      .bind(date, plate, sn, did, pub ? 1 : 0, actor, now()), auditStmt(env, actor, 'ROSTER_CHANGE', null, `${date} ${plate} shift ${sn}: ${old?.driver_id ?? '—'} → ${d ? d.name : '—'}`)]);
    if (pub && (old?.driver_id ?? null) !== did) { // a published plan changed: tell the people it touches
      const sd = shiftDef(cfg, v.mode === 'route' ? 'route' : 'cabby', sn), when = `${DOW_AM[dowOf(date)]} ${ddmm(date)} · ${plate} · ${sd.name} ${sd.start}–${sd.end}`;
      if (did != null) bg(notifyDriver(env, did, 'roster', `📅 *የፕሮግራም ለውጥ*\n➕ ተመድበዋል፦ ${when}`));
      if (old?.driver_id != null) bg(notifyDriver(env, old.driver_id, 'roster', `📅 *የፕሮግራም ለውጥ*\n➖ ከዚህ ፈረቃ ተነስተዋል፦ ${when}`));
      bg((async () => { const ch = await rosterChannel(env); if (ch) await tg(env, `🔁 *ለውጥ* — ${when}\n${d ? d.name : '— (ክፍት)'}`, ch.id); })());
    }
    return J({ ok: true, published: pub });
  }
  if (path === '/api/roster/publish' && m === 'POST') {
    if (!can('assign')) return deny();
    const ws = weekStart(isDay(body.week || '') ? body.week : addisDate(-7)), W = await rosterWeek(env, cfg, ws);
    if (!W.rows.length) return fail('Make the draft first (ረቂቅ ያዘጋጁ)');
    const gaps = W.rows.filter(r => r.kind === 'work' && r.driver_id == null);
    if (gaps.length && !body.withGaps) return J({ ok: false, gaps: gaps.map(g => ({ date: g.rdate, plate: g.plate, shiftNo: g.shift_no })) }, 409);
    await env.DB.batch([env.DB.prepare('UPDATE roster SET published=1 WHERE rdate>=? AND rdate<=?').bind(W.days[0], W.days[6]), auditStmt(env, actor, 'ROSTER_PUBLISH', null, `${ws}${gaps.length ? ` (${gaps.length} open)` : ''}`)]);
    const who = [...new Set(W.rows.map(r => r.driver_id).filter(x => x != null))];
    bg((async () => {
      for (const did of who) await notifyDriver(env, did, 'roster', `📅 *የሳምንቱ ፕሮግራምዎ* (${ddmm(W.days[0])} – ${ddmm(W.days[6])})\n${await rosterText(env, cfg, did, W.days)}`);
      const ch = await rosterChannel(env); if (!ch) return;
      const names = Object.fromEntries(W.drivers.map(d => [d.id, d.name])), mode = Object.fromEntries(W.vehicles.map(v => [v.plate, v.mode === 'route' ? 'route' : 'cabby']));
      for (const date of W.days) {
        const rs = W.rows.filter(r => r.rdate === date).sort((a, b) => a.plate.localeCompare(b.plate) || a.shift_no - b.shift_no);
        if (!rs.length) continue;
        const by = {}; for (const r of rs) (by[r.plate] ||= []).push(`${shiftDef(cfg, mode[r.plate], r.shift_no)?.name || r.shift_no}: ${r.driver_id != null ? names[r.driver_id] || '?' : '— ክፍት'}`);
        await tg(env, `📅 *${DOW_AM[dowOf(date)]} ${ddmm(date)}*\n${Object.entries(by).map(([p, l]) => `${mode[p] === 'route' ? '🟢' : '🔵'} ${p} — ${l.join(' · ')}`).join('\n')}`, ch.id);
      }
    })());
    return J({ ok: true, drivers: who.length, gaps: gaps.length });
  }
  // Driver: my plan (next 14 days) and my day-off requests
  if (path === '/api/roster/me' && m === 'GET') {
    if (staff) return deny();
    const days = Array.from({ length: 14 }, (_, i) => dAdd(addisDate(0), i));
    const rows = (await env.DB.prepare("SELECT r.*, v.mode FROM roster r LEFT JOIN vehicles v ON v.plate=r.plate WHERE r.driver_id=? AND r.rdate>=? AND r.rdate<=? AND r.kind='work' AND r.published=1 ORDER BY r.rdate, r.shift_no").bind(myDriver.id, days[0], days[13]).all()).results;
    const lv = (await env.DB.prepare('SELECT * FROM leaves WHERE driver_id=? ORDER BY id DESC LIMIT 20').bind(myDriver.id).all()).results;
    return J({ days: days.map(d => ({ date: d, dow: DOW_AM[dowOf(d)], shifts: rows.filter(r => r.rdate === d).map(r => { const sd = shiftDef(cfg, r.mode === 'route' ? 'route' : 'cabby', r.shift_no) || {}; return { plate: r.plate, shiftNo: r.shift_no, name: sd.name || '', start: sd.start || '', end: sd.end || '' }; }) })),
      restDow: myDriver.rest_dow, restName: DOW_AM[myDriver.rest_dow] || '', leaves: lv.map(l => ({ id: l.id, from: l.from_date, to: l.to_date, kind: l.kind, note: l.note, status: l.status, decisionNote: l.decision_note || '' })), kinds: LEAVE_KINDS, noticeDays: num(cfg.leaveNoticeDays) });
  }
  if (path === '/api/leaves' && m === 'POST') {
    if (staff) return deny();
    const from = String(body.from || ''), to = String(body.to || from), kind = LEAVE_KINDS[body.kind] ? body.kind : null, note = String(body.note || '').trim().slice(0, 300);
    if (!isDay(from) || !isDay(to) || to < from) return fail('Pick the days (ቀናቱን ይምረጡ)');
    if (!kind) return fail('Pick the kind (አይነቱን ይምረጡ)');
    if (dDiff(from, to) > 30) return fail('At most 31 days at a time');
    if (kind !== 'sick' && from < addisDate(-num(cfg.leaveNoticeDays))) return fail(`ቢያንስ ከ${cfg.leaveNoticeDays} ቀን በፊት ይጠይቁ (ask at least ${cfg.leaveNoticeDays} days ahead; sick leave any time)`);
    if (kind === 'sick' && from < addisDate(2)) return fail('Sick leave: from 2 days back at most');
    const r = await env.DB.prepare('INSERT INTO leaves(driver_id,from_date,to_date,kind,note,created_at) VALUES(?,?,?,?,?,?)').bind(myDriver.id, from, to, kind, note, now()).run();
    await audit(env, actor, 'LEAVE_ASK', null, `${kind} ${from}..${to} ${note}`.slice(0, 300));
    bg(notify(env, cfg, 'roster', `📅 *የእረፍት/ፈቃድ ጥያቄ* — ${myDriver.name}\n${LEAVE_KINDS[kind]}፦ ${from}${to !== from ? ' → ' + to : ''}${note ? `\n📝 ${note}` : ''}\n✅ በፖርታሉ 📅 ፕሮግራም ይወስኑ`));
    return J({ ok: true, id: r.meta.last_row_id });
  }
  const lvd = path.match(/^\/api\/leaves\/(\d+)\/decide$/);
  if (lvd && m === 'POST') {
    if (!can('assign')) return deny();
    const l = await env.DB.prepare('SELECT l.*, d.name FROM leaves l JOIN drivers d ON d.id=l.driver_id WHERE l.id=?').bind(+lvd[1]).first();
    if (!l) return fail('Not found', 404);
    if (l.status !== 'pending') return fail('Already decided');
    const ok2 = !!body.approve, note = String(body.note || '').trim().slice(0, 200);
    const st = [env.DB.prepare('UPDATE leaves SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').bind(ok2 ? 'approved' : 'rejected', actor, now(), note, l.id),
      auditStmt(env, actor, ok2 ? 'LEAVE_APPROVE' : 'LEAVE_REJECT', null, `${l.name} ${l.from_date}..${l.to_date} ${note}`)];
    let freed = [];
    if (ok2) { // the driver's planned shifts on those days become open; the Fleet Admin fills them
      freed = (await env.DB.prepare("SELECT rdate,plate,shift_no FROM roster WHERE driver_id=? AND rdate>=? AND rdate<=? AND kind='work'").bind(l.driver_id, l.from_date, l.to_date).all()).results;
      st.push(env.DB.prepare("UPDATE roster SET driver_id=NULL WHERE driver_id=? AND rdate>=? AND rdate<=? AND kind='work'").bind(l.driver_id, l.from_date, l.to_date));
    }
    await env.DB.batch(st);
    bg(notifyDriver(env, l.driver_id, 'roster', `📅 ${LEAVE_KINDS[l.kind]} ${l.from_date}${l.to_date !== l.from_date ? ' → ' + l.to_date : ''}፦ ${ok2 ? '✅ ተፈቅዷል' : '❌ አልተፈቀደም'}${note ? `\n📝 ${note}` : ''}`));
    if (freed.length) bg(notify(env, cfg, 'roster', `📅 ${l.name} ፈቃድ ተሰጥቶታል — ${freed.length} ፈረቃ ክፍት ሆኗል፦ ${freed.map(f => `${ddmm(f.rdate)} ${f.plate}`).join(', ')}\nተጠባባቂ ይመድቡ።`));
    return J({ ok: true, freed: freed.length });
  }

  // ---- v4.9 📈 profit & loss, 🎯 targets, 🟡 Yango weekly goal ----
  if (path === '/api/pnl' && m === 'GET') {
    if (!staff || !canAny('reports', 'payments')) return deny();
    const q = url.searchParams.get('month') || '', mo = /^\d{4}-\d{2}$/.test(q) ? q : addisDate(0).slice(0, 7);
    if (url.searchParams.get('format') === 'xlsx') {
      const pk = await monthlyPack(env, cfg, mo); await audit(env, actor, 'EXPORT_PNL', null, mo);
      return new Response(pk.xlsx, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="ETEV_${mo}.xlsx"`, 'cache-control': 'no-store' } });
    }
    const from = mo + '-01', end = mo + '-' + String(monthDays(mo)).padStart(2, '0'), to = end < addisDate(0) ? end : addisDate(0);
    const mf = await moneyFlow(env, cfg, from, to < from ? from : to, '');
    return J({ month: mo, from, to, lines: PNL_LINES.map(([k, l]) => ({ k, l, v: r2(num(mf.total[k])) })), total: mf.total, cats: mf.cats,
      vehicles: mf.vehicles.map(v => ({ plate: v.plate, in: v.in, out: v.out, net: v.net, km: r2(v.km), com: v.com, fix: v.fix })), settings: admin ? { commission: cfg.commission || DEF.commission, fixedCosts: cfg.fixedCosts || [] } : null });
  }
  if (path === '/api/targets' && m === 'GET') {
    if (!staff || !canAny('reports', 'payments', 'assign', 'opsDash')) return deny();
    const q = url.searchParams.get('month') || '', mo = /^\d{4}-\d{2}$/.test(q) ? q : addisDate(0).slice(0, 7);
    return J({ ...(await targetReport(env, cfg, mo)), canEdit: admin });
  }
  if (path === '/api/targets' && m === 'PUT') {
    if (!admin) return deny();
    const n = { ...cfg }, def = body.defaults || {};
    n.targets = Object.fromEntries(Object.entries(TGT_METRICS).map(([k, ms]) => [k, Object.fromEntries(ms.map(x => [x, Math.max(-1e9, num(def[k]?.[x] ?? (cfg.targets || DEF.targets)[k]?.[x]))]))]));
    const st = [env.DB.prepare('INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('policy', JSON.stringify(n))];
    for (const o of (Array.isArray(body.overrides) ? body.overrides.slice(0, 2000) : [])) {
      const kind = o.kind === 'driver' ? 'driver' : 'vehicle', metric = String(o.metric || ''), id = String(o.id || '').slice(0, 30);
      if (!TGT_METRICS[kind].includes(metric) || !id) continue;
      st.push(o.value === '' || o.value == null ? env.DB.prepare('DELETE FROM targets WHERE kind=? AND id=? AND metric=?').bind(kind, id, metric)
        : env.DB.prepare('INSERT INTO targets(kind,id,metric,value) VALUES(?,?,?,?) ON CONFLICT(kind,id,metric) DO UPDATE SET value=excluded.value').bind(kind, id, metric, num(o.value)));
    }
    st.push(auditStmt(env, actor, 'TARGETS', null, 'targets updated'));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    return J({ ok: true });
  }
  if (path === '/api/pnl/settings' && m === 'PUT') {
    if (!admin) return deny();
    const n = { ...cfg }, c = body.commission || {};
    n.commission = { cabby: Math.min(60, Math.max(0, num(c.cabby))), yango: Math.min(60, Math.max(0, num(c.yango))) };
    const plates = new Set((await env.DB.prepare('SELECT plate FROM vehicles').all()).results.map(v => v.plate));
    const fc = (Array.isArray(body.fixedCosts) ? body.fixedCosts.slice(0, 100) : []).map((x, i) => ({ id: String(x.id || 'fc-' + i + '-' + Date.now().toString(36)).slice(0, 40), name: String(x.name || '').trim().slice(0, 60),
      cat: ['insurance', 'bolo', 'loan', 'rent', 'other'].includes(x.cat) ? x.cat : 'other', amount: Math.max(0, num(x.amount)), per: x.per === 'year' ? 'year' : 'month', plate: String(x.plate || '').toUpperCase(),
      from: isDay(x.from || '') ? x.from : '', to: isDay(x.to || '') ? x.to : '' }));
    if (fc.some(x => !x.name || !(x.amount > 0))) return fail('Each fixed cost needs a name and an amount');
    if (fc.some(x => x.plate && !plates.has(x.plate))) return fail('Unknown vehicle in fixed costs');
    n.fixedCosts = fc;
    await env.DB.batch([env.DB.prepare('INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('policy', JSON.stringify(n)), auditStmt(env, actor, 'PNL_SETTINGS', null, `commission ${n.commission.cabby}/${n.commission.yango}%, ${fc.length} fixed cost(s)`)]);
    return J({ ok: true });
  }
  if (path === '/api/yango' && m === 'GET') {
    if (!staff || !canAny('vehicles', 'assign', 'platform', 'reports')) return deny();
    const wk = weekStart(isDay(url.searchParams.get('week') || '') ? url.searchParams.get('week') : addisDate(0));
    const past = (await env.DB.prepare('SELECT * FROM yango_week WHERE closed=1 ORDER BY week DESC, plate LIMIT 60').all()).results;
    const names = Object.fromEntries((await env.DB.prepare('SELECT id, name FROM drivers').all()).results.map(d => [d.id, d.name]));
    return J({ week: wk, end: dAdd(wk, 6), today: addisDate(0), tiers: yTiers(cfg), sharePct: num((cfg.yangoGoal || DEF.yangoGoal).sharePct), canEdit: canAny('vehicles', 'assign'), canSet: admin, names,
      rows: await yangoWeek(env, cfg, wk), past: past.map(y => ({ week: y.week, plate: y.plate, goal: y.goal, trips: y.trips, met: !!y.met, bonus: y.bonus, shares: JSON.parse(y.shares || '{}') })) });
  }
  if (path === '/api/yango' && m === 'PUT') {
    if (!canAny('vehicles', 'assign')) return deny();
    const wk = weekStart(isDay(body.week || '') ? body.week : addisDate(0)), plate = String(body.plate || '').toUpperCase(), goal = Math.floor(num(body.goal));
    if (wk < weekStart(addisDate(0))) return fail('That week is over');
    const v = await env.DB.prepare('SELECT mode FROM vehicles WHERE plate=?').bind(plate).first(); if (!v || v.mode === 'route') return fail('Unknown Cabby/Yango vehicle');
    const tier = yTiers(cfg).find(t => t.trips === goal); if (goal && !tier) return fail('Pick one of the goals');
    const ex = await env.DB.prepare('SELECT closed FROM yango_week WHERE plate=? AND week=?').bind(plate, wk).first(); if (ex?.closed) return fail('That week is closed');
    await env.DB.batch([env.DB.prepare("INSERT INTO yango_week(plate,week,goal,goal_etb,chosen_by) VALUES(?,?,?,?,?) ON CONFLICT(plate,week) DO UPDATE SET goal=excluded.goal, goal_etb=excluded.goal_etb, chosen_by=excluded.chosen_by").bind(plate, wk, goal, tier ? tier.etb : 0, actor),
      auditStmt(env, actor, 'YANGO_GOAL', null, `${plate} week ${wk}: ${goal ? goal + ' trips → ' + tier.etb + ' ETB' : 'no goal'}`)]);
    return J({ ok: true });
  }
  if (path === '/api/yango/close' && m === 'POST') { // close a finished week now (the morning job does it on Mondays)
    if (!canAny('vehicles', 'assign', 'payments')) return deny();
    const wk = weekStart(isDay(body.week || '') ? body.week : addisDate(7));
    if (dAdd(wk, 6) >= addisDate(0)) return fail('The week is not over yet');
    return J({ ok: true, closed: await yangoClose(env, cfg, wk) });
  }
  if (path === '/api/yango/settings' && m === 'PUT') {
    if (!admin) return deny();
    const tiers = (Array.isArray(body.tiers) ? body.tiers.slice(0, 12) : []).map(t => ({ trips: Math.floor(num(t.trips)), etb: Math.round(num(t.etb)) })).filter(t => t.trips > 0 && t.etb > 0).sort((a, b) => a.trips - b.trips);
    if (!tiers.length) return fail('Add at least one goal');
    if (new Set(tiers.map(t => t.trips)).size !== tiers.length) return fail('Two goals with the same trips');
    const n = { ...cfg, yangoGoal: { tiers, sharePct: Math.min(100, Math.max(0, num(body.sharePct))), warnDow: Math.min(6, Math.max(0, Math.floor(num(body.warnDow ?? 4)))) } };
    await env.DB.batch([env.DB.prepare('INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('policy', JSON.stringify(n)), auditStmt(env, actor, 'YANGO_SETTINGS', null, `${tiers.length} goals, share ${n.yangoGoal.sharePct}%`)]);
    return J({ ok: true });
  }

  // ---- v4.9 ⭐ passenger feedback (staff) ----
  if (path === '/api/feedback' && m === 'GET') {
    if (!staff || !canAny('opsDash', 'assign', 'vehicles', 'incidents')) return deny();
    const to = isDay(url.searchParams.get('to') || '') ? url.searchParams.get('to') : addisDate(0), from = isDay(url.searchParams.get('from') || '') ? url.searchParams.get('from') : dAdd(to, -30);
    const rs = (await env.DB.prepare('SELECT f.*, d.name FROM feedback f LEFT JOIN drivers d ON d.id=f.driver_id WHERE f.fdate>=? AND f.fdate<=? ORDER BY f.id DESC LIMIT 1000').bind(from, to).all()).results;
    const avg = (key) => { const o = {}; for (const r of rs) { const k = r[key] ?? ''; const x = o[k] ||= { n: 0, sum: 0, complaints: 0, name: key === 'driver_id' ? r.name || '—' : k }; x.n++; x.sum += r.stars; x.complaints += r.complaint; }
      return Object.values(o).map(x => ({ name: x.name, n: x.n, avg: r1(x.sum / x.n), complaints: x.complaints })).sort((a, b) => a.avg - b.avg); };
    return J({ from, to, tags: FB_TAGS, total: { n: rs.length, avg: rs.length ? r1(rs.reduce((a, r) => a + r.stars, 0) / rs.length) : null, complaints: rs.filter(r => r.complaint).length, open: rs.filter(r => r.complaint && r.status === 'new').length },
      byVehicle: avg('plate'), byDriver: avg('driver_id'), canCodes: canAny('vehicles'),
      list: rs.map(r => ({ id: r.id, plate: r.plate, driver: r.name || '', date: r.fdate, at: r.at, stars: r.stars, tags: r.tags ? r.tags.split(',') : [], text: r.text, phone: r.phone, complaint: !!r.complaint, status: r.status, handledBy: r.handled_by || '', note: r.note || '' })) });
  }
  const fbId = path.match(/^\/api\/feedback\/(\d+)$/);
  if (fbId && m === 'PUT') {
    if (!canAny('opsDash', 'assign', 'vehicles', 'incidents')) return deny();
    const st = ['new', 'seen', 'done'].includes(body.status) ? body.status : 'done', note = String(body.note || '').trim().slice(0, 300);
    await env.DB.batch([env.DB.prepare('UPDATE feedback SET status=?, handled_by=?, note=? WHERE id=?').bind(st, actor, note, +fbId[1]), auditStmt(env, actor, 'FEEDBACK', null, `#${fbId[1]} ${st} ${note}`)]);
    return J({ ok: true });
  }
  if (path === '/api/feedback/codes' && (m === 'GET' || m === 'POST')) {
    if (!can('vehicles')) return deny();
    if (m === 'POST') { // a new code for one vehicle (the old QR stops working)
      const pl = String(body.plate || '').toUpperCase(); if (!(await env.DB.prepare('SELECT 1 x FROM vehicles WHERE plate=?').bind(pl).first())) return fail('Unknown vehicle');
      await env.DB.batch([env.DB.prepare('UPDATE vehicles SET fb_code=? WHERE plate=?').bind(hex(crypto.getRandomValues(new Uint8Array(6))), pl), auditStmt(env, actor, 'FEEDBACK_QR', null, `${pl}: new QR code`)]);
    }
    for (const v of (await env.DB.prepare("SELECT plate FROM vehicles WHERE fb_code=''").all()).results) await env.DB.prepare('UPDATE vehicles SET fb_code=? WHERE plate=?').bind(hex(crypto.getRandomValues(new Uint8Array(6))), v.plate).run();
    return J({ origin: url.origin, codes: (await env.DB.prepare('SELECT plate, mode, fb_code FROM vehicles ORDER BY plate').all()).results.map(v => ({ plate: v.plate, mode: v.mode || 'any', code: v.fb_code })) });
  }

  // ---- v4.9 📄 documents ----
  if (path === '/api/docs' && m === 'GET') {
    if (!staff || !canAny('vehicles', 'assign')) return deny();
    const today = addisDate(0), types = cfg.docTypes || DEF.docTypes;
    const docs = (await env.DB.prepare('SELECT d.*, (SELECT group_concat(slot) FROM doc_photos p WHERE p.doc_id=d.id) slots FROM documents d').all()).results;
    const drivers = (await env.DB.prepare('SELECT id, name FROM drivers WHERE active=1 ORDER BY name').all()).results, vehicles = (await env.DB.prepare('SELECT plate, mode FROM vehicles ORDER BY plate').all()).results;
    return J({ today, types, canEdit: can('vehicles'), canPermit: admin, drivers, vehicles: vehicles.map(v => ({ plate: v.plate, mode: v.mode || 'any' })),
      docs: docs.map(d => ({ id: d.id, ownerKind: d.owner_kind, ownerId: d.owner_id, type: d.type, number: d.number, expires: d.expires, days: dDiff(today, d.expires), photoOk: !!d.photo_ok,
        photos: String(d.slots || '').split(',').filter(Boolean), permitUntil: d.permit_until || '', permitReason: d.permit_reason || '', permitBy: d.permit_by || '', updatedBy: d.updated_by, updatedAt: d.updated_at })) });
  }
  if (path === '/api/docs' && m === 'PUT') {
    if (!can('vehicles')) return deny();
    const kind = body.ownerKind === 'vehicle' ? 'vehicle' : body.ownerKind === 'driver' ? 'driver' : null, oid = String(body.ownerId || '').toUpperCase().slice(0, 30), type = String(body.type || '');
    if (!kind) return fail('Driver or vehicle?');
    if (!(cfg.docTypes || DEF.docTypes).some(t => t.id === type && t.for === kind)) return fail('Unknown document type');
    if (kind === 'driver' ? !(await env.DB.prepare('SELECT 1 x FROM drivers WHERE id=?').bind(+oid).first()) : !(await env.DB.prepare('SELECT 1 x FROM vehicles WHERE plate=?').bind(oid).first())) return fail('Unknown driver / vehicle');
    const exp = String(body.expires || ''); if (!isDay(exp)) return fail('የሚያበቃበትን ቀን ያስገቡ (Expiry date)');
    const ex = await env.DB.prepare('SELECT * FROM documents WHERE owner_kind=? AND owner_id=? AND type=?').bind(kind, oid, type).first(), t = now(), number = String(body.number || '').trim().slice(0, 40);
    const renewed = !ex || ex.expires !== exp;
    if (ex) await env.DB.prepare(`UPDATE documents SET number=?, expires=?, ${renewed ? 'photo_ok=0, permit_until=NULL, permit_reason=NULL, permit_by=NULL,' : ''} updated_by=?, updated_at=? WHERE id=?`).bind(number, exp, actor, t, ex.id).run();
    else await env.DB.prepare('INSERT INTO documents(owner_kind,owner_id,type,number,expires,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').bind(kind, oid, type, number, exp, actor, t).run();
    const id = ex ? ex.id : (await env.DB.prepare('SELECT id FROM documents WHERE owner_kind=? AND owner_id=? AND type=?').bind(kind, oid, type).first()).id;
    await audit(env, actor, 'DOC_SAVE', null, `${kind} ${oid} ${type} ${number} → ${exp}${ex && renewed ? ` (was ${ex.expires})` : ''}`);
    return J({ ok: true, id, needPhoto: renewed });
  }
  const docPh = path.match(/^\/api\/docs\/(\d+)\/photo$/);
  if (docPh) {
    if (!staff || !canAny('vehicles', 'assign')) return deny();
    const d = await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(+docPh[1]).first(); if (!d) return fail('Not found', 404);
    if (m === 'PUT') {
      if (!can('vehicles')) return deny();
      const mime = (req.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return fail('Photo must be JPEG, PNG or WebP');
      const buf = await req.arrayBuffer(); if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return fail('Photo too large', 413);
      const cur = await env.DB.prepare("SELECT expires FROM doc_photos WHERE doc_id=? AND slot='cur'").bind(d.id).first();
      const st = [];
      if (cur && cur.expires !== d.expires) st.push(env.DB.prepare("DELETE FROM doc_photos WHERE doc_id=? AND slot='prev'").bind(d.id), env.DB.prepare("UPDATE doc_photos SET slot='prev' WHERE doc_id=? AND slot='cur'").bind(d.id)); // keep the copy before the renewal
      st.push(env.DB.prepare("INSERT INTO doc_photos(doc_id,slot,mime,data,expires,created_at) VALUES(?,'cur',?,?,?,?) ON CONFLICT(doc_id,slot) DO UPDATE SET mime=excluded.mime,data=excluded.data,expires=excluded.expires,created_at=excluded.created_at").bind(d.id, mime, buf, d.expires, now()),
        env.DB.prepare('UPDATE documents SET photo_ok=1 WHERE id=?').bind(d.id));
      await env.DB.batch(st);
      return J({ ok: true });
    }
    if (m === 'GET') {
      const ph = await env.DB.prepare('SELECT mime,data FROM doc_photos WHERE doc_id=? AND slot=?').bind(d.id, url.searchParams.get('slot') === 'prev' ? 'prev' : 'cur').first();
      if (!ph) return fail('No photo', 404);
      return new Response(ph.data instanceof ArrayBuffer || ArrayBuffer.isView(ph.data) ? ph.data : new Uint8Array(ph.data), { headers: { 'content-type': ph.mime, 'cache-control': 'private, max-age=600' } });
    }
  }
  const docPm = path.match(/^\/api\/docs\/(\d+)\/permit$/);
  if (docPm && (m === 'POST' || m === 'DELETE')) {
    if (!admin) return deny();
    const d = await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(+docPm[1]).first(); if (!d) return fail('Not found', 404);
    if (m === 'DELETE') { await env.DB.batch([env.DB.prepare('UPDATE documents SET permit_until=NULL, permit_reason=NULL, permit_by=NULL WHERE id=?').bind(d.id), auditStmt(env, actor, 'DOC_PERMIT_END', null, `${d.owner_kind} ${d.owner_id} ${d.type}`)]); return J({ ok: true }); }
    const until = String(body.until || ''), reason = String(body.reason || '').trim().slice(0, 200);
    if (!isDay(until) || until < addisDate(0)) return fail('Until which day? (እስከ መቼ)');
    if (dDiff(addisDate(0), until) > 30) return fail('At most 30 days');
    if (reason.length < 5) return fail('ምክንያት ይጻፉ (Write the reason)');
    await env.DB.batch([env.DB.prepare('UPDATE documents SET permit_until=?, permit_reason=?, permit_by=? WHERE id=?').bind(until, reason, actor, d.id),
      auditStmt(env, actor, 'DOC_PERMIT', null, `${d.owner_kind} ${d.owner_id} ${d.type} expired ${d.expires} — allowed until ${until}: ${reason}`)]);
    bg(notify(env, cfg, 'docs', `📄 👑 ${actor}፦ ጊዜው ያለፈበት ${d.type} (${d.owner_kind === 'driver' ? 'driver #' + d.owner_id : d.owner_id}) እስከ ${until} ስራ እንዲቀጥል ፈቅዷል — ${reason}`));
    return J({ ok: true });
  }

  // ---- v4.9 🟣 Cabby Reserve runs ----
  const rsvOut = (r, bk = []) => ({ id: r.id, plate: r.plate, date: r.rdate, shiftNo: r.shift_no, driverId: r.driver_id, driver: r.name || '', status: r.status, startAt: r.start_at, endAt: r.end_at,
    place: r.place || '', startKm: r.start_km, endKm: r.end_km, km: r.end_km != null && r.start_km != null ? r1(r.end_km - r.start_km) : null, estKm: r.est_km, battery: r.battery, pax: r.pax, note: r.note,
    start: r.lat != null ? { lat: r.lat, lng: r.lng } : null, end: r.end_lat != null ? { lat: r.end_lat, lng: r.end_lng } : null, gpsKm: r.lat != null && r.end_lat != null ? r1(gpsKm(r.lat, r.lng, r.end_lat, r.end_lng)) : null,
    bookings: bk.map(b => ({ ref: b.ref, at: b.at, pax: b.pax, amount: b.amount, plan: b.plan, status: b.status })) });
  if (path === '/api/reserve/me' && m === 'GET') {
    if (staff) return deny();
    const rs = (await env.DB.prepare('SELECT * FROM reserve_runs WHERE driver_id=? AND rdate>=? ORDER BY id DESC LIMIT 30').bind(myDriver.id, addisDate(1)).all()).results;
    const plate = await plateFor(env, myDriver.id, addisDate(0)), v = plate ? await env.DB.prepare('SELECT seats, mode FROM vehicles WHERE plate=?').bind(plate).first() : null;
    return J({ runs: rs.map(r => rsvOut(r)), plate, seats: v?.seats ?? 4, mode: v?.mode || 'any',
      rules: Object.fromEntries(['reserveRangeKm', 'reserveBattMarginPct', 'reserveBonusPerRun'].map(k => [k, num(cfg[k])])) });
  }
  if (path === '/api/reserve' && m === 'POST') { // ▶ start (place, GPS, odometer, battery, rough total KM) · 🏁 end (GPS, odometer, passengers in all) · cancel
    if (staff) return deny();
    const act = String(body.action || ''), t = now(), today = addisDate(0), g = cleanGeo(body.geo);
    if (act === 'start') {
      const open = await env.DB.prepare("SELECT id FROM reserve_runs WHERE driver_id=? AND status='run'").bind(myDriver.id).first();
      if (open) return fail('🟣 ያልተጨረሰ ሪዘርቭ አለ — መጀመሪያ ይጨርሱት (Finish the open run first)', 409);
      const shiftNo = Math.floor(num(body.shiftNo)) || 1, plate = (await plateFor(env, myDriver.id, today, shiftNo)) || await plateFor(env, myDriver.id, today);
      if (!plate) return fail('No vehicle is assigned to you today (ለዛሬ መኪና አልተመደበልዎትም)');
      const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
      if (v.mode === 'route') return fail('Cabby Reserve is for Cabby vehicles (🔵 ካቢ)');
      if ((v.status || 'ok') !== 'ok') return fail(`⏸ ${plate} ከስራ ውጭ ነው (vehicle off the road)`, 409);
      const place = String(body.place || '').trim().slice(0, 60), est = Math.max(0, num(body.estKm)), km = num(body.km), batt = String(body.battery ?? '') === '' ? null : Math.min(100, Math.max(0, num(body.battery)));
      if (!place) return fail('መነሻው የት ነው? (Where does the run start?)');
      if (!(est > 0)) return fail('ጉዞው በግምት ስንት ኪ.ሜ ነው? (Rough total KM of the run)');
      if (!(km > 0)) return fail('የኦዶሜትሩን ኪ.ሜ ያስገቡ (Odometer KM)');
      if (batt == null) return fail('የባትሪውን መጠን ያስገቡ (Battery %)');
      if (est > num(cfg.reserveRangeKm)) return fail(`📏 ${est} ኪ.ሜ ከመኪናው አቅም (${cfg.reserveRangeKm} ኪ.ሜ) በላይ ነው — ፍሊትን ያነጋግሩ (beyond the vehicle's range)`);
      const need = Math.min(100, Math.ceil(est / num(cfg.reserveRangeKm) * 100 * (1 + num(cfg.reserveBattMarginPct) / 100)));
      if (batt < need && !body.force) return J({ ok: false, need, battery: batt, error: `🔋 ባትሪው በቂ አይደለም፦ ለ${est} ኪ.ሜ ቢያንስ ${need}% ያስፈልጋል (${batt}% አለ)። መጀመሪያ ቻርጅ ያድርጉ። (Battery too low: ${need}% needed)` }, 409);
      const r = await env.DB.prepare("INSERT INTO reserve_runs(plate,rdate,shift_no,driver_id,status,start_at,start_km,est_km,battery,place,lat,lng,created_at) VALUES(?,?,?,?,'run',?,?,?,?,?,?,?,?)")
        .bind(plate, today, shiftNo, myDriver.id, t, km, est, batt, place, g?.lat ?? null, g?.lng ?? null, t).run();
      await audit(env, actor, 'RESERVE_START', null, `${plate} from ${place}, ~${est} km, battery ${batt}%${batt < need ? ` (below ${need}% — driver went on)` : ''}${g ? '' : ' · no GPS'}`);
      if (batt < need) bg(notify(env, cfg, 'shiftAlert', `🟣🔋 ${myDriver.name} (${plate}) ሪዘርቭ በዝቅተኛ ባትሪ ጀመረ፦ ${batt}% (ያስፈልግ የነበረው ${need}%) · ~${est} ኪ.ሜ · ${place}`));
      return J({ ok: true, id: r.meta.last_row_id, need, gps: !!g });
    }
    const run = await env.DB.prepare('SELECT * FROM reserve_runs WHERE id=? AND driver_id=?').bind(+body.id, myDriver.id).first();
    if (!run) return fail('Not found', 404);
    if (act === 'end') {
      if (run.status !== 'run') return fail('Already finished');
      const ek = num(body.km), pax = Math.floor(num(body.pax));
      if (!(ek >= num(run.start_km))) return fail(`የመጨረሻው ኪ.ሜ ከመነሻው (${run.start_km}) ያነሰ ሊሆን አይችልም (End KM below the start)`);
      if (ek - num(run.start_km) > num(cfg.reserveRangeKm)) return fail('ኪ.ሜው በጣም ብዙ ነው — ይፈትሹ (Too many KM for one run)');
      if (!(pax > 0) || pax > 200) return fail('በጠቅላላ ስንት ተሳፋሪ ጫኑ? (Passengers in all)');
      const out = r1(ek - num(run.start_km));
      await env.DB.prepare("UPDATE reserve_runs SET status='done', end_at=?, end_km=?, pax=?, allow_km=?, end_lat=?, end_lng=? WHERE id=?").bind(t, ek, pax, out, g?.lat ?? null, g?.lng ?? null, run.id).run();
      const gk = run.lat != null && g ? r1(gpsKm(run.lat, run.lng, g.lat, g.lng)) : null;
      await audit(env, actor, 'RESERVE_END', null, `${run.plate} ${out} km, ${pax} pax${gk != null ? `, ${gk} km straight start→end` : ' · no GPS'}`);
      return J({ ok: true, km: out, gpsKm: gk });
    }
    if (act === 'cancel') {
      if (run.status !== 'run') return fail('Already finished');
      await env.DB.prepare("UPDATE reserve_runs SET status='cancel', end_at=?, note=? WHERE id=?").bind(t, String(body.note || 'cancelled').slice(0, 200), run.id).run();
      await audit(env, actor, 'RESERVE_CANCEL', null, `${run.plate} from ${run.place}`);
      return J({ ok: true });
    }
    return fail('Unknown action');
  }
  if (path === '/api/reserve' && m === 'GET') {
    if (!staff || !canAny('opsDash', 'platform', 'payments', 'reports', 'assign')) return deny();
    const from = isDay(url.searchParams.get('from') || '') ? url.searchParams.get('from') : addisDate(30), to = isDay(url.searchParams.get('to') || '') ? url.searchParams.get('to') : addisDate(0);
    const runs = (await env.DB.prepare("SELECT r.*, d.name FROM reserve_runs r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.rdate>=? AND r.rdate<=? AND r.status IN ('run','done') ORDER BY r.rdate DESC, r.id DESC LIMIT 1000").bind(from, to).all()).results;
    const bks = runs.length ? (await env.DB.prepare(`SELECT * FROM reserve_bookings WHERE run_id IN (${runs.map(() => '?').join(',')})`).bind(...runs.map(r => r.id)).all()).results : [];
    const orphan = (await env.DB.prepare("SELECT * FROM reserve_bookings WHERE run_id IS NULL AND substr(at,1,10)>=? AND substr(at,1,10)<=? ORDER BY at DESC LIMIT 500").bind(from, to).all()).results;
    const out = runs.map(r => { const bk = bks.filter(b => b.run_id === r.id), o = rsvOut(r, bk), bp = bk.filter(b => b.status !== 'cancel').reduce((a, b) => a + num(b.pax), 0);
      return { ...o, bookingPax: bp, paxMismatch: r.status === 'done' && bk.length > 0 && bp !== num(r.pax), amount: r2(bk.reduce((a, b) => a + num(b.amount), 0)) }; });
    const done = out.filter(r => r.status === 'done');
    return J({ from, to, runs: out, unmatchedBookings: orphan.map(b => ({ ref: b.ref, at: b.at, plate: b.plate, pax: b.pax, amount: b.amount, status: b.status, plan: b.plan })),
      totals: { runs: done.length, pax: done.reduce((a, r) => a + num(r.pax), 0), km: r1(done.reduce((a, r) => a + num(r.km), 0)), bookings: bks.length, noShow: [...bks, ...orphan].filter(b => b.status === 'noshow').length,
        matched: done.filter(r => r.bookings.length).length, runsNoBooking: done.filter(r => !r.bookings.length).length, bookingsNoRun: orphan.length, paxMismatch: out.filter(r => r.paxMismatch).length,
        payout: r2(bks.reduce((a, b) => a + num(b.amount), 0) + orphan.reduce((a, b) => a + num(b.amount), 0)) } });
  }
  // Cabby's monthly reserve report (rows read on the phone/computer): each booking is matched to a run by vehicle and time
  if (path === '/api/reserve/import' && m === 'POST') {
    if (!canAny('platform', 'payments')) return deny();
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : [], t = now();
    const plates = (await env.DB.prepare('SELECT plate FROM vehicles').all()).results.map(v => v.plate), pm = new Map(plates.map(p => [normPlate(p), p]));
    let added = 0, updated = 0, bad = 0;
    for (const x of rows) {
      const ref = String(x.ref || '').trim().slice(0, 60), at = String(x.at || '').trim().replace('T', ' ').slice(0, 16), plate = pm.get(normPlate(x.plate));
      if (!ref || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at) || !plate) { bad++; continue; }
      const st = /no.?show/i.test(x.status || '') ? 'noshow' : /cancel|refund/i.test(x.status || '') ? 'cancel' : 'done';
      const ex = await env.DB.prepare('SELECT id FROM reserve_bookings WHERE ref=?').bind(ref).first();
      if (ex) { await env.DB.prepare('UPDATE reserve_bookings SET at=?, plate=?, pax=?, amount=?, status=?, plan=? WHERE id=?').bind(at, plate, Math.max(0, Math.floor(num(x.pax))), num(x.amount), st, String(x.plan || '').slice(0, 30), ex.id).run(); updated++; }
      else { await env.DB.prepare('INSERT INTO reserve_bookings(ref,at,plate,pax,amount,status,plan,by_actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(ref, at, plate, Math.max(0, Math.floor(num(x.pax))), num(x.amount), st, String(x.plan || '').slice(0, 30), actor, t).run(); added++; }
    }
    // match: same vehicle; the booking's time inside the run (from reserveMatchMin before its start to its end), else the nearest start within reserveMatchMin. A run can hold many bookings.
    const open = (await env.DB.prepare('SELECT * FROM reserve_bookings WHERE run_id IS NULL').all()).results;
    let matched = 0;
    for (const b of open) {
      const bt = Date.parse(b.at.replace(' ', 'T') + ':00Z') - 3 * 36e5, win = num(cfg.reserveMatchMin) * 60000;
      const cands = (await env.DB.prepare("SELECT * FROM reserve_runs WHERE plate=? AND rdate>=? AND rdate<=? AND status='done'").bind(b.plate, dAdd(b.at.slice(0, 10), -1), dAdd(b.at.slice(0, 10), 1)).all()).results
        .map(r => { const st = Date.parse(r.start_at), en = Date.parse(r.end_at || r.start_at); return { r, inside: bt >= st - win && bt <= en, d: Math.abs(st - bt) }; })
        .filter(c => c.inside || c.d <= win).sort((a, c) => (c.inside - a.inside) || a.d - c.d);
      if (cands.length) { await env.DB.prepare('UPDATE reserve_bookings SET run_id=? WHERE id=?').bind(cands[0].r.id, b.id).run(); matched++; }
    }
    await audit(env, actor, 'RESERVE_IMPORT', null, `${added} new, ${updated} updated, ${bad} unreadable, ${matched} matched`);
    return J({ ok: true, added, updated, bad, matched });
  }

  // ---- v4.9 📋 shift inspection / handover ----
  if (path === '/api/inspections/me' && m === 'GET') {
    if (staff) return deny();
    const today = addisDate(0), mode0 = url.searchParams.get('mode') === 'route' ? 'route' : 'cabby';
    let shiftNo = Math.floor(num(url.searchParams.get('shift'))) || 0;
    const plate = (shiftNo && await plateFor(env, myDriver.id, today, shiftNo)) || await plateFor(env, myDriver.id, today);
    if (!plate) return J({ plate: null });
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first(), grp = v.mode === 'route' ? 'route' : v.mode === 'cabby' ? 'cabby' : mode0;
    if (!shiftNo || !shiftDef(cfg, grp, shiftNo)) shiftNo = shiftAt(cfg, grp, new Date(Date.now() + 3 * 36e5).toISOString().slice(11, 16));
    const insp = await env.DB.prepare('SELECT * FROM inspections WHERE plate=? AND idate=? AND shift_no=?').bind(plate, today, shiftNo).first();
    const prevIn = shiftNo > 1 ? await env.DB.prepare('SELECT driver_id FROM inspections WHERE plate=? AND idate=? AND shift_no=?').bind(plate, today, shiftNo - 1).first() : null;
    const outDid = shiftNo > 1 ? (prevIn?.driver_id ?? await driverFor(env, plate, today, shiftNo - 1)) : null;
    const outName = outDid != null && outDid !== myDriver.id ? (await env.DB.prepare('SELECT name FROM drivers WHERE id=?').bind(outDid).first())?.name || '' : '';
    const prevRep = await env.DB.prepare("SELECT calc FROM shifts WHERE plate=? AND shift_date=? AND shift_no<? AND status IN ('PENDING','APPROVED') ORDER BY shift_no DESC LIMIT 1").bind(plate, today, shiftNo).first();
    return J({ plate, date: today, shiftNo, shifts: shiftDefs(cfg, grp), inspection: inspOut(insp), handoverFrom: outName, sameDriver: outDid === myDriver.id,
      expectedKm: prevRep ? num(JSON.parse(prevRep.calc).endKm) : num(v.next_start_km), items: Object.fromEntries(Object.entries(INSP_ITEMS).map(([k, x]) => [k, { l: x.l, serious: !!x.serious }])), vehicleStatus: v.status || 'ok' });
  }
  if (path === '/api/inspections' && m === 'POST') {
    if (staff) return deny();
    const today = addisDate(0), mode0 = body.mode === 'route' ? 'route' : 'cabby';
    let shiftNo = Math.floor(num(body.shiftNo)) || 1;
    const plate = (await plateFor(env, myDriver.id, today, shiftNo)) || await plateFor(env, myDriver.id, today);
    if (!plate) return fail('No vehicle is assigned to you today (ለዛሬ መኪና አልተመደበልዎትም)');
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first(), grp = v.mode === 'route' ? 'route' : v.mode === 'cabby' ? 'cabby' : mode0;
    const sd = shiftDef(cfg, grp, shiftNo); if (!sd) return fail('Unknown shift');
    if ((v.status || 'ok') !== 'ok') return fail(`⏸ ${plate} ከስራ ውጭ ነው — ፍሊት አድሚኑን ያነጋግሩ (vehicle off the road)`, 409);
    const ro = await env.DB.prepare("SELECT r.driver_id, d.name FROM roster r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.rdate=? AND r.plate=? AND r.shift_no=? AND r.kind='work'").bind(today, plate, shiftNo).first();
    if (ro && ro.driver_id != null && ro.driver_id !== myDriver.id) return fail(`📅 ይህ ፈረቃ ለ${ro.name || 'ሌላ ሹፌር'} ተመድቧል (This shift is planned for another driver)`);
    const planned = !!(ro && ro.driver_id === myDriver.id); // lateness and overtime count only against the plan
    { const dl = await docBlocks(env, cfg, myDriver.id, plate, today); if (dl.length) return fail(docBlockMsg(dl), 409); }
    const km = num(body.km), batt = num(body.battery), items = body.items && typeof body.items === 'object' ? body.items : {};
    if (!(km > 0)) return fail('የኦዶሜትሩን ኪ.ሜ ያስገቡ (Enter the odometer KM)');
    if (String(body.battery ?? '') === '' || batt < 0 || batt > 100) return fail('የባትሪውን መጠን ያስገቡ (Battery %)');
    const res = {};
    for (const k of Object.keys(INSP_ITEMS)) { const x = items[k]; if (!['ok', 'bad', 'missing'].includes(x)) return fail(`📋 ${INSP_ITEMS[k].l} — ✅ ወይም ⚠️ ይምረጡ`); res[k] = x; }
    const note = String(body.note || '').trim().slice(0, 500), bad = Object.keys(res).filter(k => res[k] !== 'ok');
    if (bad.length && note.length < 3) return fail('ችግሩን በአጭሩ ይጻፉ (Write what is wrong)');
    const ex = await env.DB.prepare('SELECT * FROM inspections WHERE plate=? AND idate=? AND shift_no=?').bind(plate, today, shiftNo).first();
    if (ex && (ex.driver_id !== myDriver.id || Date.now() - Date.parse(ex.at) > 30 * 60e3)) return fail('📋 የዚህ ፈረቃ ፍተሻ ተደርጓል (This shift is already inspected)');
    // handover: the driver of the shift before (if it is someone else)
    const prevIn = shiftNo > 1 ? await env.DB.prepare('SELECT driver_id FROM inspections WHERE plate=? AND idate=? AND shift_no=?').bind(plate, today, shiftNo - 1).first() : null;
    let outDid = shiftNo > 1 ? (prevIn?.driver_id ?? await driverFor(env, plate, today, shiftNo - 1)) : null;
    if (outDid === myDriver.id) outDid = null;
    const nowM = addisMin(), late = nowM - hmMin(sd.start), grace = num(cfg.handoverGraceMin);
    const lateMin = planned && late > grace ? late : 0, otMin = planned && outDid != null && late > grace ? late : 0;
    const prevRep = await env.DB.prepare("SELECT calc FROM shifts WHERE plate=? AND shift_date=? AND shift_no<? AND status IN ('PENDING','APPROVED') ORDER BY shift_no DESC LIMIT 1").bind(plate, today, shiftNo).first();
    const kmExp = prevRep ? num(JSON.parse(prevRep.calc).endKm) : num(v.next_start_km), kmOff = Math.abs(km - kmExp) > 1;
    const serious = bad.some(k => INSP_ITEMS[k].serious), status = serious ? 'held' : (bad.length || kmOff) ? 'issue' : 'ok';
    const g = cleanGeo(body.geo); if (g) env._ri.geo = `${g.lat},${g.lng}`;
    const vals = [plate, today, shiftNo, myDriver.id, outDid, km, kmExp, batt, JSON.stringify(res), note, serious ? 1 : 0, status, lateMin, otMin, g?.lat ?? null, g?.lng ?? null, now()];
    const st = [ex ? env.DB.prepare('UPDATE inspections SET plate=?,idate=?,shift_no=?,driver_id=?,out_driver_id=?,km=?,km_expected=?,battery=?,items=?,note=?,serious=?,status=?,late_min=?,ot_min=?,lat=?,lng=?,at=? WHERE id=?').bind(...vals, ex.id)
      : env.DB.prepare('INSERT INTO inspections(plate,idate,shift_no,driver_id,out_driver_id,km,km_expected,battery,items,note,serious,status,late_min,ot_min,lat,lng,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...vals)];
    if (serious) st.push(env.DB.prepare("UPDATE vehicles SET status='hold', status_since=?, repair_until='', status_note=? WHERE plate=?").bind(today, `📋 ${bad.filter(k => INSP_ITEMS[k].serious).map(k => INSP_ITEMS[k].l).join(', ')}`.slice(0, 120), plate));
    const lbl = bad.map(k => `${INSP_ITEMS[k].l}${res[k] === 'missing' ? ' (የለም)' : ''}`).join(', ');
    st.push(auditStmt(env, actor, 'INSPECTION', null, `${plate} ${sd.name} ${status}${lbl ? ' · ' + lbl : ''}${kmOff ? ` · KM ${km} vs ${kmExp}` : ''}${lateMin ? ` · late ${lateMin} min` : ''}`.slice(0, 900)));
    const r0 = await env.DB.batch(st), id = ex ? ex.id : r0[0].meta.last_row_id;
    const outName = outDid != null ? (await env.DB.prepare('SELECT name FROM drivers WHERE id=?').bind(outDid).first())?.name || '' : '';
    const head = `📋 *${plate} · ${sd.name}* — ${myDriver.name}${outName ? ` ከ${outName} ተረከበ` : ''}`;
    if (status !== 'ok') bg(notify(env, cfg, 'inspection', [head, lbl ? `⚠️ ${lbl}` : '', note ? `📝 ${note}` : '', kmOff ? `🔢 ኪ.ሜ ${km} — የሚጠበቀው ${kmExp}` : '', serious ? '⏸ መኪናው ፍሊት እስኪወስን ቆሟል — ✅ ወደ ስራ ወይም 🔧 ጥገና ብለው ይወስኑ' : ''].filter(Boolean).join('\n')));
    if (serious) bg(notify(env, cfg, 'vehicleHold', `⏸ ${plate} በፍተሻ ቆሟል (${bad.filter(k => INSP_ITEMS[k].serious).map(k => INSP_ITEMS[k].l).join(', ')}) — ${myDriver.name}`));
    if (outDid != null && (bad.length || kmOff)) bg(notifyDriver(env, outDid, 'handover', `🔁 *የመረካከቢያ ፍተሻ* — ${plate}\n${myDriver.name} ተረክቦ የሚከተለውን መዝግቧል፦ ${lbl || ''}${kmOff ? ` · ኪ.ሜ ${km}` : ''}${note ? `\n📝 ${note}` : ''}`));
    if (otMin > 0) bg(notifyDriver(env, outDid, 'handover', `⏰ ${plate}፦ ተረኛው ${otMin} ደቂቃ ዘግይቶ ደርሷል — ${otMin} ደቂቃ ትርፍ ሰዓት ተመዝግቦልዎታል።`));
    if (lateMin > 0) bg(notify(env, cfg, 'inspection', `⏰ ${myDriver.name} (${plate} · ${sd.name}) ${lateMin} ደቂቃ ዘግይቶ ጀመረ${outName ? ` — ${outName} ትርፍ ሰዓት ሰርቷል` : ''}`));
    return J({ ok: true, id, status, lateMin, otMin, kmExpected: kmExp, kmOff, held: serious });
  }
  if (path === '/api/inspections' && m === 'GET') {
    if (!staff || !canAny('opsDash', 'incidents', 'approve', 'photos', 'vehicles')) return deny();
    const date = isDay(url.searchParams.get('date') || '') ? url.searchParams.get('date') : addisDate(0);
    const rows = (await env.DB.prepare(`SELECT i.*, d.name dname, o.name oname, v.mode vmode, (SELECT group_concat(side) FROM inspection_photos p WHERE p.insp_id=i.id) photos FROM inspections i
      LEFT JOIN drivers d ON d.id=i.driver_id LEFT JOIN drivers o ON o.id=i.out_driver_id LEFT JOIN vehicles v ON v.plate=i.plate WHERE i.idate=? ORDER BY i.plate, i.shift_no`).bind(date).all()).results;
    return J({ date, items: Object.fromEntries(Object.entries(INSP_ITEMS).map(([k, x]) => [k, x.l])), list: rows.map(r => ({ ...inspOut(r), shiftName: shiftDef(cfg, r.vmode === 'route' ? 'route' : 'cabby', r.shift_no)?.name || '', driver: r.dname || '', outDriver: r.oname || '', photos: r.photos ? String(r.photos).split(',') : [] })),
      missing: await inspMissing(env, cfg, date), graceMin: num(cfg.handoverGraceMin) });
  }
  const inspPh = path.match(/^\/api\/inspections\/(\d+)\/photo$/);
  if (inspPh) {
    const ins = await env.DB.prepare('SELECT * FROM inspections WHERE id=?').bind(+inspPh[1]).first(), side = url.searchParams.get('side');
    if (!ins || (!staff && ins.driver_id !== myDriver.id)) return fail('Not found', 404);
    if (!INSP_SIDES.includes(side)) return fail('side must be front, back, left or right');
    if (m === 'PUT') {
      if (staff) return deny();
      if (Date.now() - Date.parse(ins.at) > 3 * 3600e3) return fail('Photos can be added within 3 hours');
      const mime = (req.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return fail('Photo must be JPEG, PNG or WebP');
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return fail('Photo too large', 413);
      await env.DB.prepare('INSERT INTO inspection_photos(insp_id,side,mime,data,created_at) VALUES(?,?,?,?,?) ON CONFLICT(insp_id,side) DO UPDATE SET mime=excluded.mime,data=excluded.data,created_at=excluded.created_at').bind(ins.id, side, mime, buf, now()).run();
      return J({ ok: true });
    }
    if (m === 'GET') {
      if (staff && !canAny('opsDash', 'incidents', 'approve', 'photos', 'vehicles')) return deny();
      const ph = await env.DB.prepare('SELECT mime,data FROM inspection_photos WHERE insp_id=? AND side=?').bind(ins.id, side).first();
      if (!ph) return fail('No photo', 404);
      return new Response(ph.data instanceof ArrayBuffer || ArrayBuffer.isView(ph.data) ? ph.data : new Uint8Array(ph.data), { headers: { 'content-type': ph.mime, 'cache-control': 'private, max-age=600' } });
    }
  }

  // ---- v4.3: incidents (🚨). Accident, breakdown or injury puts the vehicle "⏸ under review" until the Fleet Admin decides ----
  const incOut = r => {
    const phNums = r.photos ? String(r.photos).split(',').map(Number) : [];
    return { id: r.id, plate: r.plate, driverId: r.driver_id, date: r.idate, kind: r.kind, kindLabel: INC_KINDS[r.kind]?.l || r.kind, note: r.note, geo: r.lat != null ? { lat: r.lat, lng: r.lng, acc: r.acc } : null,
      status: r.status, by: r.by_actor, createdAt: r.created_at, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolution: r.resolution, photos: phNums.filter(n => n >= 1 && n <= 3), hasAudio: phNums.includes(9) };
  };
  if (path === '/api/incidents' && m === 'POST') {
    if (staff && !admin) return deny();
    const kind = INC_KINDS[body.kind] ? body.kind : null;
    if (!kind) return fail('Pick what happened (ምን እንደተከሰተ ይምረጡ)');
    const plate = staff ? String(body.plate || '').toUpperCase() : me.plate;
    if (!plate) return fail('No vehicle is assigned to you today (ለዛሬ መኪና አልተመደበልዎትም)');
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    if (!v) return fail('Unknown vehicle');
    const note = String(body.note || '').trim().slice(0, 500), g = cleanGeo(body.geo), today = addisDate(0);
    if (kind === 'other' && note.length < 3 && !body.hasAudio) return fail('Write or record what happened (ምን እንደተከሰተ ይጻፉ ወይም በድምጽ ይቅዱ)');
    if (g) env._ri.geo = `${g.lat},${g.lng}`;
    const did = staff ? await driverFor(env, plate, today) : myDriver.id, dname = staff ? ((await env.DB.prepare('SELECT name FROM drivers WHERE id=?').bind(did ?? -1).first())?.name || v.driver) : myDriver.name;
    const res = await env.DB.prepare('INSERT INTO incidents(plate,driver_id,idate,kind,note,lat,lng,acc,by_actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(plate, did, today, kind, note, g?.lat ?? null, g?.lng ?? null, g?.acc ?? null, actor, now()).run();
    const id = res.meta.last_row_id, stop = !!INC_KINDS[kind].stop && (v.status || 'ok') === 'ok';
    if (stop) await env.DB.prepare("UPDATE vehicles SET status='hold', status_since=?, repair_until='', status_note=? WHERE plate=?").bind(today, `#${id} ${INC_KINDS[kind].l}`, plate).run();
    await audit(env, actor, 'INCIDENT', null, `#${id} ${plate} ${kind}${stop ? ' → vehicle on hold' : ''} ${note}`.slice(0, 900));
    const text = `🚨 *${INC_KINDS[kind].l}* — ${plate} · ${dname}\n📅 ${today} ${new Date(Date.now() + 3 * 3600e3).toISOString().slice(11, 16)}${note ? `\n📝 ${note}` : ''}${body.hasAudio ? '\n🎙️ የድምጽ መልዕክት ተያይዟል (Voice note attached)' : ''}${g ? `\n📍 ${mapLink(g)}` : ''}${stop ? '\n⏸ መኪናው "በምርመራ" ላይ ነው — ፍሊት አድሚኑ እስኪወስን አይመደብም' : ''}`;
    bg(notify(env, cfg, 'incident', text));
    bg(feedText(env, `${text}\n${feedWho({ actor, ...env._ri })}`));
    if (stop) bg(notify(env, cfg, 'vehicleHold', `⏸ ${plate} በምርመራ ላይ ነው (#${id} ${INC_KINDS[kind].l}) — ✅ ወደ ስራ ወይም 🔧 ጥገና ብለው ይወስኑ`));
    return J({ ok: true, id, vehicleHold: stop });
  }
  if (path === '/api/incidents' && m === 'GET') {
    if (staff && !canAny('incidents', 'opsDash', 'approve')) return deny();
    const all = url.searchParams.get('status') === 'all';
    const q = "SELECT i.*, (SELECT group_concat(n) FROM incident_photos p WHERE p.incident_id=i.id) photos FROM incidents i WHERE ";
    const rows = (await (staff ? env.DB.prepare(q + (all ? 'i.idate>=? ' : "(i.status='open' OR i.idate>=?) ") + 'ORDER BY i.id DESC LIMIT 100').bind(addisDate(all ? 90 : 7))
      : env.DB.prepare(q + 'i.driver_id=? ORDER BY i.id DESC LIMIT 10').bind(myDriver.id)).all()).results;
    return J(rows.map(incOut));
  }
  const incAud = path.match(/^\/api\/incidents\/(\d+)\/audio$/);
  if (incAud) {
    const inc = await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(+incAud[1]).first();
    if (!inc || (!staff && inc.driver_id !== myDriver.id)) return fail('Not found', 404);
    if (m === 'PUT') {
      if (staff && !admin) return deny();
      const mime = (req.headers.get('content-type') || 'audio/webm').split(';')[0];
      if (!/^audio\//.test(mime) && mime !== 'application/octet-stream') return fail('Audio format required');
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return fail('Audio note too large', 413);
      await env.DB.prepare('INSERT INTO incident_photos(incident_id,n,mime,data,created_at) VALUES(?,9,?,?,?) ON CONFLICT(incident_id,n) DO UPDATE SET mime=excluded.mime,data=excluded.data,created_at=excluded.created_at').bind(inc.id, mime, buf, now()).run();
      return J({ ok: true });
    }
    if (m === 'GET') {
      if (staff && !canAny('incidents', 'opsDash', 'approve', 'photos')) return deny();
      const p = await env.DB.prepare('SELECT mime,data FROM incident_photos WHERE incident_id=? AND n=9').bind(inc.id).first();
      if (!p) return fail('No audio note', 404);
      return new Response(p.data instanceof ArrayBuffer || ArrayBuffer.isView(p.data) ? p.data : new Uint8Array(p.data), { headers: { 'content-type': p.mime || 'audio/webm', 'cache-control': 'private, max-age=600' } });
    }
  }
  const incPh = path.match(/^\/api\/incidents\/(\d+)\/photo$/);
  if (incPh) {
    const inc = await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(+incPh[1]).first();
    if (!inc || (!staff && inc.driver_id !== myDriver.id)) return fail('Not found', 404);
    const n = Math.floor(num(url.searchParams.get('n')));
    if (n < 1 || n > 3) return fail('Photo number must be 1 to 3');
    if (m === 'PUT') {
      if (staff && !admin) return deny();
      if (Date.now() - Date.parse(inc.created_at) > 24 * 3600e3) return fail('Photos can be added within 24 hours');
      const mime = (req.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return fail('Photo must be JPEG, PNG or WebP');
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return fail('Photo too large', 413);
      await env.DB.prepare('INSERT INTO incident_photos(incident_id,n,mime,data,created_at) VALUES(?,?,?,?,?) ON CONFLICT(incident_id,n) DO UPDATE SET mime=excluded.mime,data=excluded.data,created_at=excluded.created_at').bind(inc.id, n, mime, buf, now()).run();
      bg((async () => { const ch = await channelOf(env); if (ch) await tgPhoto(env, ch.id, buf, mime, `🚨 #${inc.id} ${INC_KINDS[inc.kind]?.l || inc.kind} — ${inc.plate} · 📷 ${n}`); })());
      return J({ ok: true });
    }
    if (m === 'GET') {
      if (staff && !canAny('incidents', 'opsDash', 'approve', 'photos')) return deny();
      const p = await env.DB.prepare('SELECT mime,data FROM incident_photos WHERE incident_id=? AND n=?').bind(inc.id, n).first();
      if (!p) return fail('No photo', 404);
      return new Response(p.data instanceof ArrayBuffer || ArrayBuffer.isView(p.data) ? p.data : new Uint8Array(p.data), { headers: { 'content-type': p.mime, 'cache-control': 'private, max-age=600' } });
    }
  }
  // Fleet Admin decides: vehicle back to work, or in repair until a date; and/or closes the incident
  const incRes = path.match(/^\/api\/incidents\/(\d+)\/resolve$/);
  if (incRes && m === 'POST') {
    if (!can('incidents')) return deny();
    const inc = await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(+incRes[1]).first();
    if (!inc) return fail('Not found', 404);
    const note = String(body.note || '').trim().slice(0, 300), veh = body.vehicle, until = String(body.until || '');
    if (veh === 'repair' && (!isDay(until) || until < addisDate(0))) return fail('Pick the date the vehicle should be back (የሚመለስበት ቀን)');
    if (body.close && note.length < 3) return fail('Write what was done (ምን እንደተደረገ ይጻፉ)');
    const st = [];
    if (veh === 'ok') st.push(env.DB.prepare("UPDATE vehicles SET status='ok', status_since='', repair_until='', status_note='' WHERE plate=?").bind(inc.plate));
    if (veh === 'repair') st.push(env.DB.prepare("UPDATE vehicles SET status='repair', status_since=CASE WHEN status_since='' THEN ? ELSE status_since END, repair_until=?, status_note=? WHERE plate=?").bind(inc.idate, until, `#${inc.id} ${note}`.slice(0, 120), inc.plate));
    if (body.close) st.push(env.DB.prepare("UPDATE incidents SET status='closed', resolved_by=?, resolved_at=?, resolution=? WHERE id=?").bind(actor, now(), note, inc.id));
    if (!st.length) return fail('Nothing to change');
    st.push(auditStmt(env, actor, 'INCIDENT_RESOLVE', null, `#${inc.id} ${inc.plate}${veh ? ' vehicle=' + veh + (veh === 'repair' ? ' until ' + until : '') : ''}${body.close ? ' closed' : ''} ${note}`.slice(0, 900)));
    await env.DB.batch(st);
    if (veh) bg(notify(env, cfg, 'vehicleHold', veh === 'ok' ? `✅ ${inc.plate} ወደ ስራ ተመልሷል — ${actor}` : `🔧 ${inc.plate} ጥገና ላይ ነው እስከ ${until} — ${actor}${note ? `\n📝 ${note}` : ''}`));
    return J({ ok: true });
  }
  const vst = path.match(/^\/api\/vehicles\/([^/]+)\/status$/);
  if (vst && m === 'POST') {
    if (!can('incidents')) return deny();
    const plate = decodeURIComponent(vst[1]).toUpperCase(), v = await env.DB.prepare('SELECT * FROM vehicles WHERE plate=?').bind(plate).first();
    if (!v) return fail('Unknown vehicle');
    const stt = body.status, until = String(body.until || ''), note = String(body.note || '').trim().slice(0, 120);
    if (!['ok', 'repair'].includes(stt)) return fail('Status must be ok or repair');
    if (stt === 'repair' && (!isDay(until) || until < addisDate(0))) return fail('Pick the date the vehicle should be back (የሚመለስበት ቀን)');
    await env.DB.batch([stt === 'ok' ? env.DB.prepare("UPDATE vehicles SET status='ok', status_since='', repair_until='', status_note='' WHERE plate=?").bind(plate)
      : env.DB.prepare("UPDATE vehicles SET status='repair', status_since=CASE WHEN status_since='' THEN ? ELSE status_since END, repair_until=?, status_note=? WHERE plate=?").bind(addisDate(0), until, note, plate),
      auditStmt(env, actor, 'VEHICLE_STATUS', null, `${plate} ${stt}${stt === 'repair' ? ' until ' + until : ''} ${note}`)]);
    bg(notify(env, cfg, 'vehicleHold', stt === 'ok' ? `✅ ${plate} ወደ ስራ ተመልሷል — ${actor}` : `🔧 ${plate} ጥገና ላይ ነው እስከ ${until} — ${actor}${note ? `\n📝 ${note}` : ''}`));
    return J({ ok: true });
  }
  // Live view for staff: who is on a break now, open incidents, vehicles off the road
  if (path === '/api/live' && m === 'GET') {
    if (!canAny('opsDash', 'incidents', 'approve')) return deny();
    const today = addisDate(0);
    const br = (await env.DB.prepare('SELECT b.*, d.name FROM breaks b JOIN drivers d ON d.id=b.driver_id WHERE b.bdate=?').bind(today).all()).results;
    const by = {}; for (const b of br) (by[b.driver_id] ||= []).push(b);
    const onBreak = [], mx = num(cfg.breakMaxMin), mxN = num(cfg.breakMaxCount);
    for (const list of Object.values(by)) {
      const open = list.find(b => !b.end_ts), mins = list.reduce((t, b) => t + Math.round(((b.end_ts ? Date.parse(b.end_ts) : Date.now()) - Date.parse(b.start_ts)) / 60e3), 0);
      const over = list.some(b => (mx > 0 && Math.round(((b.end_ts ? Date.parse(b.end_ts) : Date.now()) - Date.parse(b.start_ts)) / 60e3) > mx)) || (mxN > 0 && list.length > mxN);
      if (open || over) onBreak.push({ driver: list[0].name, plate: list[0].plate, now: !!open, reason: open ? open.reason : '', since: open ? open.start_ts : '', min: open ? Math.round((Date.now() - Date.parse(open.start_ts)) / 60e3) : 0, todayMin: mins, count: list.length, over });
    }
    const inc = (await env.DB.prepare("SELECT i.*, (SELECT group_concat(n) FROM incident_photos p WHERE p.incident_id=i.id) photos FROM incidents i WHERE i.status='open' ORDER BY i.id DESC LIMIT 50").all()).results.map(incOut);
    const off = (await env.DB.prepare("SELECT plate,driver,status,status_since,repair_until,status_note FROM vehicles WHERE status<>'ok' ORDER BY plate").all()).results
      .map(v => ({ plate: v.plate, driver: v.driver, status: v.status, since: v.status_since, until: v.repair_until, note: v.status_note, due: v.status === 'repair' && v.repair_until && v.repair_until <= today }));
    return J({ today, onBreak, incidents: inc, offRoad: off, breakMaxMin: mx, breakMaxCount: mxN, canResolve: can('incidents') });
  }
  // Devices a driver (or staff member) has used; the Fleet Admin approves or blocks a driver's phone
  if (path === '/api/devices' && m === 'GET') {
    const did = url.searchParams.get('driver');
    if (did != null ? !canAny('driverPin', 'vehicles') : !can('audit')) return deny();
    const rows = (await (did != null ? env.DB.prepare('SELECT * FROM devices WHERE who=? ORDER BY last_ts DESC').bind('d:' + (+did)) : env.DB.prepare('SELECT * FROM devices ORDER BY last_ts DESC LIMIT 300')).all()).results;
    const shared = {}; for (const r of (await env.DB.prepare('SELECT dev, COUNT(DISTINCT who) n FROM devices GROUP BY dev HAVING n>1').all()).results) shared[r.dev] = r.n;
    return J({ lock: !!cfg.deviceLock, list: rows.map(r => ({ dev: r.dev, id: devShort(r.dev), who: r.who, name: r.name, info: r.info, first: r.first_ts, last: r.last_ts, approved: !!r.approved, sharedWith: shared[r.dev] ? shared[r.dev] - 1 : 0 })) });
  }
  if (path === '/api/devices/approve' && m === 'POST') {
    if (!canAny('driverPin', 'vehicles')) return deny();
    const dev = String(body.dev || ''), who = String(body.who || '');
    if (!/^d:\d+$/.test(who) && !admin) return deny();
    const r0 = await env.DB.prepare('SELECT name FROM devices WHERE dev=? AND who=?').bind(dev, who).first();
    if (!r0) return fail('Not found', 404);
    await env.DB.batch([env.DB.prepare('UPDATE devices SET approved=? WHERE dev=? AND who=?').bind(body.approved ? 1 : 0, dev, who),
      auditStmt(env, actor, body.approved ? 'DEVICE_APPROVE' : 'DEVICE_BLOCK', null, `${r0.name} ${devShort(dev)}`)]);
    return J({ ok: true });
  }

  // ---- Admin only ----
  if (path === '/api/admin/audit' && m === 'GET' && can('audit')) {
    return J((await env.DB.prepare('SELECT ts,actor,action,shift_id,detail,dev,dinfo,ip,city,geo FROM audit ORDER BY id DESC LIMIT 300').all()).results.map(a => ({ ...a, devId: devShort(a.dev) })));
  }
  if (path.startsWith('/api/admin/')) {
    if (!admin) return fail('Forbidden', 403);
    if (path === '/api/admin/config' && m === 'GET') return J({ ...cfg, notify: Object.fromEntries(Object.keys(NOTIFY).map(t => [t, Object.fromEntries(NROLES.map(r => [r, notifyLevel(cfg, t, r)]))])),
      _notifyTypes: Object.fromEntries(Object.entries(NOTIFY).map(([k, v]) => [k, v.l])), _channel: await channelOf(env), _rchannel: await rosterChannel(env), _tgLinked: !!(await env.DB.prepare("SELECT 1 x FROM tg_links WHERE who='a'").first()) });
    if (path === '/api/admin/config' && m === 'PUT') {
      // Validate first so a bad PIN never leaves half the settings saved
      if (body.adminPin) {
        if (!pinStaff(body.adminPin)) return fail('Admin PIN must be 6-12 digits');
        if (await staffPinTaken(env, body.adminPin, { exceptAdmin: true })) return fail('That PIN is already used by a manager');
      }
      const n = { ...cfg };
      for (const k of Object.keys(DEF)) if (k in body && (DEF[k] === null || typeof DEF[k] !== 'object')) n[k] = typeof DEF[k] === 'number' ? num(body[k]) : (typeof DEF[k] === 'boolean' ? !!body[k] : String(body[k]).slice(0, 80));
      if (Array.isArray(body.expenseCats)) {
        const cs = body.expenseCats.slice(0, 30).map((c, i) => ({ id: String(c.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'cat-' + (i + 1), name: String(c.name || '').trim().slice(0, 60), fleet: !!c.fleet }));
        if (!cs.length || cs.some(c => !c.name)) return fail('Each expense category needs a name');
        if (new Set(cs.map(c => c.id)).size !== cs.length) return fail('Expense category ids must be different');
        n.expenseCats = cs;
      }
      n.overtimeRate = Math.max(0, num(n.overtimeRate));
      if (Array.isArray(body.routes)) {
        const rs = body.routes.slice(0, 20).map((r, i) => ({ id: String(r.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'route-' + (i + 1),
          name: String(r.name || '').trim().slice(0, 60), from: String(r.from || '').trim().slice(0, 30), mid: String(r.mid || '').trim().slice(0, 30), to: String(r.to || '').trim().slice(0, 30),
          fullFare: Math.max(0, num(r.fullFare)), shortFare: Math.max(0, num(r.shortFare)), target: Math.max(0, Math.round(num(r.target))), targetWeekend: Math.max(0, Math.round(num(r.targetWeekend))) }));
        if (rs.some(r => !r.name || !r.from || !r.to || !(r.fullFare > 0))) return fail('Each route needs a name, start, end and a full fare');
        if (new Set(rs.map(r => r.id)).size !== rs.length) return fail('Route ids must be different');
        n.routes = rs;
      }
      n.standardHours = Math.min(24, Math.max(1, n.standardHours || 8));
      n.reminderHour = Math.min(23, Math.max(0, Math.floor(n.reminderHour)));
      if ('lowBatteryThreshold' in body && !('lowBatteryPct' in body)) n.lowBatteryPct = num(body.lowBatteryThreshold);
      n.lowBatteryPct = Math.min(100, Math.max(0, Math.round(num(n.lowBatteryPct ?? DEF.lowBatteryPct))));
      n.lowBatteryPctCabby = Math.min(100, Math.max(0, Math.round(num(body.lowBatteryPctCabby ?? body.batteryThresholds?.cabby?.alertPct ?? n.lowBatteryPctCabby ?? n.lowBatteryPct))));
      n.lowBatteryPctRoute = Math.min(100, Math.max(0, Math.round(num(body.lowBatteryPctRoute ?? body.batteryThresholds?.route?.alertPct ?? n.lowBatteryPctRoute ?? 25))));
      if (body.batteryThresholds && typeof body.batteryThresholds === 'object') {
        const btIn = body.batteryThresholds;
        n.batteryThresholds = normBattThresholds({
          ...n,
          lowBatteryPct: btIn.any?.alertPct ?? n.lowBatteryPct,
          lowBatteryPctCabby: btIn.cabby?.alertPct ?? n.lowBatteryPctCabby,
          lowBatteryPctRoute: btIn.route?.alertPct ?? n.lowBatteryPctRoute,
          batteryThresholds: btIn,
        });
        n.lowBatteryPct = n.batteryThresholds.any.alertPct;
        n.lowBatteryPctCabby = n.batteryThresholds.cabby.alertPct;
        n.lowBatteryPctRoute = n.batteryThresholds.route.alertPct;
      } else {
        n.batteryThresholds = normBattThresholds(n);
      }
      if (n.maxDailyKm <= 0) n.maxDailyKm = DEF.maxDailyKm;
      n.photoKeepDays = Math.min(365, Math.max(7, Math.floor(n.photoKeepDays) || DEF.photoKeepDays));
      n.serviceWarnKm = Math.max(0, n.serviceWarnKm);
      n.debtLockEtb = Math.max(0, n.debtLockEtb);
      if (body.notify && typeof body.notify === 'object') {
        const nn = {};
        for (const t of Object.keys(NOTIFY)) { nn[t] = {}; for (const r of NROLES) nn[t][r] = Math.max(0, Math.min(2, Math.floor(num(body.notify[t]?.[r] ?? notifyLevel(cfg, t, r))))); }
        n.notify = nn;
      }
      n.breakMaxMin = Math.max(0, Math.floor(n.breakMaxMin)); n.breakMaxCount = Math.max(0, Math.floor(n.breakMaxCount));
      n.driverSessionDays = Math.min(30, Math.max(1, Math.floor(n.driverSessionDays) || 7)); n.driverMaxBackDays = Math.min(31, Math.max(1, Math.floor(n.driverMaxBackDays) || 7)); n.lateMarkHours = Math.min(48, Math.max(1, Math.floor(n.lateMarkHours) || 3));
      n.inspectWithinMin = Math.min(480, Math.max(15, Math.floor(n.inspectWithinMin) || 120)); n.handoverGraceMin = Math.min(120, Math.max(0, Math.floor(n.handoverGraceMin)));
      n.doubleShiftAfterMin = Math.min(600, Math.max(30, Math.floor(n.doubleShiftAfterMin) || 120)); n.maxDoubleWeek = Math.min(7, Math.max(0, Math.floor(n.maxDoubleWeek)));
      n.lateFreePerMonth = Math.min(31, Math.max(0, Math.floor(n.lateFreePerMonth)));
      if (body.routeBonus && typeof body.routeBonus === 'object') {
        const b = body.routeBonus, tiers = (Array.isArray(b.tiers) ? b.tiers : []).slice(0, 8).map(t => ({ pct: Math.round(num(t.pct)), etb: Math.round(num(t.etb)) })).filter(t => t.pct > 0 && t.etb > 0).sort((x, y) => x.pct - y.pct);
        if (new Set(tiers.map(t => t.pct)).size !== tiers.length) return fail('🎯 Each bonus step needs a different %');
        if (tiers.some((t, i) => i && t.etb < tiers[i - 1].etb)) return fail('🎯 A higher % step cannot pay less');
        n.routeBonus = { mode: b.mode === 'pct' ? 'pct' : 'tiers', tiers, pct: Math.min(100, Math.max(0, num(b.pct))), cap: Math.max(0, Math.round(num(b.cap))) };
      }
      if (Array.isArray(body.docTypes)) {
        const ts = body.docTypes.slice(0, 20).map((t, i) => ({ id: String(t.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'doc-' + (i + 1) + '-' + Date.now().toString(36), name: String(t.name || '').trim().slice(0, 60),
          for: t.for === 'vehicle' ? 'vehicle' : 'driver', mode: ['cabby', 'route'].includes(t.mode) ? t.mode : 'any' }));
        if (ts.some(t => !t.name)) return fail('📄 Each document type needs a name');
        if (new Set(ts.map(t => t.id)).size !== ts.length) return fail('📄 Document type ids must be different');
        n.docTypes = ts;
      }
      n.docRemindDays = String(n.docRemindDays || '').split(/[ ,]+/).map(x => Math.floor(num(x))).filter(x => x > 0 && x <= 120).sort((a, b) => b - a).join(',') || DEF.docRemindDays;
      n.routeMissAlert = Math.min(7, Math.max(0, Math.floor(num(n.routeMissAlert))));
      if (body.shiftTimes && typeof body.shiftTimes === 'object') {
        const st = {};
        for (const g of ['cabby', 'route']) {
          const list = (Array.isArray(body.shiftTimes[g]) ? body.shiftTimes[g] : []).slice(0, 3).map((x, i) => ({ no: i + 1, name: String(x.name || '').trim().slice(0, 20) || `ፈረቃ ${i + 1}`, start: String(x.start || ''), end: String(x.end || '') }));
          if (!list.length || list.some(x => hmMin(x.start) == null || hmMin(x.end) == null)) return fail(`Shift times (${g}): each shift needs a start and an end like 06:00`);
          if (list.some((x, i) => i && hmMin(x.start) <= hmMin(list[i - 1].start))) return fail(`Shift times (${g}): each shift must start after the one before`);
          st[g] = list;
        }
        n.shiftTimes = st;
      } n.teleStmtMode = n.teleStmtMode === 'daily' ? 'daily' : 'smart'; n.teleRandomPct = Math.min(100, Math.max(0, Math.floor(n.teleRandomPct)));
      for (const k of ['closeRemindHour', 'closeDeadlineHour', 'digestHour', 'quietStartHour', 'quietEndHour']) n[k] = Math.min(23, Math.max(0, Math.floor(num(n[k]))));
      n.quietHoursOn = !!body.quietHoursOn;
      if ('emergencyPhones' in body) n.emergencyPhones = String(body.emergencyPhones || '').slice(0, 160);
      let permNote = '';
      if (body.perms && typeof body.perms === 'object') {
        const old = cfg.perms || DEF.perms, np = {}, ch = [];
        for (const r of ROLES) {
          np[r] = {};
          for (const k of PERM_KEYS) {
            np[r][k] = !!(body.perms[r] && typeof body.perms[r] === 'object' ? body.perms[r][k] : old[r]?.[k]);
            if (np[r][k] !== !!old[r]?.[k]) ch.push(`${r}.${k}=${np[r][k] ? 'ON' : 'OFF'}`);
          }
        }
        n.perms = np; permNote = ch.join(' ');
        if (ch.length) await audit(env, actor, 'PERMS_UPDATE', null, permNote.slice(0, 900));
      }
      await setKV(env, 'policy', JSON.stringify(n));
      if (body.adminPin) {
        await setKV(env, 'admin_pin', await hashPin(body.adminPin));
        await setKV(env, 'admin_lookup', await pinLookup(env, body.adminPin));
        await setKV(env, 'admin_ver', num(await getKV(env, 'admin_ver')) + 1); // signs out admin sessions
      }
      await audit(env, actor, 'CONFIG_UPDATE', null, body.adminPin ? 'incl. admin PIN change' : '');
      return J({ ok: true, signedOut: !!body.adminPin });
    }
    if ((path === '/api/admin/managers' || path === '/api/admin/users') && m === 'GET') {
      const { results } = await env.DB.prepare('SELECT id,name,role,active,created_at FROM managers ORDER BY active DESC, name').all();
      return J({ managers: results.map(r => ({ id: r.id, name: r.name, role: r.role || 'manager', active: !!r.active, createdAt: r.created_at })), legacy: !!(await getKV(env, 'manager_pin')) });
    }
    if ((path === '/api/admin/managers' || path === '/api/admin/users') && m === 'PUT') {
      const list = Array.isArray(body) ? body : [];
      const seen = new Set();
      for (const g of list) {
        const name = String(g.name || '').trim();
        if (!name) return fail('Each manager needs a name');
        if (g.role != null && !ROLES.includes(g.role)) return fail('Role must be manager, fleet or finance');
        if (g.pin) {
          if (!pinStaff(g.pin)) return fail(`PIN for ${name} must be 6-12 digits`);
          if (seen.has(String(g.pin))) return fail('Two managers cannot share a PIN');
          seen.add(String(g.pin));
          if (await staffPinTaken(env, g.pin, { exceptMid: g.id ? +g.id : null })) return fail(`PIN for ${name} is already used by someone else`);
        } else if (!g.id) return fail(`New manager ${name} needs a 6-12 digit PIN`);
        if (g.id && !(await env.DB.prepare('SELECT id FROM managers WHERE id=?').bind(+g.id).first())) return fail('Manager not found', 404);
      }
      for (const g of list) {
        const name = String(g.name).trim().slice(0, 60), active = g.active === false ? 0 : 1;
        if (g.id && g.role) { // a role change signs the person out so the new permissions apply at once
          const cur = await env.DB.prepare('SELECT role FROM managers WHERE id=?').bind(+g.id).first();
          if (cur && (cur.role || 'manager') !== g.role) await env.DB.prepare('UPDATE managers SET role=?, ver=ver+1 WHERE id=?').bind(g.role, +g.id).run();
        }
        if (g.id) {
          if (g.pin) await env.DB.prepare('UPDATE managers SET name=?,active=?,pin_hash=?,lookup=?,ver=ver+1 WHERE id=?').bind(name, active, await hashPin(g.pin), await pinLookup(env, g.pin), +g.id).run();
          else await env.DB.prepare('UPDATE managers SET name=?, ver=CASE WHEN active<>? THEN ver+1 ELSE ver END, active=? WHERE id=?').bind(name, active, active, +g.id).run();
        } else {
          await env.DB.prepare('INSERT INTO managers(name,pin_hash,lookup,active,created_at,role) VALUES(?,?,?,?,?,?)').bind(name, await hashPin(g.pin), await pinLookup(env, g.pin), active, now(), g.role || 'manager').run();
        }
      }
      for (const g of list) if (g.id && g.active === false) await env.DB.prepare('DELETE FROM tg_links WHERE who=?').bind('m:' + (+g.id)).run(); // left the company: no more messages
      if (body.retireLegacy || list.length) await delKV(env, 'manager_pin'); // the old shared manager PIN stops working once named managers exist
      await audit(env, actor, 'MANAGERS_UPDATE', null, list.map(g => `${g.name}:${g.role || 'manager'}${g.active === false ? ' (off)' : ''}${g.pin ? ' [PIN]' : ''}`).join(', '));
      return J({ ok: true });
    }
    if (path === '/api/admin/vehicles' && m === 'PUT') {
      const list = Array.isArray(body) ? body : [];
      if (!list.length) return fail('Need at least one vehicle');
      const keep = [];
      for (const v of list) { // validate all first
        const plate = String(v.plate || '').toUpperCase().trim();
        if (!plate) return fail('Plate required');
        if (keep.includes(plate)) return fail(`Plate ${plate} is listed twice`);
        keep.push(plate);
        if (v.pin && !pin4(v.pin)) return fail('Driver PIN must be 4 digits');
        if (v.mode && !MODES.includes(v.mode)) return fail('Vehicle mode must be any, cabby or route');
        const tid = String(v.teleId || '').replace(/[^\d]/g, '');
        if (tid && list.some(o => o !== v && String(o.teleId || '').replace(/[^\d]/g, '') === tid)) return fail(`Telebirr number ${tid} is used by two vehicles`);
        const ex = await env.DB.prepare('SELECT plate FROM vehicles WHERE plate=?').bind(plate).first();
        if (!ex && !v.pin && (v.driverId == null || v.driverId === '')) return fail(`New vehicle ${plate} needs a driver or a 4-digit PIN`);
        v._plate = plate; v._ex = !!ex;
      }
      for (const v of list) {
        const mode = v.mode || 'any';
        if (v._ex) {
          await env.DB.prepare('UPDATE vehicles SET next_start_km=?,mode=? WHERE plate=?').bind(num(v.nextStartKm), mode, v._plate).run();
          if (v.driverId != null && v.driverId !== '') await env.DB.prepare('UPDATE vehicles SET driver_id=? WHERE plate=?').bind(+v.driverId, v._plate).run();
          else if ('driver' in v || v.pin) await upsertMainDriver(env, v._plate, v.driver, v.phone, v.pin);
          if ('teleId' in v) await env.DB.prepare('UPDATE vehicles SET tele_id=? WHERE plate=?').bind(String(v.teleId || '').replace(/[^\d]/g, '').slice(0, 20), v._plate).run();
          if ('serviceEveryKm' in v || 'lastServiceKm' in v) await env.DB.prepare('UPDATE vehicles SET service_every_km=?,last_service_km=?,last_service_date=? WHERE plate=?')
            .bind(Math.max(0, num(v.serviceEveryKm)), Math.max(0, num(v.lastServiceKm)), /^\d{4}-\d{2}-\d{2}$/.test(v.lastServiceDate || '') ? v.lastServiceDate : '', v._plate).run();

        } else {
          await env.DB.prepare('INSERT INTO vehicles(plate,driver,phone,pin_hash,next_start_km,mode,pin_ver,service_every_km,last_service_km,tele_id) VALUES(?,?,?,?,?,?,1,?,?,?)')
            .bind(v._plate, v.driver || '', v.phone || '', '-', num(v.nextStartKm), mode, Math.max(0, num(v.serviceEveryKm)), Math.max(0, num(v.lastServiceKm)), String(v.teleId || '').replace(/[^\d]/g, '').slice(0, 20)).run();
          if (v.driverId != null && v.driverId !== '') await env.DB.prepare('UPDATE vehicles SET driver_id=? WHERE plate=?').bind(+v.driverId, v._plate).run();
          else await upsertMainDriver(env, v._plate, v.driver, v.phone, v.pin);
        }
      }
      await env.DB.prepare(`DELETE FROM vehicles WHERE plate NOT IN (${keep.map(() => '?').join(',')})`).bind(...keep).run();
      await syncVehicleDrivers(env);
      await audit(env, actor, 'VEHICLES_UPDATE', null, list.map(v => `${v._plate}:${v.mode || 'any'}${v.pin ? '[PIN]' : ''}`).join(','));
      return J({ ok: true });
    }
    if (path === '/api/admin/audit' && m === 'GET') {
      return J((await env.DB.prepare('SELECT ts,actor,action,shift_id,detail,dev,dinfo,ip,city,geo FROM audit ORDER BY id DESC LIMIT 300').all()).results.map(a => ({ ...a, devId: devShort(a.dev) })));
    }
    if (path === '/api/admin/usage' && m === 'GET') {
      const u = JSON.parse((await getKV(env, 'usage')) || 'null');
      return J({ usage: u, missing: ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'GH_TOKEN'].filter(k => !env[k]), limits: FREE });
    }
    if (path === '/api/admin/usage' && m === 'POST') {
      const u = await checkUsage(env, true);
      return J({ usage: u.at ? u : null, missing: ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'GH_TOKEN'].filter(k => !env[k]), limits: FREE });
    }
    if (path === '/api/admin/channel' && m === 'POST') {
      if (!env.TG_TOKEN) return fail('The Telegram bot is not set up yet (TG_TOKEN).');
      if (!(await ensureHook(env, url.origin))) return fail('Could not connect the Telegram bot. Check TG_TOKEN.');
      let bot = await getKV(env, 'tg_bot');
      if (!bot) { const r = await tgApi(env, 'getMe'); bot = r?.result?.username || ''; if (bot) await setKV(env, 'tg_bot', bot); }
      const code = hex(crypto.getRandomValues(new Uint8Array(12)));
      await env.DB.batch([env.DB.prepare("DELETE FROM tg_codes WHERE exp<? OR who='channel'").bind(Date.now()), env.DB.prepare("INSERT INTO tg_codes(code,who,exp) VALUES(?,'channel',?)").bind(code, Date.now() + 30 * 60e3)]);
      return J({ code: 'ETEV-LINK-' + code, bot });
    }
    if (path === '/api/admin/rchannel' && m === 'POST') {
      if (!env.TG_TOKEN) return fail('The Telegram bot is not set up yet (TG_TOKEN).');
      if (!(await ensureHook(env, url.origin))) return fail('Could not connect the Telegram bot. Check TG_TOKEN.');
      let bot = await getKV(env, 'tg_bot');
      if (!bot) { const r = await tgApi(env, 'getMe'); bot = r?.result?.username || ''; if (bot) await setKV(env, 'tg_bot', bot); }
      const code = hex(crypto.getRandomValues(new Uint8Array(12)));
      await env.DB.batch([env.DB.prepare("DELETE FROM tg_codes WHERE exp<? OR who='rchannel'").bind(Date.now()), env.DB.prepare("INSERT INTO tg_codes(code,who,exp) VALUES(?,'rchannel',?)").bind(code, Date.now() + 30 * 60e3)]);
      return J({ code: 'ETEV-ROSTER-' + code, bot, linked: await rosterChannel(env) });
    }
    if (path === '/api/admin/rchannel' && m === 'DELETE') {
      const ch = await rosterChannel(env); await delKV(env, 'tg_roster_channel'); await audit(env, actor, 'CHANNEL', null, `assignment channel unlinked: ${ch?.title || ''}`);
      return J({ ok: true });
    }
    if (path === '/api/admin/channel' && m === 'DELETE') {
      const ch = await channelOf(env);
      await delKV(env, 'tg_channel'); await env.DB.prepare('DELETE FROM feed').run();
      await audit(env, actor, 'CHANNEL', null, `unlinked: ${ch?.title || ''}`);
      return J({ ok: true });
    }
    if (path === '/api/admin/telegram-test' && m === 'POST') {
      const mine = await env.DB.prepare("SELECT chat_id FROM tg_links WHERE who='a'").first();
      const okP = mine ? await tg(env, '✅ *ETEV Fleet Portal* — personal messages work.', mine.chat_id) : false, okG = env.TG_CHAT_ID ? await tg(env, '✅ *ETEV Fleet Portal* — group connected.') : false;
      const okC = await feedText(env, '✅ *ETEV Fleet Portal* — channel test.');
      return J({ ok: okP || okG || okC, personal: okP, group: okG, linked: !!mine, channel: okC });
    }
    if (path === '/api/admin/reminder-test' && m === 'POST') {
      if (['digest', 'closeRemind', 'closeDeadline', 'routeMiss', 'docs', 'yango', 'monthly'].includes(body.job)) { await morningJobs(env, body.job); return J({ ok: true, sent: true }); }
      if (body.job === 'feedHourly') return J({ ok: true, sent: (await flushFeed(env)) + (await flushFeed(env, true)) > 0 });
      return J({ ok: true, sent: await dailyReminder(env, true) });
    }
    if (path === '/api/admin/backup' && m === 'GET') {
      await audit(env, actor, 'BACKUP_DOWNLOAD');
      return new Response(await buildBackup(env), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="ETEV_backup_${addisDate(0)}.json"` } });
    }
  }
  return fail('Not found', 404);
}

// Daily "missing report" reminder. Runs from the hourly cron; sends once per Addis day at cfg.reminderHour.
async function dailyReminder(env, force = false) {
  await ensureSchema(env);
  const cfg = await getCfg(env);
  if (!force && (!cfg.reminderOn || addisHour() !== cfg.reminderHour)) return false;
  const today = addisDate(0);
  if (!force && (await getKV(env, 'reminder_last')) === today) return false;
  const vs = (await env.DB.prepare('SELECT plate,driver,status FROM vehicles ORDER BY plate').all()).results;
  const rep = new Set((await env.DB.prepare('SELECT DISTINCT plate FROM shifts WHERE shift_date=?').bind(today).all()).results.map(r => r.plate));
  const missing = vs.filter(v => !rep.has(v.plate));
  const pend = (await env.DB.prepare("SELECT COUNT(*) n FROM shifts WHERE status='PENDING'").first())?.n || 0;
  const old = (await env.DB.prepare("SELECT plate,shift_date FROM shifts WHERE status='PENDING' AND created_at<? ORDER BY shift_date").bind(new Date(Date.now() - 24 * 3600e3).toISOString()).all()).results;
  const svc = (await env.DB.prepare('SELECT * FROM vehicles').all()).results.map(v => serviceState(v, cfg)).filter(Boolean);
  const bal = await balances(env, null), dn = Object.fromEntries((await env.DB.prepare('SELECT id,name FROM drivers').all()).results.map(d => [d.id, d.name]));
  const debtors = Object.entries(bal).filter(([, b]) => b.balance > 0).map(([k, b]) => [dn[k] || '#' + k, b]);
  const lines = [`⏰ *ETEV DAILY CHECK* — ${today}`];
  lines.push(missing.length ? `🚐 *${missing.length} vehicle(s) have not reported today:*\n${missing.map(v => `• ${v.plate} (${v.driver})`).join('\n')}` : '✅ Every vehicle has reported today.');
  if (pend) lines.push(`⏳ ${pend} shift(s) still waiting for manager approval.`);
  if (old.length) lines.push(`⌛ *Waiting more than 24 hours:*\n${old.map(o => `• ${o.plate} (${o.shift_date})`).join('\n')}`);
  if (svc.length) lines.push(`🔧 *Service due:*\n${svc.map(s => `• ${s.plate}: ${s.overdue ? `OVERDUE by ${Math.round(-s.left)} KM` : `in ${Math.round(s.left)} KM`} (at ${s.dueAt})`).join('\n')}`);
  if (debtors.length) lines.push(`💵 *Drivers owing money:*\n${debtors.map(([p, b]) => `• ${p} ${Math.round(b.balance)} ETB${b.penalty.balance > 0 ? ` (KM penalty ${Math.round(b.penalty.balance)})` : ''}${debtLocked(cfg, b) ? ' 🛑 LOCKED' : ''}`).join('\n')}`);
  const ok = cfg.groupTg ? await tg(env, lines.join('\n')) : false;
  // Personal reminder to each driver who has a vehicle today and has not sent a report
  let n = 0;
  for (const v of missing) {
    const did = await driverFor(env, v.plate, today);
    if (did != null && (v.status || 'ok') === 'ok' && await notifyDriver(env, did, 'remind', `⏰ የዛሬ (${today}) ሪፖርትዎ ገና አልተላከም — ${v.plate}። ስራ ሲጨርሱ ይላኩ፤ ቀኑ ነገ ${cfg.closeDeadlineHour - 6} ሰዓት ይዘጋል።`)) n++;
  }
  if (!force) await setKV(env, 'reminder_last', today);
  return ok || n > 0;
}

// ---- v4.6 free-plan watch: real usage from Cloudflare (GraphQL analytics) and GitHub, warnings at 60 / 80 / 95 % ----
// Secrets: CF_API_TOKEN (Account Analytics: Read), CF_ACCOUNT_ID, GH_TOKEN (fine-grained, this repo, Actions: Read). GH_REPO optional.
const FREE = {
  req: { l: 'Cloudflare Workers — ጥያቄዎች (requests)', max: 100000, per: 'day' },
  d1Read: { l: 'D1 — የተነበቡ መስመሮች (rows read)', max: 5000000, per: 'day' },
  d1Write: { l: 'D1 — የተጻፉ መስመሮች (rows written)', max: 100000, per: 'day' },
  d1Size: { l: 'D1 — መጠን (storage)', max: 5e9, per: 'total', bytes: true },
  ghMin: { l: 'GitHub Actions — ደቂቃዎች (minutes)', max: 2000, per: 'month' },
  ghRepo: { l: 'GitHub — የrepo መጠን (size)', max: 1e9, per: 'total', bytes: true },
};
const USAGE_LEVELS = [60, 80, 95];
async function cfUsage(env) {
  const acct = String(env.CF_ACCOUNT_ID || '').replace(/[^a-f0-9]/gi, ''), day = new Date().toISOString().slice(0, 10), prev = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  // Values are written into the query (dates and a hex id only), so no GraphQL variable types are needed
  const query = `{viewer{accounts(filter:{accountTag:"${acct}"}){
    w:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:"${day}T00:00:00Z",datetime_leq:"${new Date().toISOString().slice(0, 19)}Z"}){sum{requests errors}quantiles{cpuTimeP99}dimensions{scriptName status}}
    d:d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:"${day}",date_leq:"${day}"}){sum{rowsRead rowsWritten}}
    s:d1StorageAdaptiveGroups(limit:1000,filter:{date_geq:"${prev}",date_leq:"${day}"}){max{databaseSizeBytes}dimensions{databaseId}}}}}`;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: 'Bearer ' + env.CF_API_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json().catch(() => ({}));
  const a = j?.data?.viewer?.accounts?.[0];
  if (!a) throw new Error('Cloudflare: ' + (j?.errors?.map(e => e.message).join('; ') || 'HTTP ' + r.status).slice(0, 200));
  const w = a.w || [], mine = w.filter(x => x.dimensions?.scriptName === 'etev-fleet-portal');
  const size = {}; for (const x of a.s || []) size[x.dimensions?.databaseId] = Math.max(size[x.dimensions?.databaseId] || 0, num(x.max?.databaseSizeBytes));
  return { req: w.reduce((t, x) => t + num(x.sum?.requests), 0), errors: mine.reduce((t, x) => t + num(x.sum?.errors), 0),
    cpuLimitHits: mine.filter(x => x.dimensions?.status === 'exceededResources').reduce((t, x) => t + num(x.sum?.requests), 0),
    cpuP99ms: r2(Math.max(0, ...mine.map(x => num(x.quantiles?.cpuTimeP99))) / 1000),
    d1Read: (a.d || []).reduce((t, x) => t + num(x.sum?.rowsRead), 0), d1Write: (a.d || []).reduce((t, x) => t + num(x.sum?.rowsWritten), 0),
    d1Size: Object.values(size).reduce((t, x) => t + x, 0), partial: !!j.errors?.length, note: j.errors?.length ? j.errors.map(e => e.message).join('; ').slice(0, 200) : '' };
}
async function ghUsage(env) {
  const repo = String(env.GH_REPO || 'hayelemikael/etev-fleet-portal').replace(/[^\w.\/-]/g, ''), H = { authorization: 'Bearer ' + env.GH_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'etev-fleet-portal' };
  const info = await fetch(`https://api.github.com/repos/${repo}`, { headers: H });
  if (!info.ok) throw new Error(`GitHub: HTTP ${info.status}${info.status === 401 ? ' (token expired or wrong)' : ''}`);
  const meta = await info.json(), exp = info.headers.get('github-authentication-token-expiration') || '';
  // Billed minutes: each job is rounded up to a whole minute (one job per run here). This repo only — other private repos share the 2,000.
  const month = new Date().toISOString().slice(0, 7);
  let minutes = 0, runs = 0;
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=100&page=${page}&created=%3E%3D${month}-01`, { headers: H });
    if (!r.ok) throw new Error(`GitHub Actions: HTTP ${r.status}`);
    const list = (await r.json()).workflow_runs || [];
    for (const x of list) { const ms = Date.parse(x.updated_at) - Date.parse(x.run_started_at || x.created_at); if (ms > 0) { minutes += Math.ceil(ms / 60e3); runs++; } }
    if (list.length < 100) break;
  }
  return { ghMin: minutes, ghRuns: runs, ghRepo: num(meta.size) * 1024, private: !!meta.private, tokenExpires: exp };
}
// Hourly: read usage, keep a 14-day history, warn once per level per period
async function checkUsage(env, force = false) {
  await ensureSchema(env);
  const cfg = await getCfg(env), now0 = new Date();
  const haveCf = !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID), haveGh = !!env.GH_TOKEN;
  if (!haveCf && !haveGh) return { ok: false, missing: ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'GH_TOKEN'] };
  if (!force && (await getKV(env, 'usage_hour')) === now0.toISOString().slice(0, 13)) return JSON.parse((await getKV(env, 'usage')) || '{}');
  await setKV(env, 'usage_hour', now0.toISOString().slice(0, 13));
  const out = { at: now0.toISOString(), values: {}, errors: [], missing: [...(haveCf ? [] : ['CF_API_TOKEN', 'CF_ACCOUNT_ID']), ...(haveGh ? [] : ['GH_TOKEN'])] };
  if (haveCf) try { Object.assign(out.values, await cfUsage(env)); } catch (e) { out.errors.push(String(e.message || e)); }
  if (haveGh) try { Object.assign(out.values, await ghUsage(env)); } catch (e) { out.errors.push(String(e.message || e)); }
  const v = out.values, dayFrac = Math.max(0.04, (now0.getUTCHours() * 60 + now0.getUTCMinutes()) / 1440);
  const monthFrac = Math.max(0.03, (now0.getUTCDate() - 1 + dayFrac) / new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth() + 1, 0)).getUTCDate());
  out.items = Object.entries(FREE).filter(([k]) => k in v).map(([k, f]) => {
    const pct = r1(v[k] / f.max * 100), frac = f.per === 'day' ? dayFrac : f.per === 'month' ? monthFrac : 1;
    return { key: k, label: f.l, used: v[k], max: f.max, per: f.per, bytes: !!f.bytes, pct, projected: f.per === 'total' ? pct : r1(pct / frac) };
  });
  // Warnings: once per level, per day (daily limits) / per month / ever (storage)
  const sent = JSON.parse((await getKV(env, 'usage_alerted')) || '{}'), lines = [];
  const fmt = (x, b) => b ? (x >= 1e9 ? r2(x / 1e9) + ' GB' : r1(x / 1e6) + ' MB') : Math.round(x).toLocaleString('en-US');
  for (const it of out.items) {
    const per = it.per === 'day' ? now0.toISOString().slice(0, 10) : it.per === 'month' ? now0.toISOString().slice(0, 7) : 'total', key = it.key + '|' + per;
    const lvl = [...USAGE_LEVELS].reverse().find(l => it.pct >= l);
    if (lvl && (sent[key] || 0) < lvl) {
      sent[key] = lvl;
      lines.push(`${lvl >= 95 ? '🛑' : lvl >= 80 ? '🚨' : '⚠️'} *${it.label}*፦ ${it.pct}% (${fmt(it.used, it.bytes)} / ${fmt(it.max, it.bytes)}${it.per === 'day' ? ' በቀን' : it.per === 'month' ? ' በወር' : ''})` +
        (it.per !== 'total' && it.projected > it.pct ? `\n   በዚህ ፍጥነት ${it.per === 'day' ? 'ዛሬ' : 'በወሩ መጨረሻ'} ~${Math.round(it.projected)}% ይደርሳል` : '') +
        (lvl >= 95 && it.key.startsWith('d1') && it.per === 'day' ? '\n   ገደቡ ሲያልፍ ፖርታሉ እስከ ሌሊቱ 6 ሰዓት (UTC 00:00) ድረስ ይቆማል — Workers Paid ($5/ወር) ይህን ያስቀራል' : ''));
    }
  }
  if (v.cpuLimitHits > 0 && !sent['cpu|' + now0.toISOString().slice(0, 10)]) { sent['cpu|' + now0.toISOString().slice(0, 10)] = 1; lines.push(`🚨 *CPU ገደብ*፦ ዛሬ ${v.cpuLimitHits} ጥያቄዎች ከ10 ms የCPU ገደብ አልፈው ተቋርጠዋል (P99 ${v.cpuP99ms} ms)`); }
  if (v.tokenExpires) {
    const days = Math.floor((Date.parse(v.tokenExpires.replace(' UTC', 'Z').replace(' ', 'T')) - Date.now()) / 864e5);
    out.tokenDays = Number.isFinite(days) ? days : null;
    if (Number.isFinite(days) && days <= 14 && !sent['ghtoken|' + now0.toISOString().slice(0, 10)]) { sent['ghtoken|' + now0.toISOString().slice(0, 10)] = 1; lines.push(`🔑 የGitHub token በ${days} ቀን ውስጥ ያልቃል — አዲስ ፈጥረው በCloudflare ላይ GH_TOKEN ይቀይሩ`); }
  }
  if (out.errors.length && (await getKV(env, 'usage_err_day')) !== now0.toISOString().slice(0, 10)) { await setKV(env, 'usage_err_day', now0.toISOString().slice(0, 10)); lines.push(`❓ የአጠቃቀም መረጃ ማንበብ አልተቻለም፦ ${out.errors.join(' · ')}`); }
  for (const k of Object.keys(sent)) { const p = k.split('|')[1]; if (p !== 'total' && p < now0.toISOString().slice(0, 7)) delete sent[k]; } // forget old months
  await setKV(env, 'usage_alerted', JSON.stringify(sent));
  // 14-day history of the daily figures (highest reading of each day)
  const hist = JSON.parse((await getKV(env, 'usage_hist')) || '{}'), d = now0.toISOString().slice(0, 10);
  hist[d] = { req: Math.max(num(hist[d]?.req), num(v.req)), d1Read: Math.max(num(hist[d]?.d1Read), num(v.d1Read)), d1Write: Math.max(num(hist[d]?.d1Write), num(v.d1Write)) };
  for (const k of Object.keys(hist).sort().slice(0, -14)) delete hist[k];
  await setKV(env, 'usage_hist', JSON.stringify(hist)); out.history = hist;
  await setKV(env, 'usage', JSON.stringify(out));
  if (lines.length) await notify(env, cfg, 'usage', `📈 *የነፃ እቅድ ማስጠንቀቂያ*\n${lines.join('\n')}`);
  return out;
}

// Morning jobs (hourly cron, each once per Addis day):
//  digestHour      — 🟡 yesterday's summary to each person (money lines only for those who may see money); repair vehicles due back
//  closeRemindHour — 4 ሰዓት: managers (pending), finance (days to close), drivers (missing report) 
//  closeDeadlineHour — 6 ሰዓት: "day not closed" to the Super Admin
async function inspectionJobs(env, cfg) {
  const today = addisDate(0), miss = await inspMissing(env, cfg, today);
  const sent = JSON.parse((await getKV(env, 'insp_sent')) || '{}'), day = sent[today] || {}, lines = [];
  for (const x of miss) {
    const k = `${x.plate}|${x.shiftNo}|${x.overdue ? 'o' : 'h'}`;
    if (day[k] || (!x.overdue && !x.handover)) continue; // the first shift is reported once overdue; a handover as soon as the grace is over
    day[k] = 1; lines.push(x.handover && !x.overdue ? `🔁 ${x.plate} · ${x.shiftName}፦ ተረኛው (${x.driver}) አልደረሰም — ${x.waitMin} ደቂቃ` : `📋 ${x.plate} · ${x.shiftName}፦ ፍተሻ አልተደረገም (${x.driver}, ${x.waitMin} ደቂቃ)`);
  }
  if (lines.length) { await setKV(env, 'insp_sent', JSON.stringify({ [today]: day })); await notify(env, cfg, 'inspection', lines.join('\n')); }
}
// 📈 On the 1st: last month's profit & loss as a Telegram summary + the Excel file (management channel, else each person who gets this message on Telegram)
async function monthlyJob(env, cfg) {
  const month = dAdd(addisDate(0).slice(0, 7) + '-01', -1).slice(0, 7), pk = await monthlyPack(env, cfg, month);
  await notify(env, cfg, 'monthly', pk.text);
  const fn = `ETEV_${month}.xlsx`, mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ch = await channelOf(env);
  if (ch) await tgDoc(env, fn, pk.xlsx, `📈 ETEV ${month}`, ch.id, mime);
  else for (const r of await staffRecipients(env, cfg, 'monthly')) if (r.chat && r.lv === 2) await tgDoc(env, fn, pk.xlsx, `📈 ETEV ${month}`, r.chat, mime);
}
// 📄 Expiry reminders at 30 / 7 / 1 days (admin-set) and once when expired; the driver is told about their own licence
async function docJob(env, cfg) {
  const today = addisDate(0), steps = String(cfg.docRemindDays || DEF.docRemindDays).split(',').map(Number).filter(x => x > 0).sort((a, b) => a - b);
  const types = Object.fromEntries((cfg.docTypes || DEF.docTypes).map(t => [t.id, t])), names = Object.fromEntries((await env.DB.prepare('SELECT id, name FROM drivers').all()).results.map(d => [String(d.id), d.name]));
  const docs = (await env.DB.prepare('SELECT * FROM documents WHERE expires<=?').bind(dAdd(today, steps[steps.length - 1] || 30)).all()).results;
  const lines = [];
  for (const d of docs) {
    const t = types[d.type]; if (!t) continue;
    const days = dDiff(today, d.expires), step = days < 0 ? 'x' : steps.find(s => days <= s); if (step == null) continue;
    const key = `doc_${d.id}_${d.expires}_${step}`; if (await getKV(env, key)) continue; await setKV(env, key, '1');
    const who = d.owner_kind === 'driver' ? (names[d.owner_id] || '#' + d.owner_id) : d.owner_id, when = days < 0 ? `❌ ጊዜው አልፏል (${d.expires})` : days === 0 ? '⚠️ ዛሬ ያበቃል' : `⏳ በ${days} ቀን ያበቃል (${d.expires})`;
    lines.push(`• ${t.name} — *${who}*: ${when}${d.permit_until && d.permit_until >= today ? ` · 👑 እስከ ${d.permit_until} ተፈቅዷል` : ''}`);
    if (d.owner_kind === 'driver') await notifyDriver(env, +d.owner_id, 'docs', `📄 *${t.name}* — ${when}\nእባክዎ አሳድሰው ለፍሊት ያሳዩ። ${days < 0 ? 'እስኪታደስ ስራ መጀመር አይቻልም።' : ''}`);
  }
  if (lines.length) await notify(env, cfg, 'docs', `📄 *የሰነድ ማብቂያ (Documents)*\n${lines.join('\n')}`);
}
// 🎯 Drivers who missed the route target N times this week (no penalty — Fleet follows up). Once per driver per week.
async function routeMissJob(env, cfg) {
  const ws = weekStart(addisDate(0)), N = num(cfg.routeMissAlert);
  const rs = (await env.DB.prepare("SELECT s.calc, s.shift_date FROM shifts s WHERE s.shift_date>=? AND s.status='APPROVED' AND n_mode='route'").bind(ws).all()).results;
  const by = {};
  for (const r of rs) { const c = JSON.parse(r.calc); if (!(c.routeTarget > 0) || c.routePct >= 100) continue; const k = c.driverName || '?'; (by[k] ||= []).push(`${ddmm(r.shift_date)} ${c.plate} ${c.routePct}%`); }
  for (const [name, l] of Object.entries(by)) {
    if (l.length < N) continue;
    const key = `rmiss_${ws}_${name}`; if (await getKV(env, key)) continue; await setKV(env, key, '1');
    await notify(env, cfg, 'target', `🎯 *${name}* በዚህ ሳምንት ${l.length} ጊዜ ዒላማ አልደረሰም (target missed ${l.length}× this week)\n${l.join('\n')}\nቅጣት የለም — እባክዎ ያነጋግሩት።`);
  }
}
async function morningJobs(env, force = '') {
  await ensureSchema(env);
  const cfg = await getCfg(env), h = addisHour(), today = addisDate(0), y = addisDate(1);
  await inspectionJobs(env, cfg).catch(e => console.error('inspection', e));
  const once = async (k, hour) => { if (force === k) return true; if (h !== hour || (await getKV(env, 'job_' + k)) === today) return false; await setKV(env, 'job_' + k, today); return true; };
  const ql = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const groups = [];
  for (const g of ['cabby', 'route']) if ((await ql(g === 'route' ? "SELECT 1 x FROM vehicles WHERE mode='route' LIMIT 1" : "SELECT 1 x FROM vehicles WHERE mode<>'route' LIMIT 1")).length) groups.push(g);
  if (await once('docs', cfg.digestHour)) await docJob(env, cfg).catch(e => console.error('docs', e));
  if (await once('yango', cfg.digestHour)) await yangoJob(env, cfg).catch(e => console.error('yango', e));
  if ((today.endsWith('-01') || force === 'monthly') && await once('monthly', cfg.digestHour)) await monthlyJob(env, cfg).catch(e => console.error('monthly', e));
  if (num(cfg.routeMissAlert) > 0 && await once('routeMiss', cfg.digestHour)) await routeMissJob(env, cfg).catch(e => console.error('routeMiss', e));
  if (await once('rosterDay', cfg.digestHour)) { // 📅 today's assignment to the drivers' channel
    const ch = await rosterChannel(env), rs = (await ql("SELECT r.*, d.name, v.mode FROM roster r LEFT JOIN drivers d ON d.id=r.driver_id LEFT JOIN vehicles v ON v.plate=r.plate WHERE r.rdate=? AND r.kind='work' AND r.published=1 ORDER BY r.plate, r.shift_no", today));
    if (ch && rs.length) { const by = {}; for (const r of rs) (by[r.plate] ||= { m: r.mode, l: [] }).l.push(`${shiftDef(cfg, r.mode === 'route' ? 'route' : 'cabby', r.shift_no)?.name || r.shift_no}: ${r.name || '— ክፍት'}`);
      await tg(env, `📅 *የዛሬ ምደባ — ${DOW_AM[dowOf(today)]} ${ddmm(today)}*\n${Object.entries(by).map(([p, x]) => `${x.m === 'route' ? '🟢' : '🔵'} ${p} — ${x.l.join(' · ')}`).join('\n')}`, ch.id); }
    const gaps = rs.filter(r => r.driver_id == null); if (gaps.length) await notify(env, cfg, 'roster', `📅 ዛሬ ክፍት ፈረቃዎች፦ ${gaps.map(g => `${g.plate} (${g.shift_no})`).join(', ')} — ተጠባባቂ ይመድቡ`);
  }
  if (await once('digest', cfg.digestHour)) {
    const sh = (await ql("SELECT status,calc FROM shifts WHERE shift_date=? AND status IN ('APPROVED','PENDING','REJECTED')", y)).map(r => ({ st: r.status, ...JSON.parse(r.calc) }));
    const ap = sh.filter(r => r.st === 'APPROVED'), S = f => Math.round(ap.reduce((t, r) => t + num(f(r)), 0));
    const vs = await ql('SELECT plate FROM vehicles'), rep = new Set(sh.map(r => r.plate));
    const mf = await moneyFlow(env, cfg, y, y, ''), bal = await balances(env, null), debt = Math.round(Object.values(bal).reduce((t, b) => t + Math.max(0, b.balance), 0));
    const openInc = (await ql("SELECT COUNT(*) n FROM incidents WHERE status='open'"))[0].n, off = (await ql("SELECT plate,status,repair_until FROM vehicles WHERE status<>'ok'"));
    const svc = (await ql('SELECT * FROM vehicles')).map(v => serviceState(v, cfg)).filter(Boolean);
    const cl = []; for (const g of groups) cl.push(`${GRP_L[g]} ${(await isClosed(env, y, g)) ? '✅' : '⏳'}`);
    const base = [`🟡 *ETEV — ${y} ማጠቃለያ*`, `📋 ሪፖርቶች፦ ${ap.length} ጸድቀዋል · ${sh.length - ap.length} በመጠበቅ ላይ · ${vs.filter(v => !rep.has(v.plate)).length} አልተላኩም`,
      `🛣 ${S(r => r.actualKm).toLocaleString()} ኪ.ሜ${S(r => r.passengers) ? ` · 👥 ${S(r => r.passengers).toLocaleString()} ተሳፋሪ` : ''}`,
      ...(openInc || off.length ? [`🚨 ክፍት ጉዳዮች፦ ${openInc} · ⏸ ከስራ ውጭ መኪኖች፦ ${off.length}`] : []), `📕 ቀን፦ ${cl.join(' · ') || '–'}`];
    const money = [`💰 ገቢ ${Math.round(mf.total.in).toLocaleString()} · ወጪ ${Math.round(mf.total.out).toLocaleString()} · የተጣራ ${Math.round(mf.total.net).toLocaleString()} ብር`,
      `💵 የገንዘብ ጉድለት፦ ${S(sfOf)} ብር · 📏 ቅጣት፦ ${S(r => r.kmPenaltyEtb)} ብር · 🧾 የሹፌሮች ዕዳ፦ ${debt.toLocaleString()} ብር`];
    const fleet = svc.length ? [`🔧 ሰርቪስ የደረሰ፦ ${svc.map(x => x.plate).join(', ')}`] : [];
    await notify(env, cfg, 'digest', r => [...base, ...(canRole(cfg, r.role, 'reports') ? money : []), ...(r.role === 'fleet' || r.role === 'admin' ? fleet : [])].join('\n'));
    const due = off.filter(v => v.status === 'repair' && v.repair_until && v.repair_until <= today), hold = off.filter(v => v.status === 'hold');
    if (due.length || hold.length) await notify(env, cfg, 'vehicleHold', [...due.map(v => `🔧 ${v.plate} ዛሬ ከጥገና መመለስ ነበረበት (${v.repair_until}) — ✅ ወደ ስራ ይመልሱ ወይም ቀኑን ያራዝሙ`), ...hold.map(v => `⏸ ${v.plate} ገና በምርመራ ላይ ነው — ይወስኑ`)].join('\n'));
  }
  if (await once('closeRemind', cfg.closeRemindHour)) {
    const lines = [], pendLines = [];
    for (const g of groups) {
      if (await isClosed(env, y, g)) continue;
      const c = await dayChecklist(env, y, g);
      lines.push(`${GRP_L[g]}፦ ${c.pending.length ? `⏳ ${c.pending.length} ያልጸደቁ` : '✅ ሁሉም ጸድቋል'}${c.returned.length ? ` · ↩️ ${c.returned.length} የተመለሱ` : ''}${c.missing.filter(x => !x.auto).length ? ` · 🚐 ${c.missing.filter(x => !x.auto).length} ሪፖርት የሌላቸው` : ''}`);
      if (c.pending.length) pendLines.push(`${GRP_L[g]}፦ ${c.pending.map(p => p.plate).join(', ')}`);
      for (const x of c.missing.filter(x => !x.auto)) {
        const did = await driverFor(env, x.plate, y);
        await notifyDriver(env, did, 'remind', `⏰ የ${y} ሪፖርት (${x.plate}) አልተላከም። ቀኑ ዛሬ ${cfg.closeDeadlineHour - 6} ሰዓት ይዘጋል — ከሰሩ አሁኑኑ ይላኩ።`);
      }
    }
    if (pendLines.length) await notify(env, cfg, 'pending', `⏳ *የ${y} ያልጸደቁ ሪፖርቶች*\n${pendLines.join('\n')}\nቀኑ ${cfg.closeDeadlineHour - 6} ሰዓት ይዘጋል — እባክዎ ያጽድቁ ወይም ይመልሱ።`);
    // 📄 Telebirr statement: yesterday if the portal asks for it; on Mondays, the past week
    { const tn = await teleNeed(env, cfg, y, null);
      if (tn.needed && !tn.covered) lines.push(`📄 የ${y} የቴሌብር መግለጫ ያስፈልጋል፦ ${[...new Set(tn.reasons.map(r => TELE_WHY[r.why]))].join(' · ')} — ${[...new Set(tn.reasons.map(r => r.plate))].join(', ')}`);
      if (new Date(Date.now() + 3 * 36e5).getUTCDay() === 1) {
        const miss = [];
        for (let i = 1; i <= 7; i++) {
          const d = addisDate(i), has = await env.DB.prepare('SELECT 1 x FROM tele_txn WHERE tdate=? AND plate IS NOT NULL LIMIT 1').bind(d).first();
          if (!has) continue;
          const ops = await teleOps(env), full = (await env.DB.prepare('SELECT op FROM tele_import WHERE from_ts<=? AND to_ts>=?').bind(d + ' 00:00:59', d + ' 23:59:00').all()).results;
          if (!full.some(x => !ops.get(String(x.op)))) miss.push(d);
        }
        if (miss.length) lines.push(`📄 የሳምንቱ የቴሌብር መግለጫ (${miss[miss.length - 1]} → ${miss[0]}) አልተጫነም — የመርቻንቱን መግለጫ ለሳምንቱ አውርደው በአንድ ፋይል ይጫኑ።`);
      } }
    if (lines.length) await notify(env, cfg, 'closeDue', `📕 *ዛሬ የሚዘጋው፦ ${y}*\n${lines.join('\n')}\n⏰ እስከ ${cfg.closeDeadlineHour - 6} ሰዓት`);
  }
  if (await once('closeDeadline', cfg.closeDeadlineHour)) {
    const open = []; for (const g of groups) if (!(await isClosed(env, y, g))) open.push(GRP_L[g]);
    if (open.length) await notify(env, cfg, 'notClosed', `⚠️ *${y} አልተዘጋም* — ${open.join(' · ')}\nፋይናንስ ቀኑን ማመሳከር እና መዝጋት አለበት (📕 Day close)።`);
  }
}

// Housekeeping, run hourly: clear old login attempts, delete old photos, weekly Telegram backup (Sundays at the reminder hour)
async function housekeeping(env) {
  await ensureSchema(env);
  const cfg = await getCfg(env);
  await env.DB.prepare('DELETE FROM attempts WHERE ts<?').bind(Date.now() - 24 * 3600e3).run();
  const cutoff = new Date(Date.now() - cfg.photoKeepDays * 864e5).toISOString();
  if (env.PHOTOS) {
    const old = (await env.DB.prepare('SELECT shift_id,kind FROM photos WHERE in_r2=1 AND created_at<? LIMIT 500').bind(cutoff).all()).results;
    await Promise.all(old.map(p => env.PHOTOS.delete(`shift/${p.shift_id}/${p.kind}`)));
  }
  await env.DB.prepare('DELETE FROM photos WHERE created_at<?').bind(cutoff).run();
  await env.DB.prepare('DELETE FROM inspection_photos WHERE created_at<?').bind(cutoff).run();
  await env.DB.prepare('DELETE FROM incident_photos WHERE created_at<?').bind(new Date(Date.now() - Math.max(cfg.photoKeepDays, 180) * 864e5).toISOString()).run();
  await env.DB.prepare('DELETE FROM notifications WHERE ts<?').bind(new Date(Date.now() - 60 * 864e5).toISOString()).run();
  await env.DB.prepare('DELETE FROM tg_codes WHERE exp<?').bind(Date.now()).run();
  await env.DB.prepare('DELETE FROM feed WHERE sent=1').run();
  await env.DB.prepare('UPDATE feed SET sent=0 WHERE sent=2').run(); // a send that was cut off is tried again
  const d = new Date(Date.now() + 3 * 3600e3);
  if (cfg.backupTg && d.getUTCDay() === 0 && addisHour() === cfg.reminderHour && (await getKV(env, 'backup_last')) !== addisDate(0)) {
    // The backup holds everyone's money records: it goes to the Super Admin's own Telegram only
    const mine = await env.DB.prepare("SELECT chat_id FROM tg_links WHERE who='a'").first();
    const ok = mine ? await tgDoc(env, `ETEV_backup_${addisDate(0)}.json`, await buildBackup(env), `📦 ETEV weekly backup ${addisDate(0)} — keep this file private.`, mine.chat_id) : false;
    if (ok) await setKV(env, 'backup_last', addisDate(0));
    else if (!mine && (await getKV(env, 'backup_nolink')) !== addisDate(0)) { await setKV(env, 'backup_nolink', addisDate(0)); await notify(env, cfg, 'security', '📦 የሳምንቱ ባክአፕ አልተላከም፦ Super Admin ቴሌግራሙን አላገናኘም (🔔 › 🔗 ቴሌግራም አገናኝ)። ⚙️ Admin › 📦 Download backup መጠቀም ይችላሉ።'); }
  }
}

export default {
  async fetch(req, env, ctx) {
    try {
      const res = await handle(req, env, ctx);
      if (req.method !== 'GET' && ctx && ctx.waitUntil) ctx.waitUntil(flushFeed(env).catch(e => console.error('feed', e))); // post new activity to the management channel
      return res;
    }
    catch (e) { console.error('ETEV error', e && e.stack || e); return fail('Server error — please try again', 500); }
  },
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    const cfg = await getCfg(env);
    if (!cfg.groupTg) env = { ...env, TG_CHAT_ID: '' };
    ctx.waitUntil(dailyReminder(env).catch(e => console.error('reminder', e)));
    ctx.waitUntil(morningJobs(env).catch(e => console.error('morning', e)));
    ctx.waitUntil(housekeeping(env).catch(e => console.error('housekeeping', e)));
    ctx.waitUntil((async () => { await flushFeed(env); await flushFeed(env, true); })().catch(e => console.error('feed', e)));
    ctx.waitUntil(checkUsage(env).catch(e => console.error('usage', e)));
  },
};
