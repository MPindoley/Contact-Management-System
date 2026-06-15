// Relationship Hub — nightly Redtail sync (Supabase Edge Function)
//
// Pulls contacts from the Redtail CRM API and reconciles them with the
// clients table: new households are created (default tier/advisor, ready
// for triage), renames propagate, name-matched households get their
// Redtail id stamped, and households gone from Redtail are deactivated.
// Tier and advisor are NEVER overwritten — those are your decisions.
//
// SAFE BY DEFAULT: runs as a dry run (report only) until you set
// REDTAIL_SYNC_APPLY=true. Run it once, read the report, then flip it.
//
// Secrets:
//   REDTAIL_API_KEY      required — request from Redtail support
//   REDTAIL_USERNAME     required — your Redtail username
//   REDTAIL_PASSWORD     required — your Redtail password
//   REDTAIL_BASE_URL     optional — defaults to Redtail's public v1 API
//   REDTAIL_STATUS_FILTER optional — e.g. "client" to skip prospects
//   SYNC_DEFAULT_TIER    optional — tier for new households (default C)
//   SYNC_DEFAULT_ADVISOR optional — matt | advisor_b | joint (default matt)
//   REDTAIL_SYNC_APPLY   optional — "true" to write changes
//
// Deploy:   supabase functions deploy redtail-sync
// Dry run:  curl -X POST https://<ref>.supabase.co/functions/v1/redtail-sync \
//             -H "Authorization: Bearer <service-role-key>"

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSyncPlan, parseContacts, type ExistingClient, type ParsedContact } from "./map.ts";

const MAX_PAGES = 50;

Deno.serve(async () => {
  const apiKey = Deno.env.get("REDTAIL_API_KEY");
  const username = Deno.env.get("REDTAIL_USERNAME");
  const password = Deno.env.get("REDTAIL_PASSWORD");
  if (!apiKey || !username || !password) {
    return json(500, {
      ok: false,
      error:
        "Set REDTAIL_API_KEY, REDTAIL_USERNAME and REDTAIL_PASSWORD secrets first. " +
        "Request API access from Redtail support if you don't have a key yet.",
    });
  }

  const base = (Deno.env.get("REDTAIL_BASE_URL") ?? "https://smf.crm3.redtailtechnology.com/api/public/v1")
    .replace(/\/+$/, "");
  const apply = Deno.env.get("REDTAIL_SYNC_APPLY") === "true";
  const defaultTier = Deno.env.get("SYNC_DEFAULT_TIER") ?? "C";
  const defaultAdvisor = Deno.env.get("SYNC_DEFAULT_ADVISOR") ?? "matt";
  const auth = "Basic " + btoa(`${apiKey}:${username}:${password}`);

  // ---- Pull every page of contacts from Redtail ---------------------------
  const contacts: ParsedContact[] = [];
  let skippedNoName = 0;
  const fetchWarnings: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${base}/contacts?page=${page}`, {
      headers: { Authorization: auth, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      if (page === 1) {
        return json(502, {
          ok: false,
          error: `Redtail API answered ${res.status} on the first page — check the key/username/password (and REDTAIL_BASE_URL if Redtail gave you a different endpoint).`,
          body: (await res.text()).slice(0, 500),
        });
      }
      fetchWarnings.push(`Page ${page} answered ${res.status}; stopped there.`);
      break;
    }
    const parsed = parseContacts(await res.json());
    skippedNoName += parsed.skippedNoName;
    if (parsed.contacts.length === 0) break;
    contacts.push(...parsed.contacts);
  }

  // ---- Plan against the current book --------------------------------------
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const existingRes = await supabase.from("clients").select("id, household_name, redtail_id, active");
  if (existingRes.error) return json(500, { ok: false, error: existingRes.error.message });

  const plan = buildSyncPlan(contacts, existingRes.data as ExistingClient[], {
    statusFilter: Deno.env.get("REDTAIL_STATUS_FILTER"),
  });
  plan.warnings.push(...fetchWarnings);

  // ---- Apply (only when the switch is on) ----------------------------------
  const applied = { creates: 0, renames: 0, relinks: 0, deactivations: 0 };
  if (apply) {
    for (let i = 0; i < plan.creates.length; i += 100) {
      const chunk = plan.creates.slice(i, i + 100);
      const { error } = await supabase.from("clients").insert(
        chunk.map((c) => ({
          household_name: c.household_name,
          redtail_id: c.redtail_id,
          tier: defaultTier,
          assigned_advisor: defaultAdvisor,
        })),
      );
      if (error) return json(500, { ok: false, error: `Creating households: ${error.message}`, plan });
      applied.creates += chunk.length;
    }
    for (const r of plan.renames) {
      const { error } = await supabase.from("clients").update({ household_name: r.to }).eq("id", r.id);
      if (error) return json(500, { ok: false, error: `Renaming: ${error.message}`, plan });
      applied.renames++;
    }
    for (const r of plan.relinks) {
      const { error } = await supabase.from("clients").update({ redtail_id: r.redtail_id }).eq("id", r.id);
      if (error) return json(500, { ok: false, error: `Linking: ${error.message}`, plan });
      applied.relinks++;
    }
    for (const d of plan.deactivations) {
      const { error } = await supabase.from("clients").update({ active: false }).eq("id", d.id);
      if (error) return json(500, { ok: false, error: `Deactivating: ${error.message}`, plan });
      applied.deactivations++;
    }
  }

  return json(200, {
    ok: true,
    mode: apply ? "APPLIED" : "DRY RUN — set REDTAIL_SYNC_APPLY=true to write these changes",
    contactsFromRedtail: contacts.length,
    skippedNoName,
    plan: {
      creates: plan.creates.length,
      renames: plan.renames.length,
      relinks: plan.relinks.length,
      deactivations: plan.deactivations.length,
      unchanged: plan.unchanged,
      warnings: plan.warnings,
      samples: {
        creates: plan.creates.slice(0, 10),
        renames: plan.renames.slice(0, 10),
        relinks: plan.relinks.slice(0, 10),
        deactivations: plan.deactivations.slice(0, 10),
      },
    },
    applied: apply ? applied : null,
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
