// Sign in. Demo mode: pick a persona and go. Supabase mode: email + password.

import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { DEMO_USERS } from "../lib/data/demoSeed";
import { Button, Field, Input, Spinner } from "../components/ui";
import { LogoMark } from "../components/icons";

const PERSONA_SCOPES: Record<string, string> = {
  user_matt: "Sees his book plus joint households",
  user_advisor_b: "Sees their book plus joint households",
  user_assistant: "Sees every client across the firm",
};

export function SignIn() {
  const { mode, currentUser, authReady } = useApp();

  if (authReady && currentUser) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LogoMark className="mx-auto size-12 text-pine-700" />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Relationship Hub</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-ink-soft">
            The service execution layer for your firm. One question, answered every
            morning: <em className="font-display">who needs attention today?</em>
          </p>
        </div>

        {mode === "demo" ? <DemoSignIn /> : <SupabaseSignIn />}

        <p className="mt-6 text-center text-xs text-stone-400">
          {mode === "demo"
            ? "Demo mode — data lives in this browser. Connect Supabase to go live (see supabase/README.md)."
            : "Connected to Supabase. Accounts are linked to firm profiles by email."}
        </p>
      </div>
    </div>
  );
}

function DemoSignIn() {
  const { signInDemo } = useApp();

  return (
    <div className="card animate-rise divide-y divide-stone-100 overflow-hidden">
      <p className="px-5 pt-4 pb-3 text-[13px] font-medium text-ink-soft">Continue as</p>
      {DEMO_USERS.map((user) => {
        const initials = user.name
          .split(/\s+/)
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <button
            key={user.id}
            type="button"
            onClick={() => signInDemo(user.id)}
            className="flex w-full cursor-pointer items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-pine-50"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pine-800 text-sm font-semibold text-pine-100">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{user.name}</span>
              <span className="block text-xs text-ink-soft">
                {user.role === "advisor" ? "Advisor" : "Assistant"} · {PERSONA_SCOPES[user.id]}
              </span>
            </span>
            <span className="text-stone-300">→</span>
          </button>
        );
      })}
    </div>
  );
}

function SupabaseSignIn() {
  const { signInSupabase, signUpSupabase } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    setNotice(null);
    const err = creating
      ? await signUpSupabase(email, password)
      : await signInSupabase(email, password);
    setPending(false);
    if (err) {
      setError(err);
    } else if (creating) {
      setNotice("Account created. If email confirmation is on, confirm it and sign in.");
      setCreating(false);
    }
  }

  return (
    <form
      className="card animate-rise space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
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
      <Field label="Password">
        <Input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </Field>

      {error && <p className="rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">{error}</p>}
      {notice && <p className="rounded-lg bg-pine-50 px-3 py-2 text-sm text-pine-800">{notice}</p>}

      <Button variant="primary" type="submit" disabled={pending} className="w-full">
        {pending && <Spinner className="size-3.5 border-white/40 border-t-white" />}
        {creating ? "Create account" : "Sign in"}
      </Button>
      <button
        type="button"
        className="w-full cursor-pointer text-center text-xs text-ink-soft underline-offset-2 hover:underline"
        onClick={() => setCreating((v) => !v)}
      >
        {creating ? "Have an account already? Sign in" : "First time here? Create your account"}
      </button>
    </form>
  );
}
