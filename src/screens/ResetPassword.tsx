// Set a new password. The recovery email links here; Supabase signs the
// visitor in from the link's token, and updateUser({ password }) finishes
// the job. Also reachable while signed in, so it doubles as "change my
// password".

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { getSupabase } from "../lib/data/supabaseAdapter";
import { Button, Field, Input, Spinner } from "../components/ui";
import { LogoMark } from "../components/icons";

export function ResetPassword() {
  const { mode } = useApp();
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode !== "supabase") return;
    const db = getSupabase();
    db.auth.getSession().then(({ data: { session } }) => setHasSession(Boolean(session)));
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => sub.subscription.unsubscribe();
  }, [mode]);

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
    if (err) {
      setError(err.message);
    } else {
      setDone(true);
      window.setTimeout(() => navigate("/", { replace: true }), 1200);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LogoMark className="mx-auto size-12 text-pine-700" />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Choose a new password</h1>
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
        ) : !hasSession ? (
          <Notice>
            This page only works from a password-recovery link. Go to{" "}
            <Link to="/signin" className="font-medium underline underline-offset-2">
              sign in
            </Link>
            , enter your email, and click <em>Forgot password?</em> — then open the link in the
            email it sends you.
          </Notice>
        ) : done ? (
          <Notice tone="success">Password updated. Taking you to your dashboard…</Notice>
        ) : (
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
        )}
      </div>
    </div>
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
