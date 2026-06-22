// Set a new password. The recovery email links here; Supabase signs the
// visitor in from the link's token, and updateUser({ password }) finishes the
// job. Also reachable while signed in, so it doubles as "change my password".
//
// If someone lands here without a valid recovery session — an expired or
// already-used link, or just a stray visit — we don't dead-end them: we explain
// what happened and let them request a fresh link without leaving the page.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { getSupabase } from "../lib/data/supabaseAdapter";
import { Button, Field, Input, Spinner } from "../components/ui";
import { LogoMark } from "../components/icons";

// Snapshot any auth error in the URL the moment this module loads. supabase-js
// strips the recovery hash right after it processes it, so reading it later is
// too late — this lets us tell "expired/used link" from "landed here by chance".
const linkError = readLinkError();

function readLinkError(): { code: string; description: string | null } | null {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const code =
    hash.get("error_code") || query.get("error_code") || hash.get("error") || query.get("error");
  if (!code) return null;
  const raw = hash.get("error_description") || query.get("error_description");
  return { code, description: raw ? decodeURIComponent(raw.replace(/\+/g, " ")) : null };
}

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

  // A valid recovery link means no error AND a session — only then show the form.
  const showForm = mode === "supabase" && !linkError && hasSession === true;
  const stillChecking = mode === "supabase" && !linkError && hasSession === null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LogoMark className="mx-auto size-12 text-pine-700" />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            {showForm ? "Choose a new password" : "Reset your password"}
          </h1>
        </div>

        {mode === "demo" ? (
          <Notice>
            Demo mode has no passwords — you sign in by picking a persona.{" "}
            <Link to="/signin" className="font-medium underline underline-offset-2">
              Back to sign in
            </Link>
          </Notice>
        ) : stillChecking ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : showForm ? (
          done ? (
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
          )
        ) : (
          <RequestNewLink expired={Boolean(linkError)} />
        )}
      </div>
    </div>
  );
}

// Shown when there's no valid recovery session: an expired/used link, or a
// visit without a link at all. Lets the person send themselves a fresh link
// without bouncing back to the sign-in screen.
function RequestNewLink({ expired }: { expired: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setPending(true);
    const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <Notice tone="success">
        Sent. Open the <strong>newest</strong> email and click its link — reset links work once, so
        always use the latest one, and open it on this device.{" "}
        <Link to="/signin" className="font-medium underline underline-offset-2">
          Back to sign in
        </Link>
      </Notice>
    );
  }

  return (
    <form
      className="card animate-rise space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        {expired
          ? "This link has expired or was already used — reset links work once and expire after about an hour. Enter your email and we'll send a fresh one."
          : "Enter your email and we'll send you a link to set a new password."}
      </p>

      <Field label="Email">
        <Input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourfirm.com"
        />
      </Field>

      {error && <p className="rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">{error}</p>}

      <Button variant="primary" type="submit" disabled={pending} className="w-full">
        {pending && <Spinner className="size-3.5 border-white/40 border-t-white" />}
        Email me a reset link
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
