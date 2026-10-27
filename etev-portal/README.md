# ETEV Fleet Portal

**© 2026 Letarik Teshome. All rights reserved.**
Designed and developed by **Letarik Teshome** · letarikteshome49@gmail.com · +251 910 022 051

This is proprietary software. See [LICENSE](LICENSE). No copying, modification or redistribution without written permission.

---

# ETEV Fleet Portal — secure hosted version (Cloudflare)

Nothing sensitive is in the web page any more. PINs (hashed), bonus rates, the Telegram token and all records
live on the server. Drivers just open a link.

## One-time setup (about 20 minutes, free Cloudflare account)

1. Install Node.js (nodejs.org), then in this folder run:  `npm install -g wrangler`  and  `wrangler login`
2. Create the database:  `wrangler d1 create etev-fleet`
   Copy the `database_id` it prints into `wrangler.toml`.
3. Create the tables:  `wrangler d1 execute etev-fleet --remote --file=schema.sql`
4. Add the secrets (each command asks you to paste the value):
   - `wrangler secret put SESSION_SECRET`  → any long random text (40+ characters)
   - `wrangler secret put SETUP_KEY`       → a private key only you know (used once to set PINs, and for PIN recovery)
   - `wrangler secret put TG_TOKEN`        → your Telegram bot token
   - `wrangler secret put TG_CHAT_ID`      → your Telegram group chat ID
5. Deploy:  `wrangler deploy`   → it prints your link, e.g. https://etev-fleet-portal.YOURNAME.workers.dev
6. Set the real PINs and drivers (run once; replace the values):
```
curl -X POST https://YOUR-LINK/api/setup -H "content-type: application/json" -d '{
 "key":"YOUR_SETUP_KEY","adminPin":"123456","managerPin":"654321",
 "adminName":"Letarik Teshome","managerName":"Operations Fleet Manager",
 "vehicles":[{"plate":"ET-3-A1024","driver":"Abebe Kebede","phone":"251911223344","pin":"1024","nextStartKm":14200}]}'
```
   Choose your own PINs (staff PINs 6–12 digits, driver PINs 4 digits). Do not reuse the old defaults.
7. Send drivers the link and their own plate + PIN.

## Forgot the admin PIN?
Run step 6 again with a new adminPin. It needs the SETUP_KEY, which only exists in your Cloudflare account.

## Security notes
- Drivers can only see and submit their own plate. Start KM, charging KM and penalty waivers are set by the server, not the driver.
- Bonuses, penalties, cash variance and the gate-pass hash are calculated on the server, so editing the page changes nothing.
- 5 wrong PINs from one device, or 20 across all devices for one login, locks that login for 15 minutes.
- Every submit, approval, delete, export and settings change is written to the `audit` table
  (view with `wrangler d1 execute etev-fleet --remote --command "SELECT * FROM audit ORDER BY id DESC LIMIT 50"`).
- Driver PINs are stored hashed, so the admin panel can no longer show them. To change one, type a new 4-digit PIN in the Vehicles table.
- Optional extra: in the Cloudflare dashboard, put the site behind Cloudflare Access to add a second login layer for staff.

## Hosting the code on GitHub (auto-deploy on every push)
The repo holds only code. All secrets (PINs, Telegram token, SETUP_KEY, SESSION_SECRET) stay in Cloudflare and never go into GitHub.

1. Do README steps 1–4 once on your computer (create the D1 database, paste its `database_id` into `wrangler.toml`, run `schema.sql`, add the four secrets). The `database_id` is not a secret, so it is fine to commit.
2. On github.com create a **Private** repository (e.g. `etev-fleet-portal`) and upload this folder's contents, including the hidden `.github` folder.
3. In Cloudflare dashboard → My Profile → API Tokens → Create Token → use the "Edit Cloudflare Workers" template. Copy the token. Your Account ID is on the Workers & Pages overview page.
4. In GitHub: repo → Settings → Secrets and variables → Actions → New repository secret. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. Push to the `main` branch (or Actions tab → Deploy to Cloudflare → Run workflow). The site deploys automatically and later edits go live the same way.
6. Run README step 6 (the `/api/setup` call) once to set your PINs and drivers.

Never commit PINs, the Telegram token or the setup key. If one is ever committed by accident, treat it as leaked: change it and revoke the token in BotFather.

---

## Phase 2 update (security fixes + managers, vehicle modes, alerts, driver summary)

### What to upload to GitHub
Replace these two files (use **Add file > Upload files**, don't paste):
- `etev-portal/src/worker.js`
- `etev-portal/public/index.html`

**Do not replace `wrangler.toml`** — yours has your real database ID. Instead, open it on GitHub, click the pencil, and add these lines at the bottom (this turns on the daily reminder):

```
[triggers]
crons = ["5 * * * *"]
```

Commit, wait for the green tick in Actions, then press Ctrl+Shift+R.

### No database command needed
The database upgrades itself the first time the new version runs (adds vehicle mode, driver PIN versions and a managers table). Your existing shifts, vehicles and PINs are kept.

### After deploying
1. **Everyone is signed out once.** That's expected — sessions now end when a PIN changes.
2. **Sign in as Super Admin > ⚙️ Admin.**
   - **Fleet Managers:** your old shared manager PIN still works and shows up here as one manager after its first login. Add each manager with their own 6–12 digit PIN and press Save. Untick "on" to switch a manager off — they're signed out immediately.
   - **Vehicles > Mode:** set each vehicle to 🔵 Cabby, 🟢 Route, or Either. A locked vehicle can only submit that logbook.
   - **Alerts & daily reminder:** choose the reminder hour (Addis time, default 21 = 9 pm) and the "too many KM in one shift" limit (default 400). Press **Send reminder now** to test.
3. Drivers get a **📈 My Summary** button: their last 7 days and this month — bonus, penalties, cash shortfall, what they must pay, and net bonus. Staff can open any driver's summary by clicking the plate in the dashboard.

### Rules that changed
- Drivers can only date a shift today or the previous 2 days, and can't resubmit a day that's already approved.
- Shifts over 1,000 KM are refused (typo protection). Over the alert limit (default 400) they're accepted but flagged.
- If a driver submits day 2 before day 1 is approved, day 2 now starts from day 1's End KM.
- Approving twice (double tap) is blocked. Deleting the newest approved shift rolls the vehicle's Next Start KM back.
- Telegram alerts (sent in the background): low battery, odometer gap, cash shortfall, excess KM, too many KM, gate pass locked.

---

## Phase 3 update (everything remaining)

### Upload to GitHub (inside the `etev-portal` folder)
Use **Add file > Upload files** and upload **all** of these from the zip:
- `src/worker.js`
- `public/index.html`
- `public/styles.css` (new)
- `public/sw.js` (new)
- `public/manifest.webmanifest` (new)
- `public/icon-192.png`, `public/icon-512.png` (new)
- `public/_headers` (updated)

Don't replace `wrangler.toml` (it has your database ID). Only add the `[triggers]` lines from the Phase 2 section if you haven't yet.
No database command is needed; the database upgrades itself again (version 3).

### What's new
- **Return to driver:** managers can send a pending report back with a reason. The driver sees a red banner, presses "Fix & resend", corrects it and sends again.
- **Photo proof:** the driver attaches an odometer photo and the Telebirr SMS/receipt screenshot. Photos are shrunk on the phone (about 150–300 KB). Managers tap 📷 / 🧾 to view. Admin can make photos required before approval. Old photos are deleted automatically (default 60 days).
- **Driver debt:** "Driver must pay" amounts add up to a debt per driver. Managers record payments in the driver summary; the debt goes down, and the dashboard, daily reminder and payout CSV show who still owes.
- **⚡ Charging log:** managers record each charge (kWh, cost, battery %, odometer). The dashboard shows kWh per 100 KM and energy cost per KM for each vehicle.
- **🔧 Service reminders:** in Admin > Vehicles set "Service every KM" (e.g. 10000) and "Last service KM". The dashboard and daily Telegram reminder warn when service is near or overdue; press "Mark serviced" after the service.
- **📦 Backup:** Admin > Download backup (one JSON file). Optionally every Sunday to Telegram. PINs are never included.
- **Install as an app:** on Android Chrome open the link > ⋮ > "Add to Home screen" (or "Install app"). On iPhone Safari: Share > "Add to Home Screen".
- **Faster page:** no more Tailwind CDN. The styles are in `public/styles.css`.
- **Other fixes:** battery % and End KM are required, no fake pre-filled numbers, approve/delete/payments save all-or-nothing, reports waiting >24h are flagged, CSV has more columns and a "from" date, history search box, stricter security headers.

### Important when you change the page later
`styles.css` is generated from `index.html`. If a new design change uses new style classes, ask me to regenerate `styles.css` together with `index.html`, otherwise those new styles won't show.

### Custom domain (optional)
If you own a domain on Cloudflare (e.g. `etev.com`): Workers & Pages > your Worker > Settings > Domains & Routes > Add > Custom domain > `fleet.etev.com`. The `workers.dev` link keeps working.

---

## Version 3.1: Energy trends, driver ranking, Cabby/Yango check

Upload `src/worker.js`, `public/index.html`, `public/styles.css` and `public/sw.js` to GitHub. No database command needed (it upgrades itself to version 4).

The Dashboard now has four tabs:

- **📊 Overview** — the same dashboard as before.
- **⚡ Energy trends** — fleet kWh per 100 KM by week (lower is better), kWh charged per day, and each vehicle's kWh per 100 KM against the fleet average. ⚠ marks vehicles more than 15% above average. Hover a chart for details; "Table view" shows the numbers. Needs charging sessions logged in ⚡ Charging.
- **🏆 Driver ranking** — score out of 100: gate cleared 20, cash complete 25, reporting every day 15, no KM penalty 10, matches Cabby/Yango 10, productivity 20 (trips per shift, compared only within Cabby drivers or within Route drivers). At least 3 approved shifts are needed. Drivers see their own rank in 📈 My Summary.
- **🔍 Cabby / Yango check** — export the trip report from the Cabby or Yango partner dashboard as CSV and upload it. The portal guesses the columns (plate, date, trips, distance, cash); check them and press Import. It then lists every vehicle-day where the driver's report differs from the platform: trip count, KM, cash not declared, bonus claimed above what the platform supports, or platform trips with no shift report at all. Importing the same day again replaces it. A Telegram summary is sent if mismatches are found.
  - Plates are matched even if written differently ("ET-3-A1024", "3 A1024", "A1024").
  - If the report has one row per trip, leave "Trips" as "none" — each row counts as one trip.
  - Choose "metres" if distance is in metres. For Excel files: File › Save As › CSV.

---

## Version 3.2: Route logbook trip by trip (replaces the paper logbook)

Upload `src/worker.js`, `public/index.html`, `public/styles.css` and `public/sw.js`. No database command needed.

**Driver (route vehicles):** choose the route, enter the battery % at start, then after every trip press **＋ ጉዞ ጨምር**:
- Direction: shows "From → To" and switches automatically on each new trip (tap it to change).
- Start / end time: 🕒 fills in the current time. The next trip starts at the previous trip's end time.
- Passengers: full-line fare and half-line fare (to/from the middle stop), plus cash and Telebirr.
- Each trip shows ✓ when the money equals passengers × fare, or ⚠ with the difference.
- Trips stay saved on the phone during the day, even if the page is closed, until the report is sent.

**Calculated automatically:** trips and round trips (one each way = one round), total passengers, fares expected vs collected, cash vs Telebirr, hours from first trip to last trip, and overtime above the standard day (8 hours, set in Admin).
**Cash rule:** Telebirr goes straight to the company, so the driver deposits the cash only. If the fares expected are higher than the money collected, a "Fares short" alert goes to Telegram and the dashboard.

**Admin › Routes & fares:** add or change routes (name, start, middle stop, end, full fare, half fare). Default: አውቶቡስ ተራ – 4 ኪሎ – መገናኛ, 60 / 30 birr. Approved records keep the fares and standard hours they were approved with.

**Reports:** dashboard (passengers, overtime hours, fares short, Telebirr), driver summary, CSV export (trips, passengers, fares, cash, Telebirr, first start, last end, work hours, overtime) and the monthly payout CSV (passengers, work hours, overtime hours).

---

## Version 3.3: Telebirr daily total + statement check

Upload `src/worker.js`, `public/index.html`, `public/styles.css` and `public/sw.js`. No database command needed (it upgrades itself to version 5).

- **Cabby / Yango form:** new field **"Telebirr received (ቴሌብር ጠቅላላ)"** — the day's total that passengers paid to the vehicle's company Telebirr QR. No individual receipt numbers. It is recorded but NOT part of the cash the driver deposits. (Route vehicles already get this total from their trips.)
- **"Deposit receipt no."** (formerly "Telebirr Ref") is now only the receipt number of the driver's cash deposit — one per day.
- **Admin › Vehicles › Telebirr QR / merchant no.:** enter each vehicle's own number. Two vehicles cannot share a number.
- **Dashboard › Cabby / Yango check › "Telebirr statement":** upload the statement CSV of the vehicles' merchant numbers. The portal adds up the payments per vehicle per day and compares them with the Telebirr total each driver reported:
  - driver reported MORE than the statement → flagged as money missing (counted in "Cash not declared")
  - driver reported less → flagged for review
  - payments on a day with no shift report → flagged
- Telebirr totals appear in the report, Telegram message, CSV export and dashboard.

## Version 3.4: KM penalty ledger (የቅጣት መዝገብ)

- **Order of deductions per shift:** the cash shortfall comes off the bonus first, then the KM penalty. Whatever the bonus cannot cover becomes **driver debt**.
- **Ledger per vehicle:** for KM penalties it shows total, from bonus, paid, unpaid and waived. For the cash shortfall it shows paid and unpaid. Older approved shifts are included automatically.
- **Payments have a type:** 📏 KM penalty or 💵 cash shortfall. The form picks the open one by default.
- **Gate lock:** while the driver owes more than **Lock gate when debt is over** (Admin → default 500 ETB, 0 = never), the vehicle shows 🛑 on the dashboard, in the driver summary, in the daily Telegram check and in the payout CSV.
- **Waivers:** admin only, a reason is required, and the waived amount and reason stay on the record and in the audit log.
- **Dashboard:** four penalty cards (total / from bonus / paid / unpaid) plus a count of vehicles locked for debt.
- **Payout CSV:** new columns PenaltyFromBonus, PenaltyToDebt, PenaltyWaived, PenaltyPaidThisMonth, OutstandingPenaltyAllTime and GateLockedForDebt.
- The database upgrades itself (schema v6 adds `payments.kind`). No command is needed.

## Version 4.0: Roles, permission switches, drivers separate from vehicles

- **Five roles:** Super Admin, Manager, Fleet Admin, Finance and Driver. Each staff member has their own name and PIN (Admin › Staff users).
- **Permission switches:** Admin › Permissions has an ON/OFF box per role for 15 permissions. Changes apply at once and are written to the audit log.
  Always Super Admin only: rules and rates, KM penalty waivers, changing or deleting approved reports (a reason is required), staff users and permissions, salaries, Super Admin PIN, backup and Telegram.
- **Approvers do not type over the driver's numbers.** A manager approves or returns a report exactly as the driver sent it. Only the Super Admin can enter a report for a driver or change an approved one (with a reason).
- **Drivers are records of their own:** name, phone, PIN, salary, debt and history. Vehicles have a main driver, and the Fleet Admin can assign another driver for a day (🚐 Fleet › Day assignment).
  Drivers sign in with **phone number + PIN**. Plate + PIN still works for drivers without a phone on file.
- **Debts belong to the driver**, not the vehicle. The payout report is per driver.
- **Fleet Admin** (🚐 Fleet): drivers, PINs, vehicles, day assignments, next start KM (with a reason, sent to Telegram), charging, service, manager performance.
- **Finance:** driver payments, Telebirr / Cabby / Yango statement check, money reports, payout and CSV. Money figures are hidden from roles without the money-reports permission.
- **Upgrade:** the database upgrades itself (schema v7). Each vehicle's current driver becomes a driver record with the same PIN. Reports and payments are linked to them, and everyone stays signed in.

## Version 4.1: Finance

- **💼 Finance dashboard** (money-reports permission): money in vs money out, net, passengers and unpaid driver money.
  - Each card shows the change against the period before it.
  - Periods: today, this month, last month, 3 months, a year, or your own dates (daily, weekly or monthly points).
  - Charts: net by vehicle, fares by source, where the money went, passengers, and unpaid money by age.
  - Download as Excel (CSV) or print / save as PDF.
- **Money in** = cash deposited + Telebirr + driver payments. **Money out** = charging + expenses + salaries + overtime pay + bonus actually paid (after cash-shortfall and KM-penalty deductions).
- **🧾 Expenses**: by vehicle (or company-wide) and category, with receipt number and photo.
  - An expense can cover 1, 3, 6 or 12 months and is spread evenly over them, so an annual insurance payment does not distort one month.
  - Finance records every category. The Fleet Admin records repair-type categories ("Fleet" ticked in Admin › Expense categories). Only the Super Admin deletes.
- **Overtime pay**: Cabby/Yango drivers now enter the time they started and finished. Overtime = hours over the standard day × "Overtime pay (ETB per hour)" in Admin. The rate is frozen on each approved report.
- **💵 Payroll** per driver and month: salary for the days the driver had a vehicle (main driver or a day assignment, counted from the day they were added) + bonus after deductions + overtime pay, the unpaid debt, and the amount after debt. Download as Excel. Salaries are visible only with the see-salaries permission.
- The database upgrades itself (schema v8 adds `expenses`).

## Version 4.2: Cabby / Route filter, folded report form

- **Finance › ሁሉም / 🔵 ካቢ / 🟢 ቀጠና:** every card, chart, vehicle row, the payroll and the Excel download can show one business line.
  - Reports count by their own mode.
  - Charging, expenses, salary and driver payments count by the vehicle's registered mode.
  - Company-wide expenses and the costs of "either" vehicles appear only under "All".
- **Super Admin report form** is folded away behind "✏️ Enter or correct a report for a driver". It opens by itself when you edit a report. Drivers still enter their own reports on their phones.

## Version 4.3: Day close, devices, breaks, incidents, personal Telegram

The database upgrades itself to schema v9 on the first request. Nothing to run by hand.

- **📕 Day close (Finance):** each day is closed separately for 🔵 Cabby and 🟢 Route.
  - **What blocks a close:** reports still waiting for approval, and returned reports the driver has not fixed. Finance can cancel a returned report, with a reason.
  - **Vehicles with no report:** each needs a reason (idle, repair, absent, leave, other). A vehicle in repair gets "repair" filled in automatically.
  - **Money:** if cash or Telebirr does not match, a note is required. Finance also ticks that the money was checked against the bank and the statement.
  - **After closing:** a snapshot of the day is saved, and the day is locked for everyone:
    - reports, approvals, returns and deletes;
    - payments, charging, vehicle expenses and assignments.
  - **Reopening:** only the Super Admin can reopen a day, and must give a reason.
  - **Drivers:** they may now report up to 7 days back (Admin setting) while the day is still open. This replaces the old "2 days" rule.
- **📱 Device on every audit line:**
  - **What is recorded:** a device id kept on the phone (shown as `D-XXXX`), the phone model and browser, the IP address and the city.
  - **GPS:** recorded when a driver sends a report or a problem, if the driver allows it.
  - **Alerts to the Super Admin:** a new phone for someone, or one phone used by two people.
  - **🔒 Device lock (Admin, off by default):** a driver's second phone waits until the Fleet Admin approves it in 🚐 Fleet › 👤 Drivers › 📱. Blocking a phone signs it out at once.
- **Easier sign-in:**
  - **Remembered phone:** the phone keeps the driver's number, so the driver types only the 4-digit PIN. Sign-in happens at the 4th digit.
  - **Session length:** drivers stay signed in for 7 days (Admin setting). Staff still sign in for each browser session.
- **🟢 Route trip times:** "＋ ጉዞ ጨምር" fills in the start time and "🏁 ደረስኩ" fills in the end time. A time typed by hand is marked ✎ for the manager.
- **☕ Breaks:** the driver presses start and stop.
  - Break time is taken off working time and overtime.
  - A break over the limit is flagged. The limits are set in Admin: minutes per break and breaks per day.
- **🚨 Problem report:** the driver picks what happened, adds a note, up to 3 photos and GPS, and has call buttons for the Fleet Admin and emergency numbers.
  - **Telegram:** the report goes at once to the people set in Admin.
  - **Accident, breakdown or injury:** the vehicle goes "⏸ under review". It cannot be assigned, and no report can be sent for it after that day.
  - **Fleet Admin decision:** ✅ back to work, or 🔧 repair until a date. The main driver's salary still counts on repair days.
- **🔴 Live panel (staff):** open incidents with map and photos, vehicles off the road, and drivers on a break or over the limit.
- **🔔 Personal messages instead of one shared group:**
  - **Linking:** everyone (staff and drivers) presses 🔔 › 🔗 *Link my Telegram* once, then Start in the bot.
  - **Messages and setup:**
    - **Admin grid:** a table in Admin decides who gets what: nothing, 🔔 only, or 🔔 + Telegram.
    - **Morning summary:** money lines go only to people with the money permission.
    - **Reminders:** at 4 ሰዓት, managers, Finance and drivers are reminded about the day to close. At 6 ሰዓት, the Super Admin is told if the day is not closed.
    - **Drivers are told:** returned, approved (bonus, penalty, debt), payment recorded, tomorrow's vehicle, and a missing-report reminder.
    - **Weekly backup:** goes to the Super Admin's own Telegram only.
    - **Old group:** the shared group keeps working until "Keep the shared group" is switched off in Admin.
    - **Staff who leave:** switching off a staff member or driver removes their Telegram link.
  - ⚠️ The bot's webhook is set automatically the first time someone links. Do not use the same bot for anything else that reads its messages.
- **New permissions:** `closeDay` (Finance by default) and `incidents` (Fleet Admin by default).

## Version 4.4: Management channel (📢 ቻናል)

- **What gets posted:** one private Telegram channel, for management only, receives everything that happens in the portal:
  - every action from the audit log, with who did it, their phone (`D-XXXX` and model), city and GPS map link;
  - every approved report in full, with its odometer and receipt photos;
  - every incident, with map and photos;
  - the morning summary, including money, and the 4 ሰዓት and 6 ሰዓት day-close messages.
- **Hourly bundle:** small actions (sign-ins, breaks, exports) are collected and posted once an hour in one message, so the channel stays readable.
- **Link it:**
  1. Create a private channel.
  2. Add the bot as a channel admin with "Post messages".
  3. Go to ⚙️ Admin › 📢 *Link a channel*.
  4. Paste the code it shows into the channel.
- **Old group:** linking the channel switches the old shared group off. Unlinking stops all posting at once.
- If Telegram is busy, posts wait and are retried. Nothing is lost while the channel is linked.
- Schema v10, created automatically: a `feed` queue filled by a database trigger on the audit log.

## Version 4.5: Faster on Cloudflare's free plan, GPS fix

- **Number columns:** each report's money numbers (cash, bonus, penalty, debt parts, overtime, KM, passengers, receipt number) are now also stored in their own columns. The database adds them up, so the Worker no longer reads every report's full record. This matters because the free plan allows about 10 ms of Worker CPU per request.
- **Measured** with one year of test data for 50 vehicles (18,250 reports):
  - Dashboard: 213 → 21 ms
  - Finance for a year: 516 → 65 ms
  - Payroll: 156 → 18 ms
  - Approve a report: 58 → 8 ms
  - Record a payment: 59 → 5 ms
  - Driver summary: 55 → 6 ms
- **Receipt-number check:** it now uses an index instead of searching every report.
- **Unchanged results:** every figure is the same as before (551 checks).
- **Upgrade:** schema v11 fills the new columns once, on the first request.
- **🐞 GPS fix:** the `Permissions-Policy` header had `geolocation=()`, which blocked the location on reports and problem reports. It is now `geolocation=(self)`. The test server now sends the real headers, so this is tested.

## Version 4.6: Free-plan watch (📈)

Every hour the portal reads the real usage from Cloudflare (GraphQL Analytics) and GitHub and compares it with the free-plan limits:

- **Cloudflare (daily limits):**
  - Workers: 100,000 requests a day, across all Workers on the account.
  - D1: 5,000,000 rows read and 100,000 rows written a day.
  - D1 storage: 5 GB.
  - Also shown: this Worker's CPU P99 against the 10 ms limit, and any requests that were stopped for CPU.
- **GitHub:**
  - Actions: 2,000 minutes a month for private repos. Each run is rounded up to a minute. The figure counts this repo only.
  - Repo size: about 1 GB.
  - A warning comes 14 days before the GitHub token expires.

At **60 %, 80 % and 95 %** a message goes to the Super Admin's Telegram and to the 📢 channel, once per level per day, month or total. The message also shows where today's or this month's pace will end. At 95 % of a D1 daily limit it warns that the portal will stop until 00:00 UTC. Bars are in ⚙️ Admin › 📈.

**Setup (one time), as Worker Secrets in Cloudflare › etev-fleet-portal › Settings › Variables and Secrets:**
- `CF_API_TOKEN`: a custom token with **Account › Account Analytics › Read** only.
- `CF_ACCOUNT_ID`: your account ID.
- `GH_TOKEN`: a fine-grained token for this repository only, with **Actions: Read-only**.
- `GH_REPO` (optional): defaults to `hayelemikael/etev-fleet-portal`.

## Version 4.7: Reports without internet (📤) and the 🌙 "sent late" mark

- **Kept on the phone:** everything a driver types (Cabby/Yango and Route), and the photos, is saved on the phone as it is typed. Closing the page or losing the signal loses nothing.
- **📤 Outbox:** pressing Send with no internet keeps the whole report (photos and GPS included) on the phone. It goes by itself when the internet comes back (every minute, when the page opens, or with "🔄 send now"). The page also opens with no internet for a driver who signed in before.
- **Refused reports:** if the server refuses a waiting report (wrong KM, closed day…), it stays in the outbox with the reason and a ✏️ fix button that puts it back into the form.
- **🌙 Sent late:** a report filled with no internet, or sent more than *N* hours after the work ended (⚙️ Admin, default 3, 1–48), is marked. The mark shows in the approval queue, history (search "late"), 🔔 and Telegram, and stays after approval.
- **Phone clock check:** if the phone's clock is 10 minutes or more away from the server's, the report gets a "🕒 phone clock is off" alert.

## Version 4.8: Telebirr payment by payment (📱)

- **Driver:** each passenger payment is recorded on its own: amount, time and transaction number. Three ways:
  - 📱 **The Android app (1.0.5+) reads the Telebirr payment SMS by itself** once the driver allows it. Only Telebirr payment messages are read, and only the amount, time and transaction number are kept — never the payer's phone number or the balance.
  - 📋 **Paste the SMS** (several at once is fine) — the numbers are read from the text.
  - ✍️ **Type it** (amount, transaction number, time).
- Works with no internet (kept on the phone, sent later). The day's Telebirr total fills itself; on a Route vehicle each payment goes on the trip that was running at that time.
- **One transaction number counts once.** If another vehicle tries to record the same number it is refused and shown to Finance (🔁).
- **Finance › Dashboard › 📱 ቴሌብር:** upload the merchant statement (.xlsx, as downloaded from the telebirr merchant portal; several files at once). The Telebirr number is read from the file name (`MiniStatement714971-…`): the merchant number covers all vehicles; an operator number (set it in 🚐 Fleet › Vehicles › *Telebirr operator no.*) belongs to one vehicle. Loading the same file twice counts nothing twice.
- **The check, per vehicle and per payment:** ✅ matched · 💰 amount differs · ⚠️ recorded by the driver but not in a statement that covers that time · ℹ️ in the statement but nobody recorded it · ⏳ statement not loaded yet.
- The statement-confirmed total per vehicle feeds the existing Cabby/Yango check and the 📕 day close; a day with ⚠️, 💰 or 🔁 needs a note before it can be closed. A report whose Telebirr total differs from the SMS total gets an alert.
- **Finance decisions (📱 ቴሌብር › 🔍):** ✔ *explained* (with a note) or 💸 *to the driver's debt* (the missing amount is added to the driver's cash debt and the driver is told); ↺ reopens. A payment nobody recorded can be given to a vehicle (➜) with a note. All decisions are audited and locked once the day is closed. 📥 *Excel (CSV)* exports every payment with its status and decision; the page shows today, yesterday, 7 or 30 days, or any range.
- **📄 Smart statement rule** (⚙️ Admin; or "daily" to require it every day): the statement is needed only for days where something looks off — a typed payment, a double claim, a report total that differs from the SMS total, much more Telebirr than the vehicle's usual day — plus a random share of days (default 10 %). Such a day cannot be closed until a full-day statement (00:00–23:59) is loaded. Finance is reminded at the close-reminder hour, and every Monday if last week's statement is missing.
- **App 1.0.5:** only SMS from Telebirr's sender **127** are read; a look-alike message from any other number is ignored.
