// App state: one provider that owns auth, the data snapshot, and mutations.
// Demo mode signs in by persona; Supabase mode uses email + password and maps
// the session to a row in `users`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AddClientInput,
  Client,
  DataSnapshot,
  DueDate,
  LogContactInput,
  ServiceModel,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
  User,
} from "../types";
import type { DataAdapter } from "./data/adapter";
import { createDemoAdapter } from "./data/demoAdapter";
import { createSupabaseAdapter, getSupabase, isSupabaseConfigured } from "./data/supabaseAdapter";
import { DEMO_USERS } from "./data/demoSeed";
import { todayISO } from "./dates";

const DEMO_USER_KEY = "relationship-hub-demo-user";

export type AppMode = "demo" | "supabase";

interface AppContextValue {
  mode: AppMode;
  /** Initial auth check finished — safe to decide between sign-in and app. */
  authReady: boolean;
  currentUser: User | null;
  signInDemo(userId: string): void;
  signInSupabase(email: string, password: string): Promise<string | null>;
  signUpSupabase(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;

  data: DataSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  today: string;

  refresh(): Promise<void>;
  logContact(input: LogContactInput): Promise<DueDate[]>;
  addClient(input: AddClientInput): Promise<Client | null>;
  importClients(inputs: AddClientInput[]): Promise<void>;
  updateContactEvent(eventId: string, patch: UpdateContactInput): Promise<void>;
  deleteContactEvent(eventId: string): Promise<void>;
  snoozeTouch(clientId: string, type: TouchType, untilDate: string | null): Promise<void>;
  updateClient(clientId: string, patch: UpdateClientInput): Promise<void>;
  updateServiceModel(model: ServiceModel): Promise<void>;
  rebuildQueue(): Promise<void>;
  resetDemo(): Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mode: AppMode = isSupabaseConfigured ? "supabase" : "demo";
  const adapterRef = useRef<DataAdapter | null>(null);
  adapterRef.current ??= mode === "supabase" ? createSupabaseAdapter() : createDemoAdapter();
  const adapter = adapterRef.current;

  const [authReady, setAuthReady] = useState(mode === "demo");
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (mode !== "demo") return null;
    const saved = localStorage.getItem(DEMO_USER_KEY);
    return DEMO_USERS.find((u) => u.id === saved) ?? null;
  });

  const [data, setData] = useState<DataSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(todayISO());

  // ---- Supabase session → firm profile -----------------------------------
  useEffect(() => {
    if (mode !== "supabase") return;
    const db = getSupabase();

    async function resolveProfile(authUserId: string | undefined, email: string | undefined) {
      if (!authUserId) {
        setCurrentUser(null);
        setAuthReady(true);
        return;
      }
      const columns = "id, name, email, role, advisor_key";

      // Two simple lookups instead of one fragile or() filter: first by the
      // stamped auth id, then case-insensitively by email.
      let row = (
        await db.from("users").select(columns).eq("auth_user_id", authUserId).limit(1)
      ).data?.[0];

      if (!row && email) {
        row = (
          await db.from("users").select(columns).ilike("email", email.trim()).limit(1)
        ).data?.[0];
        if (row) {
          // Self-heal: stamp the auth id so every future sign-in matches
          // directly. Ignore failure (older databases may not allow it).
          await db.from("users").update({ auth_user_id: authUserId }).eq("id", row.id);
        }
      }

      setCurrentUser(
        row
          ? { id: row.id, name: row.name, email: row.email, role: row.role, advisorKey: row.advisor_key }
          : null,
      );
      if (!row) {
        // Mid password-recovery there may legitimately be no linked profile
        // yet — don't kill the session before they can set a password.
        if (window.location.pathname === "/reset-password") {
          setAuthReady(true);
          return;
        }
        setError(
          `Signed in as ${email ?? "this account"}, but that email isn't on the team list yet. ` +
            "Add it to the users table (supabase/README.md, step 3), then sign in again.",
        );
        await db.auth.signOut();
      }
      setAuthReady(true);
    }

    db.auth.getSession().then(({ data: { session } }) => {
      void resolveProfile(session?.user?.id, session?.user?.email);
    });
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      void resolveProfile(session?.user?.id, session?.user?.email);
    });
    return () => sub.subscription.unsubscribe();
  }, [mode]);

  // ---- Data load when signed in -------------------------------------------
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const snapshot = await adapter.load();
      setData(snapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [adapter]);

  useEffect(() => {
    if (!currentUser) {
      setData(null);
      return;
    }
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [currentUser, refresh]);

  // ---- Live team sync (Supabase mode) --------------------------------------
  // Any teammate's write — a logged contact, a tier change, an edited service
  // model — triggers a debounced reload, so every open dashboard converges
  // within a second. Demo mode is per-browser and skips this.
  useEffect(() => {
    if (mode !== "supabase" || !currentUser) return;
    const db = getSupabase();
    let timer: number | undefined;

    const channel = db
      .channel("relationship-hub-live")
      .on("postgres_changes", { event: "*", schema: "public" }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 500);
      })
      .subscribe();

    return () => {
      window.clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [mode, currentUser, refresh]);

  // ---- Day rollover: re-age the queue like the 6am cron --------------------
  useEffect(() => {
    const tick = () => {
      const now = todayISO();
      setToday((prev) => {
        if (prev !== now && currentUser) void refresh();
        return now;
      });
    };
    const interval = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
    };
  }, [currentUser, refresh]);

  // ---- Auth actions ---------------------------------------------------------
  const signInDemo = useCallback((userId: string) => {
    const user = DEMO_USERS.find((u) => u.id === userId) ?? null;
    if (user) localStorage.setItem(DEMO_USER_KEY, user.id);
    setCurrentUser(user);
  }, []);

  const signInSupabase = useCallback(async (email: string, password: string) => {
    const { error: err } = await getSupabase().auth.signInWithPassword({ email, password });
    return err ? err.message : null;
  }, []);

  const signUpSupabase = useCallback(async (email: string, password: string) => {
    const { error: err } = await getSupabase().auth.signUp({ email, password });
    return err ? err.message : null;
  }, []);

  const signOut = useCallback(async () => {
    if (mode === "supabase") await getSupabase().auth.signOut();
    localStorage.removeItem(DEMO_USER_KEY);
    setCurrentUser(null);
    setData(null);
  }, [mode]);

  // ---- Mutations ------------------------------------------------------------
  const run = useCallback(
    async <T = void,>(fn: () => Promise<DataSnapshot>, after?: (s: DataSnapshot) => T): Promise<T> => {
      setBusy(true);
      setError(null);
      try {
        const snapshot = await fn();
        setData(snapshot);
        setToday(todayISO());
        return after ? after(snapshot) : (undefined as T);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const logContact = useCallback(
    (input: LogContactInput) =>
      run(
        () => adapter.logContact(input),
        (s) => s.dueDates.filter((d) => d.clientId === input.clientId),
      ),
    [adapter, run],
  );

  const addClient = useCallback(
    (input: AddClientInput) => {
      const before = new Set((data?.clients ?? []).map((c) => c.id));
      return run(
        () => adapter.addClient(input),
        (s) => s.clients.find((c) => !before.has(c.id)) ?? null,
      );
    },
    [adapter, run, data],
  );

  const importClients = useCallback(
    (inputs: AddClientInput[]) => run(() => adapter.importClients(inputs)),
    [adapter, run],
  );

  const updateContactEvent = useCallback(
    (eventId: string, patch: UpdateContactInput) =>
      run(() => adapter.updateContactEvent(eventId, patch)),
    [adapter, run],
  );

  const deleteContactEvent = useCallback(
    (eventId: string) => run(() => adapter.deleteContactEvent(eventId)),
    [adapter, run],
  );

  const snoozeTouch = useCallback(
    (clientId: string, type: TouchType, untilDate: string | null) =>
      run(() => adapter.snoozeTouch(clientId, type, untilDate)),
    [adapter, run],
  );

  const updateClient = useCallback(
    (clientId: string, patch: UpdateClientInput) =>
      run(() => adapter.updateClient(clientId, patch)),
    [adapter, run],
  );

  const updateServiceModel = useCallback(
    (model: ServiceModel) => run(() => adapter.updateServiceModel(model)),
    [adapter, run],
  );

  const rebuildQueue = useCallback(() => run(() => adapter.rebuildQueue()), [adapter, run]);

  const resetDemo = useCallback(async () => {
    if (adapter.reset) await run(() => adapter.reset!());
  }, [adapter, run]);

  const value = useMemo<AppContextValue>(
    () => ({
      mode,
      authReady,
      currentUser,
      signInDemo,
      signInSupabase,
      signUpSupabase,
      signOut,
      data,
      loading,
      busy,
      error,
      today,
      refresh,
      logContact,
      addClient,
      importClients,
      updateContactEvent,
      deleteContactEvent,
      snoozeTouch,
      updateClient,
      updateServiceModel,
      rebuildQueue,
      resetDemo,
    }),
    [
      mode, authReady, currentUser, signInDemo, signInSupabase, signUpSupabase, signOut,
      data, loading, busy, error, today, refresh,
      logContact, addClient, importClients, updateContactEvent, deleteContactEvent, snoozeTouch,
      updateClient, updateServiceModel, rebuildQueue, resetDemo,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
