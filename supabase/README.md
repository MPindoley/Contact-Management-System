# Supabase backend setup

The app runs in **demo mode** with zero setup. When you're ready for a real
backend (shared data, real sign-in), it takes about ten minutes:

## 1. Create the project

Create a new project at [supabase.com](https://supabase.com) (free tier is
plenty for Phase 1).

## 2. Apply the schema

Open **SQL Editor** in the Supabase dashboard, paste the contents of
[`migrations/0001_init.sql`](migrations/0001_init.sql), and run it.
(Or, with the Supabase CLI linked to your project: `supabase db push`.)

This creates the six tables, the service-engine triggers, the tier rules
(A: 90/30, B: 365/90, C: 365/180), and the three user profiles.

## 3. Wire up the people

Set each person's email so their first sign-in auto-links to their profile:

```sql
update users set email = 'matt@yourfirm.com'      where advisor_key = 'matt';
update users set email = 'advisorb@yourfirm.com'  where advisor_key = 'advisor_b';
update users set email = 'assistant@yourfirm.com' where role = 'assistant';
```

Then invite the three of them from **Authentication → Users → Invite user**
(or let them use the app's sign-up form with those emails).

### Auth URLs — do this or email links will point at localhost

In **Authentication → URL Configuration**:

- set **Site URL** to where the app actually lives (your Vercel URL, e.g.
  `https://relationship-hub.vercel.app`) — the default is
  `http://localhost:3000`, which only works on a developer's machine;
- add the same URL to **Redirect URLs**.

For a three-person internal tool you can skip confirmation emails entirely:
**Authentication → Sign In / Providers → Email → turn off "Confirm email"** —
accounts then work the moment they're created.

## 4. Point the app at the project

In the repo root:

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
**Project Settings → API**, then restart `npm run dev`. The app detects the
config and switches from demo mode to Supabase automatically.

## 5. Schedule the 6am rebuild

The queue is rebuilt automatically on every write, but the nightly job is what
re-ages overdue items each morning. Two options:

- **pg_cron (recommended):** enable the `pg_cron` extension
  (Database → Extensions), then run — remembering cron is UTC:

  ```sql
  select cron.schedule('rebuild-tasks-daily', '0 11 * * *', $$select rebuild_tasks()$$);
  ```

- **Edge function:** `supabase functions deploy rebuild-tasks`, then add a
  schedule in Dashboard → Edge Functions. Source:
  [`functions/rebuild-tasks/index.ts`](functions/rebuild-tasks/index.ts).

## 6. Daily email digest (Phase 3)

Every advisor gets their personal action queue by email each morning; the
assistant gets the firm-wide version. Quiet days send nothing.

1. **Create a free [Resend](https://resend.com) account** and copy an API
   key. (To send from your own domain — `hub@yourfirm.com` — verify the
   domain under Resend → Domains; until then the default test sender works
   and delivers to your own inbox.)
2. **Deploy the function** with the Supabase CLI:

   ```bash
   supabase functions deploy daily-digest
   ```

3. **Set its secrets** in Dashboard → Edge Functions → Secrets (or CLI):

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
   supabase secrets set APP_URL=https://your-site.vercel.app
   # optional, once your domain is verified with Resend:
   supabase secrets set DIGEST_FROM="Relationship Hub <hub@yourfirm.com>"
   ```

4. **Schedule it** for ~6:15am local (after the 6:00 rebuild), cron in UTC —
   e.g. 11:15 for 6:15am Central. Dashboard → Edge Functions →
   daily-digest → Schedules, cron: `15 11 * * *`.
5. **Test it now** without waiting for morning:

   ```bash
   curl -X POST https://<ref>.supabase.co/functions/v1/daily-digest \
     -H "Authorization: Bearer <service-role-key>"
   ```

   The JSON response reports who was emailed and who was skipped.

Digest recipients are the rows in `users` that have an email — the same
emails that link sign-ins, so this works with no extra setup.

## 7. Live Redtail sync (Phase 4)

Replaces the one-time CSV import with a nightly reconcile: new clients added
in Redtail appear automatically, renames propagate, and households removed
from Redtail are deactivated. **Tier and advisor are never touched** — those
decisions stay in Relationship Hub.

1. **Get API access from Redtail** — open a ticket with Redtail support
   asking for a CRM API key for your database. This is the only blocking
   step and can take a little while; everything below is ready when it lands.
2. **Deploy** the function: `supabase functions deploy redtail-sync`
   (or paste `supabase/functions/redtail-sync/` into the dashboard editor).
3. **Set secrets**: `REDTAIL_API_KEY`, `REDTAIL_USERNAME`,
   `REDTAIL_PASSWORD`. Optional: `REDTAIL_STATUS_FILTER=client` to skip
   prospects, `SYNC_DEFAULT_TIER` / `SYNC_DEFAULT_ADVISOR` for how new
   households arrive (defaults: Tier C, Matt), and `REDTAIL_BASE_URL` if
   Redtail gives you a different endpoint.
4. **Dry-run it** (the default — it writes nothing until you say so):

   ```bash
   curl -X POST https://<ref>.supabase.co/functions/v1/redtail-sync \
     -H "Authorization: Bearer <service-role-key>"
   ```

   The report shows exactly what would happen: creates, renames, re-links
   (existing households matched by name get their Redtail id stamped), and
   deactivations — with samples. A partial fetch can never mass-deactivate
   the book; the planner refuses and warns instead.
5. **Flip it on**: set `REDTAIL_SYNC_APPLY=true`, run once more, check the
   report, then schedule it nightly (Cron → Edge Function, e.g. `30 10 * * *`).

New households arrive clockless (no invented contact history): they surface
on the Clients screen for triage — set the right tier, log the first touch,
and the engine takes over.

## How the engine works in the database

- Logging a contact (insert into `contact_events`) fires a trigger that:
  1. marks the matching open task **done**,
  2. recomputes the client's `due_dates` row from the latest event of that
     type + the tier's interval,
  3. rebuilds the client's open tasks (tasks surface 14 days before due;
     overdue items escalate to `high` priority).
- Changing a client's tier, or editing a service model, recomputes the
  affected due dates automatically — edit the rules and the whole book
  reflows.
- `rebuild_tasks()` regenerates the firm queue for "today"; that's what the
  6am job calls.
