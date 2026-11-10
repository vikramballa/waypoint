import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { AppState, ID, ProjectRole, User } from "./types";
import { createSeedState } from "./seed";
import { newIdSeed, uid, withIdSeed } from "./utils";
import {
  can as canPermission,
  canEditTask,
  effectiveProjectRole,
  scopeStateForViewer,
  type Permission,
} from "./rbac";
import { applyPatch, type Patch } from "./history";
import {
  authorize,
  compactForStorage,
  hydrate,
  reducer,
  STORAGE_KEY,
  type Action,
} from "./reducer";

export * from "./reducer";

/* =================================================================
 * Two runtimes behind one API:
 *
 *  local  — no server: state lives in this browser (localStorage), synced
 *           across tabs. Everything still goes through authorize().
 *  server — the Waypoint server is authoritative. Actions apply instantly
 *           (optimistic) as `pending`, are POSTed, and are reconciled with the
 *           server's acknowledged patches over Server-Sent Events. What you
 *           see = server-confirmed view + your pending actions replayed.
 * ================================================================= */

const PREFS_KEY = "waypoint-prefs";
const HISTORY_LIMIT = 40;

/** Never create an undo step. */
const NON_UNDOABLE = new Set<Action["type"]>([
  "ui/patch",
  "view/visit",
  "notification/read",
  "notification/readAll",
  "impersonate",
  "agent/runAdvance",
  "session/advance",
  "chat/selectThread",
  "audit/denied",
  "rules/tick",
  "state/load",
  "state/replace",
]);

/** Per-browser preferences: applied locally, never sent to the server. */
const CLIENT_ONLY = new Set<Action["type"]>(["ui/patch", "view/visit", "chat/selectThread"]);

export type Mode = "detecting" | "local" | "server" | "login" | "enroll";
export type Connection = "live" | "connecting" | "offline";

export interface ServerMe {
  mode: "server";
  authenticated: boolean;
  userId: ID;
  email: string;
  name: string;
  viewAs: { userId: ID; expiresAt: string; reason: string } | null;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  mustEnroll: boolean;
}

export interface PresenceEntry {
  userId: ID;
  taskId: ID | null;
  projectId: ID | null;
}

export interface Toast {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Pending {
  seq: number;
  action: Action;
  idSeed: string;
  sent: boolean;
}

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  data: T;
}

interface AppContextValue {
  /** What the current user may read (see `scopeStateForViewer`). */
  state: AppState;
  dispatch: React.Dispatch<Action>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  can: (permission: Permission, projectId?: ID | null) => boolean;
  projectRole: (projectId: ID) => ProjectRole | null;
  canEdit: (taskId: ID) => boolean;
  toast: (message: string, actionLabel?: string, onAction?: () => void) => void;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  user: User;
  userById: (id: ID | null | undefined) => User | undefined;
  /** The admin behind a "View as" session, if any. */
  impersonator: User | null;
  /* runtime */
  mode: Mode;
  me: ServerMe | null;
  connection: Connection;
  presence: PresenceEntry[];
  setPresence: (taskId: ID | null, projectId: ID | null) => void;
  api: <T = Record<string, unknown>>(path: string, init?: RequestInit & { json?: unknown }) => Promise<ApiResult<T>>;
  signedIn: (me: ServerMe) => void;
  logout: () => void;
  resetWorkspace: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/* ------------------------------------------------------------- helpers */

function loadLocal(): AppState {
  try {
    return hydrate(localStorage.getItem(STORAGE_KEY));
  } catch {
    return createSeedState();
  }
}

function readPrefs(): Partial<AppState> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writePrefs(state: AppState) {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ui: state.ui, recentlyViewed: state.recentlyViewed, activeThreadId: state.activeThreadId })
    );
  } catch {
    /* storage unavailable */
  }
}

async function apiCall<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "x-requested-with": "waypoint", ...((init.headers as Record<string, string>) ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data: data as T };
}

const ERROR_TEXT: Record<string, string> = {
  forbidden: "You don't have permission to do that",
  slow_down: "You're going a bit fast — try again in a moment",
  two_factor_enrollment_required: "Set up two-factor sign-in to continue",
  not_allowed_from_client: "That action isn't allowed",
};

/* ============================================================ provider */

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("detecting");
  const [me, setMe] = useState<ServerMe | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [presence, setPresenceList] = useState<PresenceEntry[]>([]);
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const modeRef = useRef<Mode>("detecting");
  modeRef.current = mode;
  /** local: the full workspace · server: the server-confirmed view */
  const base = useRef<AppState>(loadLocal());
  const pending = useRef<Pending[]>([]);
  const seq = useRef(0);
  const clientId = useRef(uid("tab"));
  const past = useRef<AppState[]>([]);
  const future = useRef<AppState[]>([]);

  const toast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    const id = uid("toast");
    setToasts((t) => [...t.slice(-3), { id, message, actionLabel, onAction }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /* --------------------------------------------- derived display state */
  const display = useMemo(() => {
    if (mode !== "server") return base.current;
    let s = base.current;
    for (const p of pending.current) s = withIdSeed(p.idSeed, () => reducer(s, p.action));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, mode]);
  /** The latest state, computed synchronously (several dispatches per event must compose). */
  const latest = useCallback((): AppState => {
    if (modeRef.current !== "server") return base.current;
    let s = base.current;
    for (const p of pending.current) s = withIdSeed(p.idSeed, () => reducer(s, p.action));
    return s;
  }, []);

  /* ------------------------------------------------------ detect mode */
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2500);
    fetch("/api/session", { credentials: "same-origin", signal: ctrl.signal })
      .then((r) => r.json())
      .then((data: Partial<ServerMe> & { mode?: string }) => {
        if (cancelled) return;
        if (data.mode !== "server") return setMode("local");
        if (!data.authenticated) return setMode("login");
        setMe(data as ServerMe);
        setMode(data.mustEnroll ? "enroll" : "server");
      })
      .catch(() => !cancelled && setMode("local"))
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  /* ======================================================= server mode */
  const flush = useRef<() => void>(() => undefined);
  flush.current = () => {
    for (const p of pending.current) {
      if (p.sent) continue;
      p.sent = true;
      apiCall("/api/actions", {
        method: "POST",
        json: { action: p.action, seq: p.seq, clientId: clientId.current, idSeed: p.idSeed },
      })
        .then(({ status, data }) => {
          if (status === 200) return; // the SSE ack drops it
          if (status === 400 && (data as { error?: string }).error === "bad_id_seed") {
            // a retry of something the server already applied
            pending.current = pending.current.filter((x) => x.seq !== p.seq);
            return bump();
          }
          pending.current = pending.current.filter((x) => x.seq !== p.seq);
          bump();
          toast(ERROR_TEXT[(data as { error?: string }).error ?? ""] ?? "That change couldn't be saved");
          if (status === 401) setMode("login");
        })
        .catch(() => {
          p.sent = false; // retried when the stream reconnects
          setConnection("offline");
        });
    }
  };

  useEffect(() => {
    if (mode !== "server") return;
    let es: EventSource | null = null;
    let closed = false;
    let failures = 0;
    const connect = () => {
      es = new EventSource(`/api/stream?client=${clientId.current}`);
      setConnection("connecting");
      es.addEventListener("snapshot", (ev) => {
        failures = 0;
        const { state, me: info } = JSON.parse((ev as MessageEvent).data) as { state: AppState; me: ServerMe };
        const prefs = readPrefs();
        base.current = { ...state, ...prefs, ui: { ...state.ui, ...(prefs.ui ?? {}) } } as AppState;
        pending.current = pending.current.filter((p) => !p.sent);
        setMe(info);
        setConnection("live");
        bump();
        flush.current();
      });
      es.addEventListener("patch", (ev) => {
        const { patch, ack } = JSON.parse((ev as MessageEvent).data) as { patch: Patch; ack?: number };
        const next = applyPatch(base.current, patch);
        if (!next) {
          // out of sync (missed a message): reconnect for a fresh snapshot
          es?.close();
          connect();
          return;
        }
        base.current = next;
        if (ack !== undefined) pending.current = pending.current.filter((p) => p.seq > ack);
        bump();
      });
      es.addEventListener("presence", (ev) => {
        setPresenceList((JSON.parse((ev as MessageEvent).data) as { entries: PresenceEntry[] }).entries);
      });
      es.addEventListener("logout", () => {
        closed = true;
        es?.close();
        setMode("login");
        toast("You were signed out");
      });
      es.onerror = () => {
        setConnection(navigator.onLine ? "connecting" : "offline");
        failures++;
        if (failures >= 3) {
          // maybe the session ended; ask once
          apiCall<ServerMe>("/api/session")
            .then(({ data }) => {
              if (data.mode === "server" && !data.authenticated) {
                closed = true;
                es?.close();
                setMode("login");
              }
            })
            .catch(() => undefined);
          failures = 0;
        }
      };
    };
    connect();
    // react to the network right away instead of waiting for the stream to time out
    const onOffline = () => setConnection("offline");
    const onOnline = () => {
      es?.close();
      connect(); // fresh snapshot, then queued actions are re-sent
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      void closed;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      es?.close();
    };
  }, [mode, toast]);

  /* ======================================================== local mode */
  const lastWritten = useRef<string | null>(null);
  const warnedQuota = useRef(false);
  const persistLocal = useCallback(() => {
    if (modeRef.current !== "local") return;
    let json = JSON.stringify(base.current);
    if (json === lastWritten.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, json);
      lastWritten.current = json;
    } catch {
      try {
        json = JSON.stringify(compactForStorage(base.current));
        localStorage.setItem(STORAGE_KEY, json);
        lastWritten.current = json;
      } catch {
        if (!warnedQuota.current) {
          warnedQuota.current = true;
          toast("Browser storage is full — recent changes may not survive a reload");
        }
      }
    }
  }, [toast]);

  useEffect(() => {
    if (mode !== "local") return;
    const handle = window.setTimeout(persistLocal, 300);
    return () => window.clearTimeout(handle);
  }, [version, mode, persistLocal]);

  useEffect(() => {
    if (mode !== "local") return;
    const onHide = () => document.visibilityState === "hidden" && persistLocal();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || e.newValue === lastWritten.current) return;
      lastWritten.current = e.newValue;
      const incoming = hydrate(e.newValue);
      const cur = base.current;
      base.current = {
        ...incoming,
        currentUserId: cur.currentUserId,
        impersonatorId: cur.impersonatorId,
        impersonationExpiresAt: cur.impersonationExpiresAt,
        impersonationReason: cur.impersonationReason,
        ui: cur.ui,
      };
      bump();
    };
    window.addEventListener("pagehide", persistLocal);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pagehide", persistLocal);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("storage", onStorage);
    };
  }, [mode, persistLocal]);

  /* local clocks: scheduled rules + "View as" time limit */
  useEffect(() => {
    if (mode !== "local") return;
    const tick = () => {
      const s = base.current;
      const next = reducer(s, { type: "rules/tick", now: new Date().toISOString() });
      let changed = next !== s;
      let out = next;
      if (out.impersonatorId && out.impersonationExpiresAt && new Date(out.impersonationExpiresAt).getTime() < Date.now()) {
        out = reducer(out, { type: "impersonate", userId: out.impersonatorId });
        past.current = [];
        future.current = [];
        changed = true;
        toast("“View as” ended automatically");
      }
      if (changed) {
        base.current = out;
        bump();
      }
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [mode, toast]);

  /* ========================================================== dispatch */
  const dispatch = useCallback<React.Dispatch<Action>>(
    (action) => {
      const m = modeRef.current;
      if (m !== "local" && m !== "server") return;
      const current = latest();

      if (m === "server") {
        if (CLIENT_ONLY.has(action.type)) {
          base.current = reducer(base.current, action);
          writePrefs(base.current);
          return bump();
        }
        if (!authorize(current, action)) {
          toast(ERROR_TEXT.forbidden);
          // still tell the server, which records the blocked attempt in the audit log
          apiCall("/api/actions", { method: "POST", json: { action, clientId: clientId.current } }).catch(() => undefined);
          return;
        }
        pending.current = [...pending.current, { seq: ++seq.current, action, idSeed: newIdSeed(), sent: false }];
        bump();
        flush.current();
        return;
      }

      // local
      if (!authorize(current, action)) {
        toast(ERROR_TEXT.forbidden);
        base.current = reducer(current, { type: "audit/denied", attempted: action.type });
        return bump();
      }
      if (action.type === "impersonate") {
        past.current = [];
        future.current = [];
      } else if (!NON_UNDOABLE.has(action.type)) {
        past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), current];
        future.current = [];
      }
      base.current = reducer(current, action);
      bump();
    },
    [toast, latest]
  );

  const undo = useCallback(() => {
    if (modeRef.current === "server") {
      apiCall("/api/undo", { method: "POST", json: {} }).then(({ status }) => {
        if (status === 409) toast("Someone changed this since — nothing was undone");
        else if (status === 404) toast("Nothing to undo");
        else if (status === 403) toast(ERROR_TEXT.forbidden);
      });
      return;
    }
    const prev = past.current.pop();
    if (!prev) return;
    const cur = base.current;
    future.current = [cur, ...future.current].slice(0, HISTORY_LIMIT);
    base.current = {
      ...prev,
      currentUserId: cur.currentUserId,
      impersonatorId: cur.impersonatorId,
      impersonationExpiresAt: cur.impersonationExpiresAt,
      impersonationReason: cur.impersonationReason,
      ui: cur.ui,
      auditLog: cur.auditLog,
    };
    bump();
  }, [toast]);

  const redo = useCallback(() => {
    if (modeRef.current === "server") {
      apiCall("/api/redo", { method: "POST", json: {} }).then(({ status }) => {
        if (status === 409) toast("Someone changed this since — nothing was redone");
        else if (status === 404) toast("Nothing to redo");
      });
      return;
    }
    const next = future.current.shift();
    if (!next) return;
    const cur = base.current;
    past.current = [...past.current, cur];
    base.current = {
      ...next,
      currentUserId: cur.currentUserId,
      impersonatorId: cur.impersonatorId,
      impersonationExpiresAt: cur.impersonationExpiresAt,
      impersonationReason: cur.impersonationReason,
      ui: cur.ui,
      auditLog: cur.auditLog,
    };
    bump();
  }, [toast]);

  /* ========================================================== presence */
  const channel = useRef<BroadcastChannel | null>(null);
  const localPeers = useRef(new Map<string, PresenceEntry & { at: number }>());
  const myPresence = useRef<{ taskId: ID | null; projectId: ID | null }>({ taskId: null, projectId: null });

  useEffect(() => {
    if (mode !== "local" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("waypoint-presence");
    channel.current = ch;
    const publish = () =>
      ch.postMessage({ tab: clientId.current, userId: base.current.currentUserId, ...myPresence.current, at: Date.now() });
    const refresh = () => {
      const now = Date.now();
      for (const [k, v] of localPeers.current) if (now - v.at > 25_000) localPeers.current.delete(k);
      setPresenceList([...localPeers.current.values()].map(({ userId, taskId, projectId }) => ({ userId, taskId, projectId })));
    };
    ch.onmessage = (ev) => {
      const m = ev.data as { tab: string; userId: ID; taskId: ID | null; projectId: ID | null; at: number; bye?: boolean };
      if (m.bye) localPeers.current.delete(m.tab);
      else localPeers.current.set(m.tab, m);
      refresh();
    };
    const heartbeat = window.setInterval(() => {
      publish();
      refresh();
    }, 10_000);
    const bye = () => ch.postMessage({ tab: clientId.current, bye: true });
    window.addEventListener("pagehide", bye);
    publish();
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", bye);
      bye();
      ch.close();
      channel.current = null;
    };
  }, [mode]);

  const presenceTimer = useRef<number | null>(null);
  const setPresence = useCallback((taskId: ID | null, projectId: ID | null) => {
    const prev = myPresence.current;
    if (prev.taskId === taskId && prev.projectId === projectId) return;
    myPresence.current = { taskId, projectId };
    if (modeRef.current === "local") {
      channel.current?.postMessage({ tab: clientId.current, userId: base.current.currentUserId, taskId, projectId, at: Date.now() });
      return;
    }
    if (modeRef.current !== "server") return;
    if (presenceTimer.current) window.clearTimeout(presenceTimer.current);
    presenceTimer.current = window.setTimeout(() => {
      apiCall("/api/presence", { method: "POST", json: { clientId: clientId.current, ...myPresence.current } }).catch(() => undefined);
    }, 250);
  }, []);

  /* ============================================================ account */
  const signedIn = useCallback((info: ServerMe) => {
    setMe(info);
    pending.current = [];
    setMode(info.mustEnroll ? "enroll" : "server");
  }, []);

  const logout = useCallback(() => {
    apiCall("/api/logout", { method: "POST", json: {} }).finally(() => {
      setMe(null);
      pending.current = [];
      setMode("login");
    });
  }, []);

  const resetWorkspace = useCallback(() => {
    if (modeRef.current === "server") {
      apiCall("/api/reset", { method: "POST", json: {} }).then(({ status }) =>
        toast(status === 200 ? "Workspace reset to demo data" : ERROR_TEXT.forbidden)
      );
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, [toast]);

  /* theme */
  useEffect(() => {
    document.documentElement.dataset.theme = display.ui.theme;
  }, [display.ui.theme]);

  /* ---------------------------------------------------------- context */
  const scoped = useMemo(() => (mode === "server" ? display : scopeStateForViewer(display)), [display, mode]);
  const usersById = useMemo(() => new Map(display.users.map((u) => [u.id, u])), [display.users]);
  const helpers = useMemo(
    () => ({
      userById: (id: ID | null | undefined) => (id ? usersById.get(id) : undefined),
      can: (permission: Permission, projectId?: ID | null) =>
        canPermission(display, permission, { projectId: projectId ?? null }),
      canEdit: (taskId: ID) => canEditTask(display, taskId),
      projectRole: (projectId: ID) => {
        const project = display.projects.find((p) => p.id === projectId);
        return project ? effectiveProjectRole(display, project) : null;
      },
    }),
    [display, usersById]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state: scoped,
      dispatch,
      undo,
      redo,
      canUndo: mode === "server" || past.current.length > 0,
      canRedo: mode === "server" || future.current.length > 0,
      toast,
      toasts,
      dismissToast,
      user: usersById.get(display.currentUserId) ?? display.users[0],
      impersonator: display.impersonatorId ? usersById.get(display.impersonatorId) ?? null : null,
      mode,
      me,
      connection: mode === "server" ? connection : "live",
      presence,
      setPresence,
      api: apiCall,
      signedIn,
      logout,
      resetWorkspace,
      ...helpers,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, display.currentUserId, display.impersonatorId, usersById, helpers, dispatch, undo, redo, toast, toasts, dismissToast, mode, me, connection, presence, setPresence, signedIn, logout, resetWorkspace, version]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
