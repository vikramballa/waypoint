/**
 * Waypoint server: the authoritative workspace.
 *
 *   browser ──POST /api/actions──▶ authorize() as the session's identity
 *                                  ▼
 *                               reducer() (same code as the browser)
 *                                  ▼
 *                     SQLite: only the changed rows, one transaction
 *                                  ▼
 *   every tab ◀──SSE patch── scopeStateForViewer() per viewer, diffed
 *
 * Nothing the client sends is trusted: identity comes from an HttpOnly
 * session cookie, every action is re-authorized here, state-replacing and
 * clock-driven actions are refused from clients, and each viewer only ever
 * receives the slice of the workspace they may read.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createSeedState } from "../src/core/seed";
import { authorize, hydrate, reducer, type Action } from "../src/core/reducer";
import { scopeStateForViewer, can } from "../src/core/rbac";
import { diffPatch, isEmptyPatch, recordChanges, revertChanges, invertChanges, SESSION_KEYS, type RecordChange } from "../src/core/history";
import { ID_SEED_PATTERN, uid, withIdSeed } from "../src/core/utils";
import { TEXT_LIMITS, clampText } from "../src/core/validate";
import type { AppState, Attachment, AuditEntry, ID } from "../src/core/types";
import { Store } from "./db";
import {
  RateLimiter,
  hashPassword,
  newToken,
  newTotpSecret,
  otpauthUrl,
  sha256,
  sign,
  verifyPassword,
  verifySignature,
  verifyTotp,
} from "./auth";

export interface ServerOptions {
  dbFile: string;
  /** HMAC key for signed URLs and form tokens; random per boot if omitted */
  secret?: string;
  /** serve the built SPA from here (production) */
  staticDir?: string | null;
  /** password given to every seeded person on first boot */
  demoPassword?: string;
  /** set Secure cookies + HSTS (behind TLS) */
  https?: boolean;
  /** disable the agent/scheduler clocks (tests drive them manually) */
  clocks?: boolean;
  quiet?: boolean;
}

/* ----------------------------------------------------------- constants */

export const DEMO_PASSWORD = "waypoint-demo";
const COOKIE = "wp_sid";
const MAX_BODY = 512 * 1024;
const MAX_UPLOAD = 10 * 1024 * 1024;
const HISTORY = 40;

/** Never accepted from a client: state replacement, clocks, client-only UI. */
const CLIENT_FORBIDDEN = new Set<Action["type"]>([
  "state/load",
  "state/replace",
  "data/import",
  "rules/tick",
  "agent/runAdvance",
  "session/advance",
  "audit/denied",
  "ui/patch",
  "view/visit",
  "chat/selectThread",
]);
const NOT_UNDOABLE = new Set<Action["type"]>(["impersonate", "notification/read", "notification/readAll", "chat/send", "chat/newThread"]);

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

/* --------------------------------------------------------------- types */

interface LiveSession {
  idHash: string;
  userId: ID;
  viewAs: { userId: ID; expiresAt: string; reason: string } | null;
  undo: RecordChange[][];
  redo: RecordChange[][];
}

interface Stream {
  res: ServerResponse;
  session: LiveSession;
  clientId: string;
  lastSent: AppState | null;
  presence: { taskId: ID | null; projectId: ID | null; at: number } | null;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/* ================================================================= app */

export function createApp(opts: ServerOptions) {
  const store = new Store(opts.dbFile);
  const secret = opts.secret ?? newToken(32);
  const demoPassword = opts.demoPassword ?? DEMO_PASSWORD;
  const log = (...a: unknown[]) => {
    if (!opts.quiet) console.log("[waypoint]", ...a);
  };

  /* -------------------------------------------------------- workspace */
  let ws: AppState;
  if (store.hasWorkspace()) {
    ws = hydrate(JSON.stringify(store.loadWorkspace(createSeedState())));
  } else {
    ws = createSeedState();
    store.replaceWorkspace(ws);
  }
  ensureCredentials();

  function ownerId(): ID {
    return ws.users.find((u) => u.workspaceRole === "owner")?.id ?? ws.users[0].id;
  }

  /** Give every human without a login the demo password (first boot / reset). */
  function ensureCredentials() {
    for (const u of ws.users) {
      if (u.isAgent) continue;
      if (!store.credentialByUser(u.id)) store.upsertCredential(u.id, u.email, hashPassword(demoPassword));
    }
  }

  const live = new Map<string, LiveSession>();
  const streams = new Set<Stream>();
  const usedSeeds = new Set<string>();

  /* --------------------------------------------------------- identity */
  function ctxFor(sess: LiveSession | null): AppState {
    if (!sess) return { ...ws, currentUserId: ownerId(), impersonatorId: null };
    return {
      ...ws,
      currentUserId: sess.viewAs?.userId ?? sess.userId,
      impersonatorId: sess.viewAs ? sess.userId : null,
      impersonationExpiresAt: sess.viewAs?.expiresAt ?? null,
      impersonationReason: sess.viewAs?.reason ?? null,
    };
  }

  function viewFor(sess: LiveSession): AppState {
    return scopeStateForViewer(ctxFor(sess));
  }

  /** Strip per-session fields before storing state as the shared workspace. */
  function shared(next: AppState): AppState {
    return {
      ...next,
      currentUserId: ws.currentUserId,
      impersonatorId: null,
      impersonationExpiresAt: null,
      impersonationReason: null,
      ui: ws.ui,
      recentlyViewed: ws.recentlyViewed,
      activeThreadId: ws.activeThreadId,
    };
  }

  /* ----------------------------------------------------------- commit */
  function commit(before: AppState, after: AppState): RecordChange[] {
    const changes = recordChanges(before, after);
    const scalars: Record<string, unknown> = {};
    const a = before as unknown as Record<string, unknown>;
    const b = after as unknown as Record<string, unknown>;
    for (const k of Object.keys(b)) {
      if (SESSION_KEYS.has(k) || Array.isArray(b[k])) continue;
      if (a[k] !== b[k]) scalars[k] = b[k];
    }
    store.applyChanges(changes, after, scalars);
    ws = shared(after);
    return changes;
  }

  function audit(actorId: ID, action: string, detail: string, outcome: AuditEntry["outcome"] = "allowed", viaId: ID | null = null) {
    const before = ws;
    const entry: AuditEntry = { id: uid("audit"), at: new Date().toISOString(), actorId, viaId, action, outcome, detail };
    commit(before, { ...before, auditLog: [entry, ...before.auditLog].slice(0, 1000) });
  }

  /** Run an action as a session (or as the system when sess is null). */
  function dispatch(
    sess: LiveSession | null,
    action: Action,
    meta: { idSeed?: string; clientId?: string; seq?: number } = {}
  ): { ok: boolean; error?: string } {
    endExpiredViewAs(sess);
    const before = ctxFor(sess);
    if (!authorize(before, action)) {
      const denied = reducer(before, { type: "audit/denied", attempted: action.type });
      commit(before, denied);
      broadcast(meta.clientId, meta.seq);
      return { ok: false, error: "forbidden" };
    }
    const after = withIdSeed(meta.idSeed, () => reducer(before, action));
    if (after === before) {
      broadcast(meta.clientId, meta.seq);
      return { ok: true };
    }
    const identityChanged = action.type === "impersonate" && sess;
    if (identityChanged && sess) {
      sess.viewAs = after.impersonatorId
        ? { userId: after.currentUserId, expiresAt: after.impersonationExpiresAt ?? "", reason: after.impersonationReason ?? "" }
        : null;
      // one identity never undoes another's work
      sess.undo = [];
      sess.redo = [];
    }
    const changes = commit(before, after);
    if (sess && !NOT_UNDOABLE.has(action.type)) {
      const undoable = changes.filter((c) => c.key !== "auditLog");
      if (undoable.length) {
        sess.undo = [...sess.undo.slice(-(HISTORY - 1)), undoable];
        sess.redo = [];
      }
    }
    if (identityChanged && sess) resnapshot(sess);
    broadcast(meta.clientId, meta.seq);
    return { ok: true };
  }

  function endExpiredViewAs(sess: LiveSession | null) {
    if (!sess?.viewAs) return;
    if (new Date(sess.viewAs.expiresAt).getTime() > Date.now()) return;
    const viewed = ws.users.find((u) => u.id === sess.viewAs?.userId)?.name ?? "someone";
    sess.viewAs = null;
    sess.undo = [];
    sess.redo = [];
    audit(sess.userId, "impersonate", `“View as ${viewed}” ended automatically (time limit)`);
    resnapshot(sess);
  }

  /** Undo/redo the session's own last change, refusing on conflicts. */
  function history(sess: LiveSession, kind: "undo" | "redo"): { status: number; error?: string } {
    const stack = kind === "undo" ? sess.undo : sess.redo;
    const entry = stack[stack.length - 1];
    if (!entry) return { status: 404, error: "nothing_to_" + kind };
    const before = ctxFor(sess);
    // the user must still be allowed to edit what they're restoring
    for (const c of entry) {
      const rec = (c.before ?? c.after) as { projectId?: ID | null } | null;
      if (c.key === "users" || c.key === "invites" || c.key === "security") {
        if (!can(before, "workspace:admin")) return { status: 403, error: "forbidden" };
      } else if (rec && "projectId" in rec && rec.projectId && !can(before, "task:edit", { projectId: rec.projectId })) {
        return { status: 403, error: "forbidden" };
      }
    }
    const reverted = revertChanges(before, entry);
    if (!reverted) return { status: 409, error: "conflict" };
    stack.pop();
    commit(before, reverted);
    (kind === "undo" ? sess.redo : sess.undo).push(invertChanges(entry));
    broadcast();
    return { status: 200 };
  }

  /* -------------------------------------------------------- broadcast */
  function send(res: ServerResponse, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function snapshotPayload(sess: LiveSession, view: AppState) {
    return { state: view, me: sessionInfo(sess) };
  }

  function resnapshot(sess: LiveSession) {
    for (const st of streams) {
      if (st.session !== sess) continue;
      const view = viewFor(sess);
      st.lastSent = view;
      send(st.res, "snapshot", snapshotPayload(sess, view));
    }
  }

  function broadcast(ackClient?: string, ackSeq?: number) {
    const cache = new Map<LiveSession, AppState>();
    for (const st of streams) {
      const view = cache.get(st.session) ?? viewFor(st.session);
      cache.set(st.session, view);
      const patch = diffPatch(st.lastSent, view);
      const ack = ackClient && st.clientId === ackClient ? ackSeq : undefined;
      if (isEmptyPatch(patch) && ack === undefined) continue;
      st.lastSent = view;
      send(st.res, "patch", { patch, ack });
    }
  }

  function broadcastPresence() {
    for (const st of streams) {
      const view = st.lastSent;
      if (!view) continue;
      const visibleTasks = new Set(view.tasks.map((t) => t.id));
      const visibleProjects = new Set(view.projects.map((p) => p.id));
      const seen = new Set<string>();
      const entries: { userId: ID; taskId: ID | null; projectId: ID | null }[] = [];
      for (const other of streams) {
        if (other === st || !other.presence) continue;
        const userId = other.session.viewAs?.userId ?? other.session.userId;
        const p = other.presence;
        const taskId = p.taskId && visibleTasks.has(p.taskId) ? p.taskId : null;
        const projectId = p.projectId && visibleProjects.has(p.projectId) ? p.projectId : null;
        if (!taskId && !projectId) continue;
        const key = `${userId}:${taskId}:${projectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ userId, taskId, projectId });
      }
      send(st.res, "presence", { entries });
    }
  }

  /* --------------------------------------------------------- sessions */
  function sessionInfo(sess: LiveSession) {
    const user = ws.users.find((u) => u.id === sess.userId);
    const cred = store.credentialByUser(sess.userId);
    return {
      mode: "server" as const,
      authenticated: true,
      userId: sess.userId,
      email: user?.email ?? "",
      name: user?.name ?? "",
      viewAs: sess.viewAs,
      twoFactorEnabled: !!cred?.totp_enabled,
      twoFactorRequired: !!ws.security?.requireTwoFactor,
      mustEnroll: !!ws.security?.requireTwoFactor && !cred?.totp_enabled,
    };
  }

  function sessionFrom(req: IncomingMessage): LiveSession | null {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const idHash = sha256(token);
    const row = store.session(idHash);
    const now = Date.now();
    if (!row || Number(row.expires_at) < now) {
      if (row) store.deleteSession(idHash);
      live.delete(idHash);
      return null;
    }
    const user = ws.users.find((u) => u.id === row.user_id && !u.isAgent);
    if (!user) return null;
    // sliding idle expiry, refreshed at most once a minute
    if (now - Number(row.last_seen) > 60_000) {
      store.touchSession(idHash, now, now + (ws.security?.sessionHours ?? 12) * 3_600_000);
    }
    let sess = live.get(idHash);
    if (!sess) {
      sess = { idHash, userId: user.id, viewAs: null, undo: [], redo: [] };
      live.set(idHash, sess);
    }
    return sess;
  }

  function requireSession(req: IncomingMessage, opts2: { allowEnrollment?: boolean } = {}): LiveSession {
    const sess = sessionFrom(req);
    if (!sess) throw new HttpError(401, "unauthenticated");
    if (!opts2.allowEnrollment && sessionInfo(sess).mustEnroll) {
      throw new HttpError(403, "two_factor_enrollment_required");
    }
    return sess;
  }

  function endSession(idHash: string) {
    store.deleteSession(idHash);
    const sess = live.get(idHash);
    live.delete(idHash);
    for (const st of [...streams]) {
      if (st.session === sess || st.session.idHash === idHash) {
        send(st.res, "logout", {});
        st.res.end();
        streams.delete(st);
      }
    }
  }

  function startSession(res: ServerResponse, req: IncomingMessage, userId: ID) {
    const old = cookies(req)[COOKIE];
    if (old) endSession(sha256(old)); // no session fixation
    const token = newToken();
    const hours = ws.security?.sessionHours ?? 12;
    store.createSession(sha256(token), userId, Date.now() + hours * 3_600_000, clientIp(req), String(req.headers["user-agent"] ?? ""));
    setCookie(res, COOKIE, token, hours * 3600);
  }

  function setCookie(res: ServerResponse, name: string, value: string, maxAge: number) {
    const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
    if (opts.https) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  /* ------------------------------------------------------ rate limits */
  const limits = {
    loginIp: new RateLimiter(30, 10 * 60_000),
    loginAccount: new RateLimiter(8, 10 * 60_000),
    actions: new RateLimiter(150, 10_000),
    uploads: new RateLimiter(20, 60_000),
    publicForms: new RateLimiter(5, 60 * 60_000),
    invites: new RateLimiter(10, 10 * 60_000),
  };
  const DUMMY_HASH = hashPassword(newToken(8));

  /* ----------------------------------------------------------- routes */
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    securityHeaders(res, path.startsWith("/api/"));

    if (path.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") csrfCheck(req);

      if (path === "/api/health") return json(res, 200, { ok: true, mode: "server" });

      /* --------------------------------------------------- auth */
      if (path === "/api/login" && method === "POST") {
        const body = await readJson(req);
        const email = String(body.email ?? "").trim().toLowerCase().slice(0, TEXT_LIMITS.email);
        const password = String(body.password ?? "").slice(0, 200);
        const ip = clientIp(req);
        if (!limits.loginIp.take(ip) || !limits.loginAccount.take(`${ip}|${email}`)) {
          throw new HttpError(429, "too_many_attempts", "Too many sign-in attempts. Wait a few minutes and try again.");
        }
        const cred = store.credentialByEmail(email);
        const ok = verifyPassword(password, cred ? String(cred.password_hash) : DUMMY_HASH) && !!cred;
        if (!ok || !cred) {
          const known = ws.users.find((u) => u.email.toLowerCase() === email);
          audit(known?.id ?? ownerId(), "auth/login", `Failed sign-in for ${email || "an empty address"}`, "denied");
          throw new HttpError(401, "invalid_credentials", "That email and password don't match.");
        }
        if (cred.totp_enabled) {
          if (!body.code) return json(res, 401, { error: "two_factor_required" });
          if (!verifyTotp(String(cred.totp_secret), String(body.code))) {
            audit(String(cred.user_id), "auth/login", "Failed two-factor code", "denied");
            throw new HttpError(401, "invalid_code", "That code didn't work. Codes change every 30 seconds.");
          }
        }
        limits.loginAccount.reset(`${ip}|${email}`);
        startSession(res, req, String(cred.user_id));
        audit(String(cred.user_id), "auth/login", "Signed in");
        const sess: LiveSession = { idHash: "", userId: String(cred.user_id), viewAs: null, undo: [], redo: [] };
        return json(res, 200, { ok: true, me: sessionInfo(sess) });
      }

      if (path === "/api/logout" && method === "POST") {
        const token = cookies(req)[COOKIE];
        if (token) endSession(sha256(token));
        setCookie(res, COOKIE, "", 0);
        return json(res, 200, { ok: true });
      }

      if (path === "/api/session" && method === "GET") {
        const sess = sessionFrom(req);
        if (!sess) return json(res, 200, { mode: "server", authenticated: false });
        return json(res, 200, sessionInfo(sess));
      }

      if (path === "/api/invites/accept" && method === "POST") {
        if (!limits.invites.take(clientIp(req))) throw new HttpError(429, "too_many_attempts");
        const body = await readJson(req);
        const invite = ws.invites.find((i) => i.id === String(body.inviteId ?? ""));
        const password = String(body.password ?? "");
        if (!invite || invite.status !== "sent") throw new HttpError(404, "invite_not_found", "This invitation is no longer valid.");
        if (password.length < 10) throw new HttpError(400, "weak_password", "Use at least 10 characters.");
        const r = dispatch(null, { type: "invite/accept", id: invite.id });
        const user = ws.users.find((u) => u.email.toLowerCase() === invite.email.toLowerCase());
        if (!r.ok || !user) throw new HttpError(400, "invite_failed");
        store.upsertCredential(user.id, user.email, hashPassword(password));
        startSession(res, req, user.id);
        audit(user.id, "invite/accept", `${user.email} joined from an invitation`);
        return json(res, 200, { ok: true });
      }

      /* ------------------------------------------- two-factor */
      if (path === "/api/2fa/setup" && method === "POST") {
        const sess = requireSession(req, { allowEnrollment: true });
        const cred = store.credentialByUser(sess.userId);
        if (!cred) throw new HttpError(400, "no_credentials");
        if (cred.totp_enabled) throw new HttpError(409, "already_enabled");
        const secretB32 = newTotpSecret();
        store.setTotp(sess.userId, secretB32, false);
        return json(res, 200, { secret: secretB32, otpauth: otpauthUrl(secretB32, String(cred.email)) });
      }
      if (path === "/api/2fa/enable" && method === "POST") {
        const sess = requireSession(req, { allowEnrollment: true });
        const body = await readJson(req);
        const cred = store.credentialByUser(sess.userId);
        if (!cred?.totp_secret) throw new HttpError(400, "setup_first");
        if (!verifyTotp(String(cred.totp_secret), String(body.code ?? ""))) throw new HttpError(400, "invalid_code", "That code didn't work.");
        store.setTotp(sess.userId, String(cred.totp_secret), true);
        audit(sess.userId, "auth/2fa", "Turned on two-factor sign-in");
        return json(res, 200, sessionInfo(sess));
      }
      if (path === "/api/2fa/disable" && method === "POST") {
        const sess = requireSession(req, { allowEnrollment: true });
        const body = await readJson(req);
        const cred = store.credentialByUser(sess.userId);
        if (!cred?.totp_enabled) throw new HttpError(400, "not_enabled");
        if (ws.security?.requireTwoFactor) throw new HttpError(403, "required_by_policy", "Your workspace requires two-factor sign-in.");
        if (!verifyTotp(String(cred.totp_secret), String(body.code ?? ""))) throw new HttpError(400, "invalid_code");
        store.setTotp(sess.userId, null, false);
        audit(sess.userId, "auth/2fa", "Turned off two-factor sign-in");
        return json(res, 200, sessionInfo(sess));
      }
      if (path === "/api/password" && method === "POST") {
        const sess = requireSession(req, { allowEnrollment: true });
        const body = await readJson(req);
        const cred = store.credentialByUser(sess.userId);
        if (!cred || !verifyPassword(String(body.current ?? ""), String(cred.password_hash))) {
          throw new HttpError(401, "invalid_credentials", "Your current password is wrong.");
        }
        const next = String(body.next ?? "");
        if (next.length < 10) throw new HttpError(400, "weak_password", "Use at least 10 characters.");
        store.upsertCredential(sess.userId, String(cred.email), hashPassword(next));
        store.deleteSessionsForUser(sess.userId, sess.idHash); // sign out everywhere else
        audit(sess.userId, "auth/password", "Changed password and signed out other sessions");
        return json(res, 200, { ok: true });
      }

      /* ------------------------------------------- sessions (IT) */
      if (path === "/api/sessions" && method === "GET") {
        const sess = requireSession(req, { allowEnrollment: true });
        const admin = can(ctxFor({ ...sess, viewAs: null }), "workspace:admin");
        const rows = store.listSessions(admin && url.searchParams.get("all") ? undefined : sess.userId);
        return json(res, 200, {
          sessions: rows.map((r) => ({
            id: String(r.id_hash).slice(0, 16),
            userId: r.user_id,
            createdAt: r.created_at,
            lastSeen: r.last_seen,
            expiresAt: r.expires_at,
            ip: r.ip,
            userAgent: r.user_agent,
            current: r.id_hash === sess.idHash,
            live: [...streams].some((st) => st.session.idHash === r.id_hash),
          })),
        });
      }
      const revoke = path.match(/^\/api\/sessions\/([a-f0-9]{16})$/);
      if (revoke && method === "DELETE") {
        const sess = requireSession(req, { allowEnrollment: true });
        const admin = can(ctxFor({ ...sess, viewAs: null }), "workspace:admin");
        const row = store.listSessions().find((r) => String(r.id_hash).startsWith(revoke[1]));
        if (!row) throw new HttpError(404, "not_found");
        if (row.user_id !== sess.userId && !admin) throw new HttpError(403, "forbidden");
        endSession(String(row.id_hash));
        const who = ws.users.find((u) => u.id === row.user_id)?.name ?? "someone";
        audit(sess.userId, "auth/revoke", `Signed out a session for ${who}`);
        return json(res, 200, { ok: true });
      }

      /* -------------------------------------------- live sync */
      if (path === "/api/stream" && method === "GET") {
        const sess = requireSession(req);
        const clientId = String(url.searchParams.get("client") ?? newToken(8)).slice(0, 40);
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 2000\n\n");
        const stream: Stream = { res, session: sess, clientId, lastSent: null, presence: null };
        streams.add(stream);
        endExpiredViewAs(sess);
        const view = viewFor(sess);
        stream.lastSent = view;
        send(res, "snapshot", snapshotPayload(sess, view));
        const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
        req.on("close", () => {
          clearInterval(heartbeat);
          streams.delete(stream);
          if (stream.presence) broadcastPresence();
        });
        return;
      }

      if (path === "/api/actions" && method === "POST") {
        const sess = requireSession(req);
        if (!limits.actions.take(sess.idHash)) throw new HttpError(429, "slow_down");
        const body = await readJson(req);
        const action = body.action as Action | undefined;
        if (!action || typeof action !== "object" || typeof action.type !== "string") throw new HttpError(400, "bad_action");
        if (CLIENT_FORBIDDEN.has(action.type)) throw new HttpError(403, "not_allowed_from_client");
        const idSeed = typeof body.idSeed === "string" ? body.idSeed : undefined;
        if (idSeed) {
          if (!ID_SEED_PATTERN.test(idSeed) || usedSeeds.has(idSeed)) throw new HttpError(400, "bad_id_seed");
          usedSeeds.add(idSeed);
          if (usedSeeds.size > 50_000) usedSeeds.clear();
        }
        const result = dispatch(sess, action, {
          idSeed,
          clientId: typeof body.clientId === "string" ? body.clientId : undefined,
          seq: typeof body.seq === "number" ? body.seq : undefined,
        });
        return json(res, result.ok ? 200 : 403, result);
      }

      if ((path === "/api/undo" || path === "/api/redo") && method === "POST") {
        const sess = requireSession(req);
        const r = history(sess, path === "/api/undo" ? "undo" : "redo");
        return json(res, r.status, r);
      }

      if (path === "/api/presence" && method === "POST") {
        const sess = requireSession(req);
        const body = await readJson(req);
        const clientId = String(body.clientId ?? "");
        for (const st of streams) {
          if (st.session === sess && st.clientId === clientId) {
            st.presence = {
              taskId: typeof body.taskId === "string" ? body.taskId : null,
              projectId: typeof body.projectId === "string" ? body.projectId : null,
              at: Date.now(),
            };
          }
        }
        broadcastPresence();
        return json(res, 200, { ok: true });
      }

      /* -------------------------------------------- backups */
      if (path === "/api/export" && method === "GET") {
        const sess = requireSession(req);
        const ctx = ctxFor({ ...sess, viewAs: null });
        if (!can(ctx, "workspace:admin")) throw new HttpError(403, "forbidden");
        audit(sess.userId, "data/export", "Downloaded a full workspace backup");
        res.setHeader("Content-Disposition", `attachment; filename="waypoint-backup-${new Date().toISOString().slice(0, 10)}.json"`);
        return json(res, 200, { ...ws, ui: undefined, recentlyViewed: undefined });
      }
      if (path === "/api/import" && method === "POST") {
        const sess = requireSession(req);
        const ctx = ctxFor({ ...sess, viewAs: null });
        if (!can(ctx, "billing:manage")) throw new HttpError(403, "forbidden");
        const raw = (await readBody(req, 20 * 1024 * 1024)).toString("utf8");
        let incoming: AppState;
        try {
          incoming = hydrate(raw);
        } catch {
          throw new HttpError(400, "invalid_backup");
        }
        const me = incoming.users.find((u) => u.id === sess.userId);
        if (!me || me.workspaceRole !== "owner") {
          throw new HttpError(400, "would_lock_out", "The backup must keep you as a workspace owner.");
        }
        replaceAll({ ...incoming, auditLog: ws.auditLog });
        audit(sess.userId, "data/import", "Imported a workspace backup, replacing all data");
        return json(res, 200, { ok: true });
      }
      if (path === "/api/reset" && method === "POST") {
        const sess = requireSession(req);
        if (!can(ctxFor({ ...sess, viewAs: null }), "billing:manage")) throw new HttpError(403, "forbidden");
        replaceAll(createSeedState());
        audit(sess.userId, "data/reset", "Reset the workspace to demo data");
        return json(res, 200, { ok: true });
      }

      /* -------------------------------------------- files */
      if (path === "/api/files" && method === "POST") {
        const sess = requireSession(req);
        if (!limits.uploads.take(sess.idHash)) throw new HttpError(429, "slow_down");
        const taskId = String(url.searchParams.get("taskId") ?? "");
        const name = clampText(String(url.searchParams.get("name") ?? "file"), 180).replace(/[\\/\r\n"]/g, "_");
        const ctx = ctxFor(sess);
        const task = ctx.tasks.find((t) => t.id === taskId);
        if (!task || !can(ctx, "task:edit", { projectId: task.projectId })) throw new HttpError(403, "forbidden");
        const data = await readBody(req, MAX_UPLOAD);
        if (!data.length) throw new HttpError(400, "empty_file");
        const mime = sniff(data, name);
        if (!mime) throw new HttpError(415, "unsupported_type", "Only images, PDFs, text and Office documents can be attached.");
        if (data.includes(Buffer.from(EICAR))) {
          audit(sess.viewAs?.userId ?? sess.userId, "file/blocked", `Blocked an upload that matched a malware signature (“${name}”)`, "denied", sess.viewAs ? sess.userId : null);
          throw new HttpError(422, "malware_detected", "This file was blocked by the malware scanner.");
        }
        const fileId = uid("file");
        store.putFile({ id: fileId, taskId, name, mime, size: data.length, sha256: sha256(data), data, createdBy: sess.userId });
        const attachment: Attachment = {
          id: uid("att"),
          name,
          kind: mime.startsWith("image/") ? "image" : "file",
          meta: `${mime.split("/")[1]?.split(";")[0]?.toUpperCase() ?? "FILE"} · ${formatBytes(data.length)}`,
          addedById: ctx.currentUserId,
          createdAt: new Date().toISOString(),
          fileId,
          size: data.length,
          mime,
        };
        const r = dispatch(sess, { type: "task/update", id: taskId, patch: { attachments: [...task.attachments, attachment] } });
        if (!r.ok) throw new HttpError(403, "forbidden");
        return json(res, 201, { ok: true, fileId, attachmentId: attachment.id });
      }
      const fileUrl = path.match(/^\/api\/files\/([\w-]+)\/url$/);
      if (fileUrl && method === "GET") {
        const sess = requireSession(req);
        const file = store.file(fileUrl[1]);
        if (!file || !viewFor(sess).tasks.some((t) => t.id === file.task_id)) throw new HttpError(404, "not_found");
        const exp = Date.now() + 5 * 60_000;
        const sig = sign(secret, `${file.id}.${exp}`);
        return json(res, 200, { url: `/api/files/${file.id}?exp=${exp}&sig=${sig}`, expiresAt: exp });
      }
      const fileGet = path.match(/^\/api\/files\/([\w-]+)$/);
      if (fileGet && method === "GET") {
        const exp = Number(url.searchParams.get("exp") ?? 0);
        const sig = String(url.searchParams.get("sig") ?? "");
        if (!exp || exp < Date.now() || !verifySignature(secret, `${fileGet[1]}.${exp}`, sig)) {
          throw new HttpError(403, "link_expired", "This download link has expired.");
        }
        const sess = requireSession(req);
        const file = store.file(fileGet[1]);
        if (!file || !viewFor(sess).tasks.some((t) => t.id === file.task_id)) throw new HttpError(404, "not_found");
        const mime = String(file.mime);
        const inline = mime.startsWith("image/") || mime === "application/pdf";
        res.writeHead(200, {
          "Content-Type": inline ? mime : "application/octet-stream",
          "Content-Length": String(file.size),
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${String(file.name)}"`,
          "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          "Cache-Control": "private, max-age=300",
        });
        return res.end(Buffer.from(file.data as Uint8Array));
      }

      /* -------------------------------------------- public forms */
      const pub = path.match(/^\/api\/public\/forms\/([\w-]+)$/);
      if (pub) {
        const form = ws.forms.find((f) => f.id === pub[1]);
        if (!form?.public) throw new HttpError(404, "not_found", "This form isn't accepting responses.");
        if (method === "GET") {
          const issued = Date.now();
          return json(res, 200, {
            id: form.id,
            title: form.title,
            description: form.description,
            // anonymous people never see the workspace directory or choose assignees
            fields: form.fields.filter((f) => f.type !== "people" && f.mapsTo !== "assigneeId").map((f) => ({ ...f })),
            token: `${issued}.${sign(secret, `${form.id}.${issued}`)}`,
          });
        }
        if (method === "POST") {
          const ip = clientIp(req);
          if (!limits.publicForms.take(ip)) throw new HttpError(429, "too_many_submissions", "Too many submissions from your network. Try again later.");
          const body = await readJson(req);
          if (body.website) return json(res, 201, { ok: true }); // honeypot: pretend success, store nothing
          const [issuedStr, sig] = String(body.token ?? "").split(".");
          const issued = Number(issuedStr);
          const age = Date.now() - issued;
          if (!issued || !sig || !verifySignature(secret, `${form.id}.${issued}`, sig) || age < 2500 || age > 2 * 3_600_000) {
            throw new HttpError(400, "invalid_token", "Please reload the form and try again.");
          }
          const allowed = new Set(form.fields.filter((f) => f.type !== "people" && f.mapsTo !== "assigneeId").map((f) => f.id));
          const values: Record<string, string | string[] | boolean> = {};
          for (const [k, v] of Object.entries((body.values ?? {}) as Record<string, unknown>)) {
            if (!allowed.has(k)) continue;
            if (typeof v === "string") values[k] = clampText(v, TEXT_LIMITS.body);
            else if (typeof v === "boolean") values[k] = v;
            else if (Array.isArray(v)) values[k] = v.slice(0, 20).map((x) => clampText(x, TEXT_LIMITS.name));
          }
          const project = ws.projects.find((p) => p.id === form.projectId);
          const owner = project?.ownerId ?? ownerId();
          const sess: LiveSession = { idHash: "public", userId: owner, viewAs: null, undo: [], redo: [] };
          const r = dispatch(sess, { type: "form/submit", projectId: form.projectId, values, viaPublicLink: true });
          if (!r.ok) throw new HttpError(400, "rejected");
          return json(res, 201, { ok: true });
        }
      }

      throw new HttpError(404, "not_found");
    }

    /* ------------------------------------------------------- static */
    if (opts.staticDir) return serveStatic(req, res, opts.staticDir, path);
    throw new HttpError(404, "not_found");
  }

  function replaceAll(next: AppState) {
    ws = { ...next, currentUserId: ws.currentUserId };
    store.replaceWorkspace(ws);
    ensureCredentials();
    for (const sess of live.values()) {
      sess.undo = [];
      sess.redo = [];
      sess.viewAs = null;
      resnapshot(sess);
    }
  }

  /* ----------------------------------------------------------- clocks */
  const timers: NodeJS.Timeout[] = [];
  function tickAgents() {
    const run = ws.agentRuns.find((r) => {
      if (r.status !== "running") return false;
      if (!r.taskId) return true;
      const t = ws.tasks.find((x) => x.id === r.taskId);
      return !!t && t.assigneeId === r.teammateId;
    });
    if (run) dispatch(null, { type: "agent/runAdvance", runId: run.id });
  }
  function tickSessions() {
    const s = ws.agentSessions.find((x) => x.status === "running");
    if (s) dispatch(null, { type: "session/advance", id: s.id });
  }
  function tickRules() {
    dispatch(null, { type: "rules/tick", now: new Date().toISOString() });
  }
  function tickExpiry() {
    for (const sess of live.values()) endExpiredViewAs(sess);
    store.purgeExpiredSessions();
  }
  if (opts.clocks !== false) {
    timers.push(setInterval(tickAgents, 2200), setInterval(tickSessions, 2600), setInterval(tickRules, 30_000), setInterval(tickExpiry, 10_000));
  }

  /* ----------------------------------------------------------- server */
  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: err.code, message: err.message });
      log("error", err);
      json(res, 500, { error: "internal", message: "Something went wrong on the server." });
    });
  });

  return {
    server,
    store,
    get workspace() {
      return ws;
    },
    tick: { agents: tickAgents, sessions: tickSessions, rules: tickRules, expiry: tickExpiry },
    async close() {
      timers.forEach(clearInterval);
      for (const st of streams) st.res.end();
      streams.clear();
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}

/* ============================================================ helpers */

function securityHeaders(res: ServerResponse, api: boolean) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (api) res.setHeader("Cache-Control", "no-store");
}

/**
 * CSRF: mutating requests must carry our custom header (impossible
 * cross-site without a CORS preflight we never grant) and, when the browser
 * sends them, a same-origin Origin / Sec-Fetch-Site. SameSite=Strict cookies
 * are the third layer.
 */
function csrfCheck(req: IncomingMessage) {
  if (req.headers["x-requested-with"] !== "waypoint") throw new HttpError(403, "csrf");
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "csrf");
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    try {
      if (new URL(origin).host !== host) throw new HttpError(403, "csrf");
    } catch {
      throw new HttpError(403, "csrf");
    }
  }
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "too_large", "That's too large to upload."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readBody(req)).toString("utf8");
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

/** Identify uploads by content, not by the extension or the client's claim. */
export function sniff(data: Buffer, name: string): string | null {
  const head = data.subarray(0, 16);
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && data.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  const ext = extname(name).toLowerCase();
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    const office: Record<string, string> = {
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".zip": "application/zip",
    };
    return office[ext] ?? null;
  }
  // plain text: valid UTF-8, no NUL bytes, and nothing a browser would render as markup/script
  const sample = data.subarray(0, 8192);
  if (sample.includes(0)) return null;
  const text = sample.toString("utf8");
  if (text.includes("�")) return null;
  if (/<\s*(script|html|svg|iframe|object)\b/i.test(text)) return null;
  if ([".txt", ".md", ".csv", ".log", ".json"].includes(ext) || ext === "") return "text/plain; charset=utf-8";
  return null;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, dir: string, path: string) {
  const root = resolve(dir);
  const target = normalize(join(root, decodeURIComponent(path)));
  if (!target.startsWith(root)) throw new HttpError(403, "forbidden"); // path traversal
  let file = target;
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  const ext = extname(file);
  const body = readFileSync(file);
  const headers: Record<string, string> = { "Content-Type": MIME[ext] ?? "application/octet-stream" };
  if (ext === ".html") {
    headers["Content-Security-Policy"] = CSP;
    headers["Cache-Control"] = "no-cache";
  } else if (path.startsWith("/assets/")) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else {
    headers["Cache-Control"] = "no-cache";
  }
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}
