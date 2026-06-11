import type { ReactNode } from "react";

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-stone-100 text-stone-400">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint && <p className="mt-1 max-w-60 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}
