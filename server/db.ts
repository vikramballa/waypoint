/**
 * SQLite persistence (node:sqlite, WAL).
 *
 * The workspace is stored one row per record — `records(collection, id, seq,
 * json)` — so an action only writes the handful of rows it changed, inside a
 * transaction. `seq` is a fractional sort key that reproduces each
 * collection's array order (prepends get min-1, appends max+1, inserts the
 * midpoint), so newest-first feeds stay newest-first across restarts.
 *
 * Auth data (password hashes, TOTP secrets, sessions) and uploaded files live
 * in their own tables and never enter AppState.
 */
import { createRequire } from "node:module";
import type { AppState } from "../src/core/types";

// Loaded at runtime: bundlers that predate node:sqlite would otherwise strip the
// "node:" prefix and fail to resolve it.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = InstanceType<typeof DatabaseSync>;
import type { RecordChange } from "../src/core/history";
import { SESSION_KEYS } from "../src/core/history";

type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;
  /** collection → id → seq, mirrored in memory to place inserts without queries */
  private seqs = new Map<string, Map<string, number>>();

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS records (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        seq REAL NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS records_order ON records (collection, seq);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        data BLOB NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /* --------------------------------------------------------- workspace */

  hasWorkspace(): boolean {
    const row = this.db.prepare("SELECT 1 AS ok FROM meta WHERE key = 'version'").get() as Row | undefined;
    return !!row;
  }

  /** Write a complete workspace (first boot, import, reset). */
  replaceWorkspace(state: AppState): void {
    this.tx(() => {
      this.db.exec("DELETE FROM records; DELETE FROM meta;");
      this.seqs.clear();
      const insert = this.db.prepare("INSERT INTO records (collection, id, seq, json) VALUES (?, ?, ?, ?)");
      for (const [key, value] of Object.entries(state)) {
        if (SESSION_KEYS.has(key)) continue;
        if (Array.isArray(value) && (value.length === 0 || typeof value[0] === "object")) {
          const seqs = new Map<string, number>();
          value.forEach((item: { id?: string }, i) => {
            if (!item || typeof item.id !== "string") return;
            insert.run(key, item.id, i, JSON.stringify(item));
            seqs.set(item.id, i);
          });
          this.seqs.set(key, seqs);
          this.setMeta(`collection:${key}`, true);
        } else {
          this.setMeta(key, value);
        }
      }
    });
  }

  loadWorkspace(base: AppState): AppState {
    const state = { ...base } as unknown as Record<string, unknown>;
    for (const row of this.db.prepare("SELECT key, json FROM meta").all() as Row[]) {
      const key = String(row.key);
      if (key.startsWith("collection:")) {
        state[key.slice("collection:".length)] = [];
      } else {
        state[key] = JSON.parse(String(row.json));
      }
    }
    this.seqs.clear();
    for (const row of this.db.prepare("SELECT collection, id, seq, json FROM records ORDER BY collection, seq").all() as Row[]) {
      const key = String(row.collection);
      const list = (state[key] as unknown[]) ?? (state[key] = []);
      (list as unknown[]).push(JSON.parse(String(row.json)));
      (this.seqs.get(key) ?? this.seqs.set(key, new Map()).get(key)!).set(String(row.id), Number(row.seq));
    }
    return state as unknown as AppState;
  }

  /** Persist an action's record changes (plus any changed top-level scalars). */
  applyChanges(changes: RecordChange[], after: AppState, scalars: Record<string, unknown> = {}): void {
    if (!changes.length && !Object.keys(scalars).length) return;
    const upsert = this.db.prepare(
      "INSERT INTO records (collection, id, seq, json) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json"
    );
    const del = this.db.prepare("DELETE FROM records WHERE collection = ? AND id = ?");
    const a = after as unknown as Record<string, { id: string }[]>;
    this.tx(() => {
      for (const c of changes) {
        if (!this.seqs.has(c.key)) {
          this.seqs.set(c.key, new Map());
          this.setMeta(`collection:${c.key}`, true); // a collection seen for the first time
        }
        const seqs = this.seqs.get(c.key)!;
        if (c.after === null) {
          del.run(c.key, c.id);
          seqs.delete(c.id);
          continue;
        }
        let seq = seqs.get(c.id);
        if (seq === undefined) {
          const arr = a[c.key] ?? [];
          const prev = arr[c.index - 1] ? seqs.get(arr[c.index - 1].id) : undefined;
          const next = arr[c.index + 1] ? seqs.get(arr[c.index + 1].id) : undefined;
          seq = prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1 : next !== undefined ? next - 1 : 0;
          seqs.set(c.id, seq);
        }
        upsert.run(c.key, c.id, seq, JSON.stringify(c.after));
      }
      for (const [k, v] of Object.entries(scalars)) this.setMeta(k, v);
    });
  }

  private setMeta(key: string, value: unknown) {
    this.db
      .prepare("INSERT INTO meta (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json")
      .run(key, JSON.stringify(value ?? null));
  }

  tx(fn: () => void) {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /* ------------------------------------------------------------- auth */

  credentialByEmail(email: string) {
    return this.db.prepare("SELECT * FROM credentials WHERE email = ?").get(email.toLowerCase()) as Row | undefined;
  }
  credentialByUser(userId: string) {
    return this.db.prepare("SELECT * FROM credentials WHERE user_id = ?").get(userId) as Row | undefined;
  }
  upsertCredential(userId: string, email: string, passwordHash: string) {
    this.db
      .prepare(
        "INSERT INTO credentials (user_id, email, password_hash) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash"
      )
      .run(userId, email.toLowerCase(), passwordHash);
  }
  setTotp(userId: string, secret: string | null, enabled: boolean) {
    this.db.prepare("UPDATE credentials SET totp_secret = ?, totp_enabled = ? WHERE user_id = ?").run(secret, enabled ? 1 : 0, userId);
  }

  createSession(idHash: string, userId: string, expiresAt: number, ip: string, ua: string) {
    const now = Date.now();
    this.db
      .prepare("INSERT INTO sessions (id_hash, user_id, created_at, last_seen, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(idHash, userId, now, now, expiresAt, ip, ua.slice(0, 200));
  }
  session(idHash: string) {
    return this.db.prepare("SELECT * FROM sessions WHERE id_hash = ?").get(idHash) as Row | undefined;
  }
  touchSession(idHash: string, lastSeen: number, expiresAt: number) {
    this.db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id_hash = ?").run(lastSeen, expiresAt, idHash);
  }
  deleteSession(idHash: string) {
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  }
  deleteSessionsForUser(userId: string, except?: string) {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(userId, except ?? "");
  }
  listSessions(userId?: string) {
    const rows = userId
      ? this.db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen DESC").all(userId)
      : this.db.prepare("SELECT * FROM sessions ORDER BY last_seen DESC").all();
    return rows as Row[];
  }
  purgeExpiredSessions(now = Date.now()) {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  }

  /* ------------------------------------------------------------ files */

  putFile(f: { id: string; taskId: string; name: string; mime: string; size: number; sha256: string; data: Uint8Array; createdBy: string }) {
    this.db
      .prepare("INSERT INTO files (id, task_id, name, mime, size, sha256, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(f.id, f.taskId, f.name, f.mime, f.size, f.sha256, f.data, f.createdBy, Date.now());
  }
  file(id: string) {
    return this.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as Row | undefined;
  }

  close() {
    this.db.close();
  }
}
