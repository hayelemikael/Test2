// 🧪 Test portal only: a full test fleet for trying the weekly plan — 10 Cabby + 6 Route vehicles, two shifts each,
// one driver per shift (32) and 5 standby drivers, rest days spread over the week. Made-up names; test PINs only.
// Runs once (skips when the test portal already has 16 or more vehicles). Usage: node seed-staging-fleet.mjs <url> <admin pin>
const [URL, PIN] = process.argv.slice(2);
const api = async (path, method = 'GET', body, tok) => {
  const r = await fetch(URL + '/api/' + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${d.error || ''}`); return d;
};
const plates = await api('plates');
if (plates.length >= 16) { console.log(`Test fleet already there (${plates.length} vehicles)`); process.exit(0); }
const tok = (await api('login', 'POST', { role: 'staff', pin: PIN })).token;
const pad = n => String(n).padStart(2, '0');
const V = [...Array.from({ length: 10 }, (_, i) => ({ plate: `TEST-C${i + 1}`, mode: 'cabby' })), ...Array.from({ length: 6 }, (_, i) => ({ plate: `TEST-R${i + 1}`, mode: 'route' }))];
// drivers 1–4 exist from the first set-up (PINs 1111–4444); the rest: phone 09000000NN, PIN = 1 + the phone's last 3 digits (e.g. 0900000012 → 1012)
const have = (await api('fleet', 'GET', undefined, tok)).drivers;
const want = Array.from({ length: 37 }, (_, i) => i + 1).filter(n => !have.some(d => d.name === `Test Driver ${n}`))
  .map(n => ({ name: `Test Driver ${n}`, phone: `09000000${pad(n)}`, pin: n <= 4 ? String(n).repeat(4) : '1' + String(n).padStart(3, '0'), active: true }));
if (want.length) await api('fleet/drivers', 'PUT', want, tok);
const D = Object.fromEntries((await api('fleet', 'GET', undefined, tok)).drivers.map(d => [d.name, d.id]));
// vehicles: the morning driver is the main driver
await api('fleet/vehicles', 'PUT', V.map((v, i) => ({ plate: v.plate, mode: v.mode, driverId: D[`Test Driver ${i * 2 + 1}`], seats: v.mode === 'route' ? 12 : 4, ...(plates.some(p => p.plate === v.plate) ? {} : { nextStartKm: 1000 * (i + 1) }) })), tok);
// usual shift and rest day: vehicle i → morning driver 2i+1, afternoon driver 2i+2; drivers 33–37 standby
const pairs = [];
V.forEach((v, i) => { for (const sh of [1, 2]) { const n = i * 2 + sh; pairs.push({ driverId: D[`Test Driver ${n}`], homePlate: v.plate, homeShift: sh, restDow: n % 7, standby: false }); } });
for (let n = 33; n <= 37; n++) pairs.push({ driverId: D[`Test Driver ${n}`], homePlate: '', homeShift: 1, restDow: (n * 3) % 7, standby: true });
await api('roster/pairings', 'PUT', pairs, tok);
console.log(`Test fleet ready: ${V.length} vehicles, ${Object.keys(D).length} drivers`);
