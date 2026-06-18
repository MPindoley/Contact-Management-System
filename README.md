# Relationship Hub

A service execution layer that sits on top of Redtail. It doesn't replace the
CRM — it answers the one question Redtail can't:

> **Who needs attention from me today?**

Built with React + TypeScript + Tailwind on a Supabase backend. Phase 1
complete: the five screens, the service engine, auth, and manual client entry.

![Built for a two-advisor + assistant firm](https://img.shields.io/badge/phase-1-2f6a4f)

## Quick start

```bash
npm install
npm run dev
```

That's it — the app boots in **demo mode**: a seeded book of 15 households
with 14 months of contact history, persisted in your browser. Sign in as
Matt, Advisor B, or the Assistant and the morning dashboard is already alive.
No Supabase project required to evaluate the workflow.

When you're ready for the real backend (shared data, real sign-in), follow
[`supabase/README.md`](supabase/README.md) — about ten minutes — and fill in
`.env` from `.env.example`. The app detects the config and switches over
automatically.

```bash
npm test        # service engine + adapter integration tests
npm run build   # typecheck + production bundle
```

## How it works

### The tables

Six tables run the client engine; two more (`prospects`, `prospect_events`)
are a separate island for not-yet-clients that never touches the engine.

| Table | What it holds |
| --- | --- |
| `clients` | One row per household: name, advisor (Matt / Advisor B / Joint), tier (A/B/C), active flag, Redtail ID for the future sync |
| `users` | Matt, Advisor B, Assistant — role decides the default view |
| `service_models` | The rules per tier. **Editable, not hardcoded** |
| `contact_events` | The heart of the system: every completed Meeting / Meaningful Call / Admin touch |
| `due_dates` | Computed, never set by hand: latest qualifying touch + the tier's interval |
| `tasks` | System-generated queue items, rebuilt nightly at 6am |

### The service engine

Log a completed call and the system:

1. reads the client's tier → pulls the service model rules,
2. computes the next due date (last contact date + interval),
3. writes it to `due_dates`,
4. settles the matching open task and rebuilds the client's queue.

Overdue items auto-escalate to high priority, sorted by days overdue. The
nightly job (`rebuild_tasks()`, pg_cron or the edge function) re-ages the
whole queue every morning before you walk in.

The engine exists twice, deliberately: once as **Postgres triggers**
(`supabase/migrations/0001_init.sql`) so the database stays consistent no
matter who writes to it, and once as **pure TypeScript**
(`src/engine/serviceEngine.ts`, fully unit-tested) powering demo mode. Keep
them in sync if you change the rules.

Two design decisions worth knowing:

- **Meeting and call clocks are independent.** A meeting resets the meeting
  clock only. That's what makes Tier A ≈ 4 meetings + 12 calls = 16
  touches/year, and it matches the score formula.
- **Admin touches never reset the clock** and never count toward scores.
  They're recorded for the history, nothing more.

### Tiers & the default cadence

Tiers run **S (your very top) → A → B → C**.

| Tier | Meeting | Meaningful call | ≈ touches/yr | Default criteria |
| --- | --- | --- | --- | --- |
| S | every 90 days | every 30 days | 16 | $250k+ |
| A | every 90 days | every 30 days | 16 | $100k+ |
| B | every 365 days | every 90 days | 5 | $25k+ |
| C | every 365 days | every 180 days | 3 | below |

Everything is editable on the **Tiers & service models** screen: the cadence
(saving reflows every due date) *and* the criteria — each tier's revenue
floor and description. Those floors feed the CSV importer's auto-tiering, so
"what defines a tier" lives in one place and changes as your book grows.

### The service score

`contacts completed on schedule ÷ contacts required`, trailing 12 months,
capped per channel (eight calls never excuse a missed annual meeting).
Requirements prorate for recently added households. Rolled up by advisor and
firm, weighted by required contacts — so a neglected Tier A household moves
the needle more than a quiet Tier C one. Green ≥ 90, yellow ≥ 70, red below.

### The five screens

1. **Morning Dashboard** — three columns: calls due today, meetings to
   schedule, overdue (sorted by severity). Plus the next 7 days on the
   horizon. Advisors see their book + joint by default.
2. **Action Queue** — every open item you can see (your own book + joint; a
   senior advisor and the assistant see the whole firm); filter by advisor,
   tier, type; sortable.
3. **Client Profile** — 12 months of touches, current due dates, health
   score. Service history only, on purpose.
4. **Log Contact** — the modal that drives the whole system. Press `L`
   anywhere. The toast tells you the freshly computed next due date.
5. **Firm Service Report** — scores by advisor and tier, overdue counts,
   contacts this month vs the pace the book demands. Monday standup, ready.

### Daily-use touches

- **Families** — link spouses / family members (Client Profile → Family panel,
  a **"Link families"** button on the Clients screen, or opt-in auto-link during
  import). Surname linking is **book-aware**: only households that share a last
  name *and* the same advisor pair up, so two unrelated "Nguyen"s in different
  advisors' books never merge. The Clients-screen button previews every proposed
  group — each with its book and members, individually checkable, filterable to
  one book — so you confirm exactly what merges before it does. See their
  **combined assets** and the tier the saved criteria suggest for the combined
  total, with one click to apply it to everyone. Each household keeps its own
  profile and service schedule; designate roles (spouse, child, grandchild…) and
  unlink any wrong link. Stored in their own `families` table.
- **Import follows your tier criteria** — when a revenue/AUM column is mapped,
  the importer auto-assigns S/A/B/C straight from the floors you set on the
  **Tiers & service models** screen (no separate cutoffs to re-enter), and it
  persists each household's AUM.
- **Re-tier without a CSV** — change a tier's revenue floor and the **Tiers &
  service models** screen offers to re-grade your *existing* book against the
  new criteria: it shows exactly how many households would move and lets you
  review every from→to before applying — no re-upload. Households are graded on
  the AUM on file (family members on their **combined** assets), and any
  household with no AUM is left exactly as you set it, so hand-tuned tiers are
  never clobbered. Applying reflows due dates through the same engine.
- **Money to capture** — flag a household that has held-away assets or money
  due (checkbox + a note, or a "Money to Capture" CSV column). It shows a
  green **$ Capture** highlight on the dashboard, queue, profile, and the
  log-contact modal — so it's front of mind exactly when you schedule.
- **Re-import to reconcile** — importing a CSV now *updates* existing
  households where the data differs (tier/grade, advisor, phone) instead of
  skipping them, and never touches their logged contact history. Matching is
  by name (and Redtail id) across all books, so re-importing the right
  advisor list fixes a household that landed in the wrong book — and the
  Clients screen flags any household that appears in more than one book so
  you can delete the stray copy.
- **Voicemail tracking** — log a "Voicemail" when you call and don't connect.
  It's recorded as an attempt (shown in violet in the history, counted on the
  call card as "N voicemails since you last reached them") but it **never
  resets the call clock or touches any score** — the call stays on your list.
  Pick "try them again in 3 days" and it snoozes off today and comes back.
- **Prospects** — a separate **Prospects** tab for people you're calling who
  aren't clients yet. Their own pipeline (New → Working → Appointment →
  Converted/Lost), attempt + voicemail tracking, follow-up dates, tap-to-call,
  and a one-click Convert to client. **Completely isolated** — prospects live
  in their own tables and never feed due dates, tasks, scores, or the firm
  report, so they can't move a single client graph.
- **Phone numbers** — store a number per household (manual form or a mapped
  CSV column). It shows as a tap-to-call link on call cards, the queue, and
  the profile — so when a call comes due, the number's right there and dials
  straight from your phone. Meetings don't show it; it's there for calling.
- **Per-advisor privacy** — each advisor's book is private. A **senior advisor**
  (the `sees_all_books` flag) and the **assistant** see every client; every
  other advisor sees only their own households **plus joint** ones — never a
  colleague's. **Prospects are stricter still:** each advisor sees *only* their
  own pipeline (the assistant sees all) — even a senior advisor doesn't see
  another advisor's prospects. It's enforced two ways: the app filters what it
  shows, *and* Postgres **row-level security** makes the hidden rows unreadable
  and unwritable over the API, so a restricted advisor can't reach another's
  book even outside the UI. (In the demo: Matt sees every client but only his
  own prospects, Beau sees only his book + joint, Carolyn the assistant sees
  everyone.)
- **Your book by default** — the Clients list opens filtered to the signed-in
  advisor; switch to Joint, a colleague, or All (within what you're allowed to
  see) when you want. Sort the list by household, tier, or service score.
- **Plan initial outreach** — a never-contacted household has no history, so
  the engine gives it no due date and it stays invisible. The Clients screen
  flags how many there are and offers a one-time **Plan initial outreach**:
  it schedules a first-touch call for each, Tier A first, a few per weekday
  (weekends skipped) over a stretch you choose. The 14-day horizon then keeps
  all but the imminent ones off the dashboard, so they arrive a handful a day.
  Logging the first real call converts the household to its normal cadence;
  these placeholders survive service-model edits but never overwrite real
  history. Flagged with a gold "First outreach" badge until contacted.
- **Deactivate or delete a household** — Edit a client to pause them (kept,
  but off the schedule and out of the queue) or **Delete household** to erase
  them and all their contact history for good (a confirm guards it). Deleting
  cascades — events, due dates, and tasks all go with them.
- **Fix & undo** — hover any touch on a Client Profile to edit or delete it;
  the due date reflows through the same engine, so a mis-logged date never
  leaves a stale reminder.
- **Snooze** — "left a voicemail, remind me Thursday." Defers a touch off the
  dashboard and queue for 3 days / 1 week / 2 weeks without falsely resetting
  the service clock; it reappears on the day, still aged from the real due
  date, and any logged contact clears it. Un-snooze from the Client Profile.
- **Export & print** — Download-CSV on the Action Queue (the filtered list)
  and the Firm Report (a per-household service ledger), plus a clean Print
  view of the report for standup.
- **Install on your phone** — it's a PWA: "Add to Home Screen" on iOS/Android
  and it opens full-screen like a native app, with the shell cached for
  flaky-signal moments.

## Project layout

```
supabase/
  migrations/0001_init.sql      schema + service engine triggers + seeds
  functions/rebuild-tasks/      the 6am queue rebuild (edge function option)
src/
  engine/serviceEngine.ts       due dates, tasks, scores (pure, tested)
  lib/data/                     demo adapter (localStorage) + Supabase adapter
  lib/store.tsx                 auth + snapshot state
  components/                   UI kit, log-contact modal, client form
  screens/                      the five screens + service model settings
```

## Run it as a team (one site, shared data, live updates)

Demo mode keeps data in each person's browser — fine for kicking the tires,
wrong for a team. To get all three of you on **one URL with one dataset**:

1. **Create the shared backend** — follow [`supabase/README.md`](supabase/README.md)
   (one Supabase project, run the migration, set the three emails, invite
   everyone). Realtime is part of the migration: when anyone logs a contact,
   every open dashboard updates within a second, no refresh.
2. **Host the app** — import this GitHub repo at [vercel.com](https://vercel.com)
   (or Netlify; configs for both are included). When asked for environment
   variables, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your
   Supabase project's API settings. You'll get a URL like
   `relationship-hub.vercel.app` — that's the site everyone bookmarks.
3. **Stay current automatically** — every push to the GitHub repo redeploys
   the site. Nobody installs anything; the team just refreshes.

Each person signs in with their own email; the app scopes their dashboard to
their book + joint and gives the assistant the firm-wide view.

## Roadmap

- **Phase 2 — done.** CSV import from Redtail: Clients → *Import CSV*. Column
  auto-mapping, revenue-cutoff tier assignment with live counts, advisor
  value matching, duplicate detection, and last-contact dates that seed the
  service clocks on the spot.
- **Phase 3 — digest done.** Daily morning email per advisor with their
  personal queue (assistant gets the firm view); quiet days send nothing.
  Setup in [`supabase/README.md`](supabase/README.md) § 6. Outlook calendar
  pull remains optional/deferred — it needs a Microsoft Azure app
  registration, and logging a touch is already a 10-second modal.
- **Phase 4 — built, waiting on Redtail.** A nightly sync function
  (`supabase/functions/redtail-sync`) reconciles the book against the
  Redtail API: creates, renames, re-links, deactivations — never touching
  tiers or advisors, dry-run by default. Request an API key from Redtail
  support, paste in three secrets, and flip `REDTAIL_SYNC_APPLY=true`.
  Setup in [`supabase/README.md`](supabase/README.md) § 7.
