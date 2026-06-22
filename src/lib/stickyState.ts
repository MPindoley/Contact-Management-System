import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// Session-scoped "sticky" state: survives route changes (a screen unmounting
// when you open a client and remounting when you come back), but resets on a
// full page reload. We use it for list filters so they hold while you move
// around the app, yet start fresh — at each advisor's own book — when the app
// is first opened. Kept in memory on purpose, not localStorage, so "fresh load
// = defaults" stays true.
const store = new Map<string, unknown>();

export function useStickyState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    store.set(key, value);
  }, [key, value]);
  return [value, setValue];
}

/** Forget all sticky state (e.g. on sign-out, so the next person starts clean). */
export function clearStickyState(): void {
  store.clear();
}
