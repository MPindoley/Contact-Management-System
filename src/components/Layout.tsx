// App shell: dark ink sidebar, brand, nav, the ever-present "Log contact"
// action, and the signed-in user. Content renders via <Outlet/>.

import { Link, NavLink, Outlet } from "react-router-dom";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { LogContactProvider, useLogContact } from "./LogContactModal";
import {
  ChartIcon,
  LogOutIcon,
  LogoMark,
  PlusIcon,
  QueueIcon,
  SlidersIcon,
  SunriseIcon,
  TargetIcon,
  UsersIcon,
} from "./icons";

const NAV = [
  { to: "/", label: "Morning Dashboard", Icon: SunriseIcon, end: true },
  { to: "/queue", label: "Action Queue", Icon: QueueIcon },
  { to: "/clients", label: "Clients", Icon: UsersIcon },
  { to: "/prospects", label: "Prospects", Icon: TargetIcon },
  { to: "/report", label: "Firm Report", Icon: ChartIcon },
  { to: "/settings/service-models", label: "Service Models", Icon: SlidersIcon },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
    isActive ? "bg-white/12 text-white" : "text-stone-400 hover:bg-white/5 hover:text-stone-200"
  }`;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <LogoMark className="size-7 shrink-0 text-pine-300" />
      <div className="leading-tight">
        <p className="font-display text-[17px] font-semibold text-white">Relationship Hub</p>
        <p className="text-[11px] tracking-wide text-stone-500">who needs attention today</p>
      </div>
    </div>
  );
}

function LogContactButton({ compact = false }: { compact?: boolean }) {
  const { open } = useLogContact();
  return (
    <button
      type="button"
      onClick={() => open()}
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-pine-600 font-medium text-white shadow-sm transition-colors hover:bg-pine-500 ${
        compact ? "px-3 py-2 text-[13px]" : "w-full px-3 py-2.5 text-sm"
      }`}
    >
      <PlusIcon className="size-4" />
      Log contact
      {!compact && (
        <kbd className="ml-auto rounded border border-white/20 bg-white/10 px-1.5 text-[10px] font-semibold text-pine-100">
          L
        </kbd>
      )}
    </button>
  );
}

function UserFooter() {
  const { currentUser, signOut, mode, resetDemo } = useApp();
  const toast = useToast();
  if (!currentUser) return null;

  const initials = currentUser.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleLabel = currentUser.role === "advisor" ? "Advisor" : "Assistant";

  return (
    <div className="space-y-3 border-t border-white/10 px-3 pt-4">
      <div className="flex items-center justify-between px-1 text-[11px]">
        {mode === "demo" ? (
          <>
            <span className="flex items-center gap-1.5 text-stone-500">
              <span className="size-1.5 rounded-full bg-gold-400" />
              Demo data
            </span>
            <button
              type="button"
              className="cursor-pointer text-stone-500 underline-offset-2 hover:text-stone-300 hover:underline"
              onClick={() => {
                void resetDemo().then(() => toast.push("Demo data reset to a fresh book.", "info"));
              }}
            >
              Reset
            </button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-stone-500">
              <span className="size-1.5 rounded-full bg-pine-400" />
              Live · Supabase
            </span>
            <Link
              to="/reset-password"
              className="cursor-pointer text-stone-500 underline-offset-2 hover:text-stone-300 hover:underline"
            >
              Change password
            </Link>
          </>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pine-800 text-xs font-semibold text-pine-100">
          {initials}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium text-stone-200">{currentUser.name}</p>
          <p className="text-[11px] text-stone-500">{roleLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          title="Sign out"
          className="cursor-pointer rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-white/5 hover:text-stone-200"
        >
          <LogOutIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Layout() {
  const { busy, error, refresh } = useApp();

  return (
    <LogContactProvider>
      {busy && <div className="no-print fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-pine-500" />}

      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-5 bg-ink py-5 md:flex">
        <Brand />
        <div className="px-3">
          <LogContactButton />
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navClass}>
              <Icon className="size-4.5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <UserFooter />
      </aside>

      {/* Mobile header */}
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-ink px-4 py-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Brand />
          <LogContactButton compact />
        </div>
        <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-0.5">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive ? "bg-white/15 text-white" : "text-stone-400 hover:text-stone-200"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="min-h-screen md:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-8">
          {error && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3 text-sm text-clay-900">
              <span className="min-w-0">{error}</span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="shrink-0 cursor-pointer font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </LogContactProvider>
  );
}
