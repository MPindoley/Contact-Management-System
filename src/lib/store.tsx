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
  AddProspectInput,
  Client,
  DataSnapshot,
  DueDate,
  FamilyRole,
  LogContactInput,
  LogProspectInput,
  Prospect,
  ServiceModel,
  Tier,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
  UpdateProspectInput,
  User,
} from "../types";
import type { DataAdapter } from "./data/adapter";
import { createDemoAdapter } from "./data/demoAdapter";
import { createSupabaseAdapter, getSupabase, isSupabaseConfigured } from "./data/supabaseAdapter";
import { DEMO_USERS } from "./data/demoSeed";
import { scopeSnapshot } from "./visibility";
import { clearStickyState } from "./stickyState";
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
  importClients(
    creates: AddClientInput[],
    updates: Array<{ id: string; patch: UpdateClientInput }>,
  ): Promise<void>;
  updateContactEvent(eventId: string, patch: UpdateContactInput): Promise<void>;
  deleteContactEvent(eventId: string): Promise<void>;
  snoozeTouch(clientId: string, type: TouchType, untilDate: string | null): Promise<void>;
  planOutreach(items: Array<{ clientId: string; dueDate: string }>): Promise<void>;
  updateClient(clientId: string, patch: UpdateClientInput): Promise<void>;
  /** Book an upcoming meeting (keeps it off the queue until then). */
  scheduleMeeting(clientId: string, date: string, note: string | null): Promise<void>;
  clearScheduledMeeting(clientId: string): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  linkFamily(
    clientIds: string[],
    familyId: string | null,
    name: string | null,
    roles?: Record<string, FamilyRole>,
  ): Promise<void>;
  unlinkFromFamily(clientId: string): Promise<void>;
  renameFamily(familyId: string, name: string): Promise<void>;
  autoLinkBySurname(): Promise<void>;
  updateServiceModel(model: ServiceModel): Promise<void>;
  bulkSetTiers(assignments: Array<{ clientId: string; tier: Tier }>): Promise<void>;
  addProspect(input: AddProspectInput): Promise<Prospect | null>;
  updateProspect(prospectId: string, patch: UpdateProspectInput): Promise<void>;
  deleteProspect(prospectId: string): Promise<void>;
  logProspectContact(input: LogProspectInput): Promise<void>;
  deleteProspectEvent(eventId: string): Promise<void>;
  rebuildQueue(): Promise<void>;
  adminResetPassword(targetUserId: string): Promise<{ tempPassword: string; name: string }>;
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

  const [rawData, setData] = useState<DataSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(todayISO());

  // Narrow everything to what the signed-in user is allowed to see. The
  // database enforces the same rule (RLS) for Supabase; this keeps the UI
  // honest and does the work in demo mode.
  const data = useMemo<DataSnapshot | null>(
    () => (rawData && currentUser ? scopeSnapshot(rawData, currentUser) : rawData),
    [rawData, currentUser],
  );

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
      const columns = "id, name, email, role, advisor_key, sees_all_books";

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
          ? {
              id: row.id,
              name: row.name,
              email: row.email,
              role: row.role,
              advisorKey: row.advisor_key,
              // Older databases without the column → assistants see all,
              // advisors default to their own book.
              seesAllBooks: row.sees_all_books ?? row.role === "assistant",
            }
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
    clearStickyState();
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
      const before = new Set((rawData?.clients ?? []).map((c) => c.id));
      return run(
        () => adapter.addClient(input),
        (s) => s.clients.find((c) => !before.has(c.id)) ?? null,
      );
    },
    [adapter, run, rawData],
  );

  const importClients = useCallback(
    (creates: AddClientInput[], updates: Array<{ id: string; patch: UpdateClientInput }>) =>
      run(() => adapter.importClients(creates, updates)),
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

  const planOutreach = useCallback(
    (items: Array<{ clientId: string; dueDate: string }>) =>
      run(() => adapter.planOutreach(items)),
    [adapter, run],
  );

  const updateClient = useCallback(
    (clientId: string, patch: UpdateClientInput) =>
      run(() => adapter.updateClient(clientId, patch)),
    [adapter, run],
  );

  // Booking a meeting records it on the household AND parks the meeting touch
  // until that day, reusing the same overlay the snooze button uses. It is
  // never a completed touch, so the service score is untouched until the
  // meeting actually happens and is logged.
  const scheduleMeeting = useCallback(
    async (clientId: string, date: string, note: string | null) => {
      await updateClient(clientId, { nextMeetingDate: date, nextMeetingNote: note });
      await snoozeTouch(clientId, "meeting", date);
    },
    [updateClient, snoozeTouch],
  );

  const clearScheduledMeeting = useCallback(
    async (clientId: string) => {
      await updateClient(clientId, { nextMeetingDate: null, nextMeetingNote: null });
      await snoozeTouch(clientId, "meeting", null);
    },
    [updateClient, snoozeTouch],
  );

  const deleteClient = useCallback(
    (clientId: string) => run(() => adapter.deleteClient(clientId)),
    [adapter, run],
  );

  const linkFamily = useCallback(
    (
      clientIds: string[],
      familyId: string | null,
      name: string | null,
      roles?: Record<string, FamilyRole>,
    ) => run(() => adapter.linkFamily(clientIds, familyId, name, roles)),
    [adapter, run],
  );

  const unlinkFromFamily = useCallback(
    (clientId: string) => run(() => adapter.unlinkFromFamily(clientId)),
    [adapter, run],
  );

  const renameFamily = useCallback(
    (familyId: string, name: string) => run(() => adapter.renameFamily(familyId, name)),
    [adapter, run],
  );

  const autoLinkBySurname = useCallback(() => run(() => adapter.autoLinkBySurname()), [adapter, run]);

  const updateServiceModel = useCallback(
    (model: ServiceModel) => run(() => adapter.updateServiceModel(model)),
    [adapter, run],
  );

  const bulkSetTiers = useCallback(
    (assignments: Array<{ clientId: string; tier: Tier }>) =>
      run(() => adapter.bulkSetTiers(assignments)),
    [adapter, run],
  );

  const addProspect = useCallback(
    (input: AddProspectInput) => {
      const before = new Set((rawData?.prospects ?? []).map((p) => p.id));
      return run(
        () => adapter.addProspect(input),
        (s) => s.prospects.find((p) => !before.has(p.id)) ?? null,
      );
    },
    [adapter, run, rawData],
  );

  const updateProspect = useCallback(
    (prospectId: string, patch: UpdateProspectInput) =>
      run(() => adapter.updateProspect(prospectId, patch)),
    [adapter, run],
  );

  const deleteProspect = useCallback(
    (prospectId: string) => run(() => adapter.deleteProspect(prospectId)),
    [adapter, run],
  );

  const logProspectContact = useCallback(
    (input: LogProspectInput) => run(() => adapter.logProspectContact(input)),
    [adapter, run],
  );

  const deleteProspectEvent = useCallback(
    (eventId: string) => run(() => adapter.deleteProspectEvent(eventId)),
    [adapter, run],
  );

  const rebuildQueue = useCallback(() => run(() => adapter.rebuildQueue()), [adapter, run]);

  // Not a data mutation (no snapshot to refresh) — the component shows the
  // returned temp password and handles its own pending/error state.
  const adminResetPassword = useCallback(
    (targetUserId: string) => adapter.adminResetPassword(targetUserId),
    [adapter],
  );

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
      planOutreach,
      updateClient,
      scheduleMeeting,
      clearScheduledMeeting,
      deleteClient,
      linkFamily,
      unlinkFromFamily,
      renameFamily,
      autoLinkBySurname,
      updateServiceModel,
      bulkSetTiers,
      addProspect,
      updateProspect,
      deleteProspect,
      logProspectContact,
      deleteProspectEvent,
      rebuildQueue,
      adminResetPassword,
      resetDemo,
    }),
    [
      mode, authReady, currentUser, signInDemo, signInSupabase, signUpSupabase, signOut,
      data, loading, busy, error, today, refresh,
      logContact, addClient, importClients, updateContactEvent, deleteContactEvent, snoozeTouch,
      planOutreach, updateClient, scheduleMeeting, clearScheduledMeeting, deleteClient,
      linkFamily, unlinkFromFamily, renameFamily, autoLinkBySurname, updateServiceModel,
      addProspect, updateProspect, deleteProspect, logProspectContact, deleteProspectEvent,
      rebuildQueue, adminResetPassword, resetDemo,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
