// Relationship Hub — admin password reset (Supabase Edge Function)
//
// Lets a firm admin set a temporary password for a teammate who's locked out,
// with no email in the loop — built for secure firms that can't use an outside
// email sender. The admin (service-role) key lives only here, never in the
// browser; the function verifies the CALLER is a real firm admin before doing
// anything, and only ever touches accounts that belong to the firm's `users`.
//
// Who may reset: the senior advisor — a user whose `users` row has
// sees_all_books = true AND role = 'advisor' (Matt in the default setup). To
// also allow the assistant, drop the role check below.
//
// Deploy:  supabase functions deploy admin-reset-password
//   (uses the built-in SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//    secrets — nothing extra to set). If the browser call fails CORS preflight,
//    redeploy with --no-verify-jwt; the function still does its own admin check.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Sign in first." });

  // Identify the caller from their own JWT (validated by the auth server).
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
    error: callerErr,
  } = await asCaller.auth.getUser();
  if (callerErr || !caller) return json(401, { error: "Sign in first." });

  const admin = createClient(url, serviceKey);

  // The caller must be the senior advisor (an advisor who sees every book).
  const { data: callerRow } = await admin
    .from("users")
    .select("id, name, role, sees_all_books")
    .eq("auth_user_id", caller.id)
    .maybeSingle();
  if (!callerRow?.sees_all_books || callerRow.role !== "advisor") {
    return json(403, { error: "Only the senior advisor can reset passwords." });
  }

  const body = await req.json().catch(() => ({}));
  const targetUserId = String(body?.targetUserId ?? "");
  if (!targetUserId) return json(400, { error: "Missing the teammate to reset." });

  // Only ever reset someone who's a member of this firm.
  const { data: target } = await admin
    .from("users")
    .select("id, name, auth_user_id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!target) return json(404, { error: "That teammate isn't in your firm." });
  if (!target.auth_user_id) {
    return json(409, {
      error: `${target.name} hasn't signed in yet, so there's no login to reset — have them create their account first.`,
    });
  }

  const tempPassword = generateTempPassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(target.auth_user_id, {
    password: tempPassword,
  });
  if (updErr) return json(500, { error: updErr.message });

  return json(200, { tempPassword, name: target.name });
});

// Readable, ambiguity-free, and strong enough for a one-time temp: mixed case
// and digits so it satisfies common password policies. e.g. "RH-7kQ4-9mNp".
function generateTempPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const body = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `RH-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
