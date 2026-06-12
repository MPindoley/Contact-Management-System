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
