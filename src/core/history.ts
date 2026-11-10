/**
 * Record-level diffs between two AppStates.
 *
 * Two consumers:
 *  1. Undo/redo. An action is remembered as the records it changed (before →
 *     after). Undo restores `before` only if each record still equals `after`,
 *     so in a multi-user workspace you can never clobber someone else's later
 *     edit — the undo is refused as a conflict instead.
 *  2. Live sync. The server sends each viewer a patch of upserted/removed
 *     records between the last view it sent and the new one.
 *
 * Relies on the reducer's structural sharing: unchanged records keep their
 * object identity, so comparing references is enough to find changes.
 */
import type { AppState, ID } from "./types";

type AnyRecord = { id: ID } & Record<string, unknown>;

/** Per-session / client-only fields that never travel in diffs. */
export const SESSION_KEYS = new Set([
  "currentUserId",
  "impersonatorId",
  "impersonationExpiresAt",
  "impersonationReason",
  "ui",
  "recentlyViewed",
  "activeThreadId",
]);

const isRecordArray = (v: unknown): v is AnyRecord[] =>
  Array.isArray(v) && (v.length === 0 || (typeof v[0] === "object" && v[0] !== null && "id" in (v[0] as object)));

/* ----------------------------------------------------------- undo/redo */

export interface RecordChange {
  key: string;
  id: ID;
  /** null = record did not exist */
  before: AnyRecord | null;
  after: AnyRecord | null;
  /** index in the "after" array (or the "before" array when removed) */
  index: number;
}

export function recordChanges(before: AppState, after: AppState, ignore: Set<string> = new Set()): RecordChange[] {
  const out: RecordChange[] = [];
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (SESSION_KEYS.has(key) || ignore.has(key)) continue;
    const prev = a[key];
    const next = b[key];
    if (prev === next || !isRecordArray(next) || !isRecordArray(prev)) continue;
    const prevById = new Map(prev.map((r, i) => [r.id, { r, i }]));
    const seen = new Set<ID>();
    next.forEach((r, i) => {
      seen.add(r.id);
      const old = prevById.get(r.id);
      if (!old) out.push({ key, id: r.id, before: null, after: r, index: i });
      else if (old.r !== r) out.push({ key, id: r.id, before: old.r, after: r, index: i });
    });
    for (const [id, old] of prevById) {
      if (!seen.has(id)) out.push({ key, id, before: old.r, after: null, index: old.i });
    }
  }
  return out;
}

const same = (x: unknown, y: unknown) => x === y || JSON.stringify(x) === JSON.stringify(y);

/**
 * Revert `changes` on `state`. Returns null when any touched record has been
 * changed since (someone else edited it) — the caller should refuse the undo.
 */
export function revertChanges(state: AppState, changes: RecordChange[]): AppState | null {
  const s = { ...state } as unknown as Record<string, unknown>;
  const byKey = new Map<string, RecordChange[]>();
  for (const c of changes) (byKey.get(c.key) ?? byKey.set(c.key, []).get(c.key)!).push(c);
  for (const [key, list] of byKey) {
    let arr = [...((s[key] as AnyRecord[]) ?? [])];
    for (const c of list) {
      const idx = arr.findIndex((r) => r.id === c.id);
      const current = idx >= 0 ? arr[idx] : null;
      if (!same(current, c.after)) return null; // conflict
    }
    for (const c of [...list].sort((x, y) => x.index - y.index)) {
      const idx = arr.findIndex((r) => r.id === c.id);
      if (c.before === null) {
        if (idx >= 0) arr.splice(idx, 1);
      } else if (idx >= 0) {
        arr[idx] = c.before;
      } else {
        arr.splice(Math.min(c.index, arr.length), 0, c.before);
      }
    }
    s[key] = arr;
  }
  return s as unknown as AppState;
}

/** The changes that undo `changes` (used to build the redo stack). */
export const invertChanges = (changes: RecordChange[]): RecordChange[] =>
  changes.map((c) => ({ ...c, before: c.after, after: c.before }));

/* ------------------------------------------------------------ sync patch */

export interface Patch {
  /** collection → records to insert/replace (with their index) and ids to drop */
  collections: Record<string, { upsert: { index: number; item: AnyRecord }[]; remove: ID[]; count: number }>;
  /** non-collection fields that changed */
  scalars: Record<string, unknown>;
}

export function diffPatch(before: AppState | null, after: AppState): Patch {
  const patch: Patch = { collections: {}, scalars: {} };
  const a = (before ?? {}) as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (SESSION_KEYS.has(key)) continue;
    const prev = a[key];
    const next = b[key];
    if (prev === next) continue;
    if (isRecordArray(next) && isRecordArray(prev)) {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const upsert: { index: number; item: AnyRecord }[] = [];
      const keep = new Set<ID>();
      next.forEach((r, index) => {
        keep.add(r.id);
        if (prevById.get(r.id) !== r) upsert.push({ index, item: r });
      });
      const remove = prev.filter((r) => !keep.has(r.id)).map((r) => r.id);
      if (upsert.length || remove.length) patch.collections[key] = { upsert, remove, count: next.length };
    } else {
      patch.scalars[key] = next;
    }
  }
  return patch;
}

export const isEmptyPatch = (p: Patch) =>
  Object.keys(p.collections).length === 0 && Object.keys(p.scalars).length === 0;

/**
 * Apply a server patch. Returns null when the result doesn't line up with the
 * server's counts (we missed a message) — the caller should re-sync.
 */
export function applyPatch(state: AppState, patch: Patch): AppState | null {
  const s = { ...state, ...patch.scalars } as unknown as Record<string, unknown>;
  for (const [key, change] of Object.entries(patch.collections)) {
    const drop = new Set(change.remove);
    const arr = ((s[key] as AnyRecord[]) ?? []).filter((r) => !drop.has(r.id));
    const pos = new Map(arr.map((r, i) => [r.id, i]));
    const inserts: { index: number; item: AnyRecord }[] = [];
    for (const u of change.upsert) {
      const i = pos.get(u.item.id);
      if (i !== undefined) arr[i] = u.item;
      else inserts.push(u);
    }
    for (const u of inserts.sort((x, y) => x.index - y.index)) {
      arr.splice(Math.min(u.index, arr.length), 0, u.item);
    }
    if (arr.length !== change.count) return null;
    s[key] = arr;
  }
  return s as unknown as AppState;
}
