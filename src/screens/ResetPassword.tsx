// Password reset that survives corporate email link-scanners. The recovery
// email carries a 6-digit code (and, as a fallback, a link); the visitor enters
// their email, gets a code, types it, and sets a new password. A scanner can
// "click" a one-time link and burn it before the user does — it can't spend a
// code sitting in the email body, so codes are the reliable path for Outlook /
// Microsoft 365 and the like. Also reachable while signed in, so the
// set-password form doubles as "change my password".

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { getSupabase } from "../lib/data/supabaseAdapter";
import { Button, Field, Input, Spinner } from "../components/ui";
import { LogoMark } from "../components/icons";

// Snapshot any auth error in the URL the moment this module loads. supabase-js
// strips the recovery hash right after it processes it, so reading it later is
// too late — this lets us greet an expired/used link with the code form instead
// of a dead end.
const linkError = readLinkError();

function readLinkError(): boolean {
  if (typeof window === "undefined") return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return Boolean(
    hash.get("error_code") || query.get("error_code") || hash.get("error") || query.get("error"),
  );
}

export function ResetPassword() {
  const { mode } = useApp();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    if (mode !== "supabase") return;
    const db = getSupabase();
    db.auth.getSession().then(({ data: { session } }) => setHasSession(Boolean(session)));
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => sub.subscription.unsubscribe();
  }, [mode]);

  const ready = mode === "supabase" && hasSession === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LogoMark className="mx-auto size-12 text-pine-700" />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            {ready ? "Choose a new password" : "Reset your password"}
          </h1>
        </div>

        {mode === "demo" ? (
          <Notice>
            Demo mode has no passwords — you sign in by picking a persona.{" "}
            <Link to="/signin" className="font-medium underline underline-offset-2">
              Back to sign in
            </Link>
          </Notice>
        ) : ready ? (
          <SetPasswordForm />
        ) : hasSession === null && !linkError ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          // No valid session — an expired/used link, or a fresh visit. Recover
          // with a code; verifying it establishes the session, which flips this
          // view to the set-password form above.
          <CodeRecovery expired={linkError} />
        )}
      </div>
    </div>
  );
}

// Shown once a recovery session exists (from a code, or a link that survived).
function SetPasswordForm() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    const { error: err } = await getSupabase().auth.updateUser({ password });
    setPending(false);
    if (err) setError(err.message);
    else {
      setDone(true);
      window.setTimeout(() => navigate("/", { replace: true }), 1200);
    }
  }

  if (done) return <Notice tone="success">Password updated. Taking you to your dashboard…</Notice>;

  return (
    <form
      className="card animate-rise space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="New password">
        <Input
          type="password"
          required
          autoFocus
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </Field>
      <Field label="New password, again">
        <Input
          type="password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />
      </Field>
      {error && <p className="rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">{error}</p>}
      <Button variant="primary" type="submit" disabled={pending} className="w-full">
        {pending && <Spinner className="size-3.5 border-white/40 border-t-white" />}
        Save new password
      </Button>
    </form>
  );
}

// Email → 6-digit code → verify. Verifying signs the visitor in, after which
// the parent shows the set-password form.
function CodeRecovery({ expired }: { expired: boolean }) {
  const location = useLocation();
  const presetEmail = (location.state as { email?: string } | null)?.email ?? "";
  const [email, setEmail] = useState(presetEmail);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setSending(true);
    const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSending(false);
    if (err) setError(err.message);
    else setSentTo(email.trim());
  }

  async function verify() {
    setError(null);
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setVerifying(true);
    const { error: err } = await getSupabase().auth.verifyOtp({
      email: email.trim(),
      token,
      type: "recovery",
    });
    setVerifying(false);
    // On success the auth listener flips the parent to the set-password form.
    if (err) setError("That code is wrong or has expired. Send a fresh one and try again.");
  }

  return (
    <form
      className="card animate-rise space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        {expired
          ? "That link had already been used — work email often opens reset links automatically, which spends them. Use a code instead:"
          : "We'll email you a 6-digit code to set a new password."}
      </p>

      <Field label="Email">
        <Input
          type="email"
          required
          autoFocus={!presetEmail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourfirm.com"
        />
      </Field>

      <Button type="button" variant="secondary" onClick={() => void sendCode()} disabled={sending} className="w-full">
        {sending && <Spinner className="size-3.5" />}
        {sentTo ? "Resend code" : "Email me a code"}
      </Button>

      {sentTo && (
        <p className="rounded-lg bg-pine-50 px-3 py-2 text-sm text-pine-800">
          Code sent to {sentTo}. Enter it below (check spam if it's slow).
        </p>
      )}

      <Field label="6-digit code">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          className="tnum tracking-[0.3em]"
        />
      </Field>

      {error && <p className="rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">{error}</p>}

      <Button variant="primary" type="submit" disabled={verifying || code.replace(/\D/g, "").length < 6} className="w-full">
        {verifying && <Spinner className="size-3.5 border-white/40 border-t-white" />}
        Verify code
      </Button>
      <p className="text-center text-xs text-stone-400">
        <Link to="/signin" className="underline underline-offset-2 hover:text-ink">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "success" }) {
  const cls =
    tone === "success"
      ? "border-pine-200 bg-pine-50 text-pine-900"
      : "border-stone-200 bg-white text-ink-soft";
  return (
    <div className={`card animate-rise border px-5 py-4 text-sm leading-relaxed ${cls}`}>{children}</div>
  );
}
