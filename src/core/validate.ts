import type { AppState, ID, ProjectRole, WorkspaceRole } from "./types";
import { PROJECT_ROLES, WORKSPACE_ROLES } from "./rbac";

/**
 * Text limits enforced by the reducer (the UI may add `maxLength` as a hint).
 * They keep a single paste from exhausting the ~5 MB storage quota.
 */
export const TEXT_LIMITS = {
  name: 500,
  title: 200,
  email: 254,
  comment: 10_000,
  body: 20_000,
  chat: 4_000,
} as const;

/** Hard cap for any string found in persisted data. */
const MAX_STORED_STRING = 50_000;

export function clampText(value: unknown, max: number): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string) => v.length <= TEXT_LIMITS.email && EMAIL.test(v);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-clamp oversized strings; returns the same reference when nothing changed. */
function clampDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") {
    return (value.length > MAX_STORED_STRING ? value.slice(0, MAX_STORED_STRING) : value) as T;
  }
  if (depth > 6 || value === null || typeof value !== "object") return value;
  let changed = false;
  if (Array.isArray(value)) {
    const out = value.map((v) => {
      const c = clampDeep(v, depth + 1);
      if (c !== v) changed = true;
      return c;
    });
    return (changed ? out : value) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = clampDeep(v, depth + 1);
    if (c !== v) changed = true;
    out[k] = c;
  }
  return (changed ? out : value) as T;
}

/**
 * Make persisted (untrusted) state safe to run: drop malformed records and
 * duplicate ids, coerce unknown roles to least privilege, repair dangling
 * references and cap string sizes. Returns how many repairs were made.
 *
 * This guards against corrupted or hand-edited storage crashing the app. It
 * is *not* a security boundary — on a client-only app the user owns their
 * storage; real enforcement needs a server running `authorize()`.
 */
export function sanitizeState(input: AppState): { state: AppState; repairs: number } {
  let repairs = 0;
  const state = { ...input } as AppState;
  const record = state as unknown as Record<string, unknown>;

  // 1. every collection: objects with a string id, unique, size-capped
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value) || key === "recentlyViewed") continue;
    const seen = new Set<string>();
    const keyed = value.some((x) => isObject(x) && "id" in x);
    const kept = value.filter((item) => {
      if (!isObject(item)) return (repairs++, false);
      if (keyed) {
        if (typeof item.id !== "string" || seen.has(item.id)) return (repairs++, false);
        seen.add(item.id);
      }
      return true;
    });
    const clamped = clampDeep(kept);
    if (clamped !== value) record[key] = clamped;
    if (kept.length === value.length && clamped !== kept) repairs++;
  }

  // 2. roles: unknown values fall back to least privilege
  state.users = state.users.map((u) => {
    if (u.workspaceRole === undefined || WORKSPACE_ROLES.includes(u.workspaceRole)) return u;
    repairs++;
    return { ...u, workspaceRole: "guest" as WorkspaceRole };
  });
  const userIds = new Set(state.users.map((u) => u.id));
  state.projects = state.projects.map((p) => {
    let next = p;
    if (p.privacy !== "public" && p.privacy !== "private") {
      repairs++;
      next = { ...next, privacy: "private" };
    }
    if (!Array.isArray(p.memberIds)) {
      repairs++;
      next = { ...next, memberIds: [] };
    }
    if (p.roles !== undefined) {
      const roles: Record<ID, ProjectRole> = {};
      let bad = !isObject(p.roles);
      for (const [uid, role] of Object.entries(isObject(p.roles) ? p.roles : {})) {
        if (PROJECT_ROLES.includes(role as ProjectRole) && userIds.has(uid)) roles[uid] = role as ProjectRole;
        else bad = true;
      }
      if (bad) {
        repairs++;
        next = { ...next, roles };
      }
    }
    return next;
  });

  // 3. referential integrity for the task graph
  const projectIds = new Set(state.projects.map((p) => p.id));
  const sectionsOk = state.sections.filter((s) => projectIds.has(s.projectId));
  if (sectionsOk.length !== state.sections.length) {
    repairs += state.sections.length - sectionsOk.length;
    state.sections = sectionsOk;
  }
  const sectionProject = new Map(state.sections.map((s) => [s.id, s.projectId]));
  const taskIds = new Set(state.tasks.map((t) => t.id));
  const arr = (v: unknown): ID[] => (Array.isArray(v) ? v.filter((x): x is ID => typeof x === "string") : []);
  state.tasks = state.tasks.map((t) => {
    const fix: Partial<typeof t> = {};
    if (typeof t.name !== "string") fix.name = "Untitled task";
    if (t.projectId != null && !projectIds.has(t.projectId)) fix.projectId = null;
    const projectId = fix.projectId !== undefined ? fix.projectId : t.projectId;
    if (t.sectionId != null && sectionProject.get(t.sectionId) !== projectId) fix.sectionId = null;
    if (t.parentId != null && (!taskIds.has(t.parentId) || t.parentId === t.id)) fix.parentId = null;
    for (const key of ["followerIds", "tagIds", "likeUserIds"] as const) {
      if (!Array.isArray(t[key])) fix[key] = arr(t[key]);
    }
    for (const key of ["blockedByIds", "blockingIds"] as const) {
      const clean = arr(t[key]).filter((id) => taskIds.has(id) && id !== t.id);
      if (!Array.isArray(t[key]) || clean.length !== t[key].length) fix[key] = clean;
    }
    if (!Array.isArray(t.attachments)) fix.attachments = [];
    if (!isObject(t.customFields)) fix.customFields = {};
    if (!Object.keys(fix).length) return t;
    repairs++;
    return { ...t, ...fix };
  });
  const commentsOk = state.comments.filter((c) => taskIds.has(c.taskId));
  if (commentsOk.length !== state.comments.length) {
    repairs += state.comments.length - commentsOk.length;
    state.comments = commentsOk;
  }

  // 4. security policy: well-formed or default
  const sec = (state as { security?: unknown }).security as Record<string, unknown> | undefined;
  const okSec =
    isObject(sec) &&
    typeof sec.sessionHours === "number" &&
    typeof sec.requireTwoFactor === "boolean" &&
    Array.isArray(sec.inviteDomains) &&
    typeof sec.impersonationMinutes === "number";
  if (!okSec) {
    repairs++;
    state.security = { sessionHours: 12, requireTwoFactor: false, inviteDomains: [], impersonationMinutes: 30 };
  }

  // 5. identity must point at a real person
  if (!userIds.has(state.currentUserId)) {
    repairs++;
    state.currentUserId = state.users.find((u) => u.workspaceRole === "owner")?.id ?? state.users[0]?.id;
  }
  if (state.impersonatorId && !userIds.has(state.impersonatorId)) {
    repairs++;
    state.impersonatorId = null;
  }
  return { state, repairs };
}
