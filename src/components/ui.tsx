// Small UI kit: button, modal, form fields, segmented control.

import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
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
  // md is the app's default button and on a phone it is a thumb target, so it
  // stands 44px tall at base width and falls back to today's 38px from sm up.
  const sizing =
    size === "sm"
      ? "px-2.5 py-1.5 text-[13px] gap-1.5"
      : "px-4 py-2 text-sm gap-2 max-sm:py-3";
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

  // Rendered on <body> rather than in place. Every screen's root carries the
  // `animate-rise` animation, which leaves a transform behind — and a
  // transformed ancestor becomes the containing block for `position: fixed`.
  // In place, the overlay would size itself to the whole page instead of the
  // window, pushing tall dialogs (Edit, Plan outreach, …) off the bottom of
  // the screen with no way to reach their buttons.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="animate-fade fixed inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      {/*
        The panel is capped to the viewport and scrolls INSIDE itself, so a
        short window (or a laptop with the browser half-height) can always
        reach the form and its buttons. Relying on the overlay to scroll
        stranded the bottom of tall dialogs — the wheel never reached it.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-rise relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift max-sm:rounded-t-3xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <div className="shrink-0 px-5 pt-4 sm:px-6 sm:pt-6 max-sm:pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300 sm:hidden max-sm:mb-2.5" />
          <div className="mb-4 flex items-start justify-between gap-4 max-sm:mb-3">
            <div>
              <h2 className="text-xl font-semibold max-sm:text-lg">{title}</h2>
              {subtitle && <p className="mt-1 text-sm text-ink-soft max-sm:text-[13px]">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 cursor-pointer rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-ink"
            >
              <XIcon className="size-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body,
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

// text-base at base width is not a style choice: iOS Safari zooms the page
// when a field smaller than 16px takes focus. py-2.5 puts the control at 46px,
// a real thumb target. Both revert to today's values from sm up.
const CONTROL =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-stone-400 transition-colors focus:border-pine-500 max-sm:py-2.5 max-sm:text-base";

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
  // Three or four options with icons and labels do not fit across a phone —
  // the last one gets clipped at the screen edge. Wrap them into two columns
  // at base width instead, and go back to a single row from sm up.
  const wrap = options.length > 2;
  return (
    <div
      className={`rounded-lg bg-stone-200/70 p-1 ${wrap ? "flex max-sm:grid max-sm:grid-cols-2 max-sm:gap-1" : "flex"} ${className}`}
      role="radiogroup"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        // An odd count leaves a gap on the last row; let it span instead.
        const spans = wrap && options.length % 2 === 1 && i === options.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all max-sm:min-h-11 ${
              spans ? "max-sm:col-span-2" : ""
            } ${active ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
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
