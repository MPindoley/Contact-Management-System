// Relationship Hub — nightly task rebuild (Supabase Edge Function)
//
// Regenerates the firm-wide action queue from due_dates: recomputes
// days_overdue, escalates overdue items to high priority, and drops tasks
// for deactivated clients. Schedule it for 6:00 local time from
// Dashboard → Edge Functions → Schedules, or prefer pg_cron (see
// supabase/migrations/0001_init.sql) and keep this as a manual trigger.
//
// Deploy:  supabase functions deploy rebuild-tasks
// Invoke:  curl -X POST https://<ref>.supabase.co/functions/v1/rebuild-tasks \
//            -H "Authorization: Bearer <service-role-key>"

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = new Date().toISOString();
  const { error } = await supabase.rpc("rebuild_tasks");

  if (error) {
    console.error("rebuild_tasks failed", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message, startedAt }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  return new Response(
    JSON.stringify({ ok: true, openTasks: count ?? 0, startedAt }),
    { headers: { "Content-Type": "application/json" } },
  );
});
