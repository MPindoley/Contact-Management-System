// Relationship Hub — daily email digest (Supabase Edge Function)
//
// Each advisor gets their personal action queue for the day; the assistant
// gets the firm-wide view. Quiet days send nothing (set DIGEST_ALWAYS_SEND
// to change that). Schedule it ~15 minutes after the 6am rebuild.
//
// Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   RESEND_API_KEY   required — from resend.com (free tier is plenty)
//   APP_URL          required — e.g. https://relationship-hub.vercel.app
//   DIGEST_FROM      optional — e.g. "Relationship Hub <hub@yourfirm.com>"
//                    (defaults to Resend's onboarding sender for testing)
//   DIGEST_ALWAYS_SEND optional — "true" to email even on quiet days
//
// Deploy:  supabase functions deploy daily-digest
// Test:    curl -X POST https://<ref>.supabase.co/functions/v1/daily-digest \
//            -H "Authorization: Bearer <service-role-key>"

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildDigests, type DigestClient, type DigestTask, type DigestUser } from "./digest.ts";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const from = Deno.env.get("DIGEST_FROM") ?? "Relationship Hub <onboarding@resend.dev>";
  const alwaysSend = Deno.env.get("DIGEST_ALWAYS_SEND") === "true";

  if (!resendKey || !appUrl) {
    return json(500, { ok: false, error: "Set RESEND_API_KEY and APP_URL secrets first." });
  }

  // Make sure today's queue is fresh, then read everything actionable.
  await supabase.rpc("rebuild_tasks");

  const today = new Date().toISOString().slice(0, 10);
  const [users, clients, tasks] = await Promise.all([
    supabase.from("users").select("name, email, role, advisor_key").not("email", "is", null),
    supabase.from("clients").select("id, household_name, assigned_advisor, tier, active").eq("active", true),
    supabase.from("tasks").select("client_id, type, due_date, status").eq("status", "open").lte("due_date", today),
  ]);
  if (users.error || clients.error || tasks.error) {
    return json(500, {
      ok: false,
      error: users.error?.message ?? clients.error?.message ?? tasks.error?.message,
    });
  }

  const emails = buildDigests({
    users: users.data as DigestUser[],
    clients: clients.data as DigestClient[],
    tasks: tasks.data as DigestTask[],
    today,
    appUrl,
    alwaysSend,
  });

  const results: Array<{ to: string; ok: boolean; error?: string }> = [];
  for (const email of emails) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    results.push(
      res.ok ? { to: email.to, ok: true } : { to: email.to, ok: false, error: await res.text() },
    );
  }

  return json(200, {
    ok: results.every((r) => r.ok),
    date: today,
    sent: results.filter((r) => r.ok).length,
    skippedQuiet: (users.data?.length ?? 0) - emails.length,
    results,
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
