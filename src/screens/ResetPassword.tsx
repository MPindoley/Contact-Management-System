// Password handling for a firm that resets in-house (no email): there's no
// self-service email/code flow — the senior advisor resets a teammate from
// Tiers & service models → The people and hands over a temporary password.
//
// This page does two things:
//   • signed in → "Choose a new password" (the sidebar's Change password link,
//     and what a teammate uses right after signing in with a temporary one);
//   • signed out → tells you how to get reset (ask the senior advisor).

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { getSupabase } from "../lib/data/supabaseAdapter";
import { Button, Field, Input, Spinner } from "../components/ui";
import { LogoMark } from "../components/icons";

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

  const signedIn = mode === "supabase" && hasSession === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LogoMark className="mx-auto size-12 text-pine-700" />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            {signedIn ? "Choose a new password" : "Password help"}
          </h1>
        </div>

        {mode === "demo" ? (
          <Notice>
            Demo mode has no passwords — you sign in by picking a persona.{" "}
            <Link to="/signin" className="font-medium underline underline-offset-2">
              Back to sign in
            </Link>
          </Notice>
        ) : hasSession === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : signedIn ? (
          <SetPasswordForm />
        ) : (
          <LockedOutNotice />
        )}
      </div>
    </div>
  );
}

// Shown when signed in: set a new password (change-password, or finishing a
// temporary-password reset).
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

// Shown when signed out: how to get back in, the in-house way (no email).
function LockedOutNotice() {
  return (
    <Notice>
      <p>Your firm resets passwords in the app — no email involved.</p>
      <p className="mt-2">
        Ask the <strong>senior advisor</strong> to reset yours: they open{" "}
        <strong>Tiers &amp; service models → The people</strong> and click{" "}
        <strong>Reset password</strong> next to your name, which gives them a{" "}
        <strong>temporary password</strong> to pass to you.
      </p>
      <p className="mt-2">
        Sign in with that temporary password, then come back here (sidebar →{" "}
        <strong>Change password</strong>) to set your own.
      </p>
      <p className="mt-3">
        <Link to="/signin" className="font-medium underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </Notice>
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
