// Small UI kit: button, modal, form fields, segmented control.

import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { XIcon } from "./icons";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-pine-700 text-white hover:bg-pine-800 active:bg-pine-900 shadow-sm disabled:hover:bg-pine-700",
  secondary:
    "bg-white text-ink border border-stone-300 hover:bg-stone-50 active:bg-stone-100 shadow-sm disabled:hover:bg-white",
  ghost: "text-ink-soft hover:bg-stone-200/60 hover:text-ink",
  danger: "bg-clay-600 text-white hover:bg-clay-700 active:bg-clay-800 shadow-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  const sizing = size === "sm" ? "px-2.5 py-1.5 text-[13px] gap-1.5" : "px-4 py-2 text-sm gap-2";
  return (
    <button
      type={type}
      className={`inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, subtitle, children, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto p-0 sm:items-start sm:p-8">
      <div className="animate-fade fixed inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-rise relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lift sm:my-auto sm:max-h-none sm:rounded-2xl sm:p-6 sm:pb-6 ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300 sm:hidden" />
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-ink"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
  /**
   * Render as a div instead of a <label>. Required when the child is a group
   * of buttons (segmented controls, pickers) — a wrapping label would donate
   * its text as the accessible name of the first button inside.
   */
  group?: boolean;
}

export function Field({ label, hint, children, group = false }: FieldProps) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block" {...(group ? { role: "group", "aria-label": label } : {})}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </Tag>
  );
}

const CONTROL =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-stone-400 transition-colors focus:border-pine-500";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL} cursor-pointer ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} resize-none ${className}`} {...props} />;
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, className = "" }: SegmentedProps<T>) {
  return (
    <div className={`flex rounded-lg bg-stone-200/70 p-1 ${className}`} role="radiogroup">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all ${
              active ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-stone-300 border-t-pine-600 ${className}`}
    />
  );
}
