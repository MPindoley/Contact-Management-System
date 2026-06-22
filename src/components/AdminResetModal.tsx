// Admin action: set a temporary password for a locked-out teammate (no email).
// Confirms first, then shows the one-time temp password to hand over.

import { useState } from "react";
import { useApp } from "../lib/store";
import type { User } from "../types";
import { Button, Modal, Spinner } from "./ui";

export function AdminResetModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { adminResetPassword } = useApp();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function doReset() {
    setError(null);
    setPending(true);
    try {
      const { tempPassword } = await adminResetPassword(user.id);
      setTemp(tempPassword);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset that password.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!temp) return;
    try {
      await navigator.clipboard.writeText(temp);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the code is on screen to read aloud */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={temp ? `Temporary password for ${user.name}` : `Reset ${user.name}'s password?`}
    >
      {temp ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Share this with {user.name} privately — in person, by text, or on a call (not email).
            They sign in with it, then set their own from the menu under their name →{" "}
            <strong>Change password</strong>.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-center text-lg font-semibold tracking-wider">
              {temp}
            </code>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            This sets a new <strong>temporary password</strong> for {user.name} and shows it to you
            once. Their old password stops working right away — use this when they're locked out.
          </p>
          {error && <p className="rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => void doReset()}>
              {pending && <Spinner className="size-3.5 border-white/40 border-t-white" />}
              Reset password
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
