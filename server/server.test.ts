/**
 * End-to-end tests of the HTTP server: real sockets, real SQLite, real SSE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp, DEMO_PASSWORD, sniff } from "./app";
import { totpAt } from "./auth";
import type { AppState, Task } from "../src/core/types";
import type { Patch } from "../src/core/history";
import { applyPatch } from "../src/core/history";
import { newIdSeed } from "../src/core/utils";

const MAYA = "maya.chen@northwind.co";
const PRIYA = "priya.nair@northwind.co";
const JORDAN = "jordan.blake@northwind.co";
const LUCAS = "lucas@agency.partner";

let dir: string;
let app: ReturnType<typeof createApp>;
let base: string;

async function boot(dbName = "w.db") {
  app = createApp({ dbFile: join(dir, dbName), secret: "test-secret", clocks: false, quiet: true });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

class Client {
  cookie = "";
  clientId = Math.random().toString(36).slice(2);
  seq = 0;
  async req(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers: Record<string, string> = { "x-requested-with": "waypoint", ...(init.headers as Record<string, string>) };
    if (this.cookie) headers.cookie = this.cookie;
    let body = init.body;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const res = await fetch(base + path, { ...init, headers, body });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return res;
  }
  async login(email: string, password = DEMO_PASSWORD, code?: string) {
    return this.req("/api/login", { method: "POST", json: { email, password, code } });
  }
  act(action: unknown) {
    return this.req("/api/actions", { method: "POST", json: { action, seq: ++this.seq, clientId: this.clientId, idSeed: newIdSeed() } });
  }
  /** open the live stream and keep a reconstructed copy of what this viewer sees */
  async stream() {
    const res = await fetch(`${base}/api/stream?client=${this.clientId}`, { headers: { cookie: this.cookie } });
    const events: { event: string; data: any }[] = [];
    let view: AppState | null = null;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (!ev || !data) continue;
          const parsed = JSON.parse(data);
          events.push({ event: ev, data: parsed });
          if (ev === "snapshot") view = parsed.state;
          if (ev === "patch" && view) view = applyPatch(view, parsed.patch as Patch) ?? view;
        }
      }
    })();
    const until = async (pred: () => boolean, ms = 3000) => {
      const start = Date.now();
      while (!pred()) {
        if (Date.now() - start > ms) throw new Error("timed out waiting for stream");
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await until(() => !!view);
    return { events, get view() { return view as AppState; }, until, close: () => reader.cancel() };
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-"));
  await boot();
});
afterAll(async () => {
  await app.close();
});

describe("authentication", () => {
  it("signs in with a password and keeps the session in an HttpOnly cookie", async () => {
    const c = new Client();
    expect((await c.login(MAYA, "wrong-password")).status).toBe(401);
    const ok = await c.login(MAYA);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
    const me = await (await c.req("/api/session")).json();
    expect(me).toMatchObject({ mode: "server", email: MAYA });
    const anon = await (await new Client().req("/api/session")).json();
    expect(anon).toMatchObject({ mode: "server", authenticated: false });
  });

  it("throttles password guessing", async () => {
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await c.login("sofia.almeida@northwind.co", "nope-" + i)).status;
    expect(last).toBe(429);
  });

  it("rejects cross-site requests (CSRF)", async () => {
    const c = new Client();
    await c.login(PRIYA);
    const noHeader = await fetch(base + "/api/actions", { method: "POST", headers: { cookie: c.cookie, "content-type": "application/json" }, body: "{}" });
    expect(noHeader.status).toBe(403);
    const foreign = await c.req("/api/actions", { method: "POST", json: {}, headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
  });

  it("supports TOTP two-factor sign-in", async () => {
    const c = new Client();
    await c.login(PRIYA);
    const setup = await (await c.req("/api/2fa/setup", { method: "POST", json: {} })).json();
    expect(setup.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect((await c.req("/api/2fa/enable", { method: "POST", json: { code: "000000" } })).status).toBe(400);
    expect((await c.req("/api/2fa/enable", { method: "POST", json: { code: totpAt(setup.secret, Date.now()) } })).status).toBe(200);
    const fresh = new Client();
    const step1 = await fresh.login(PRIYA);
    expect(await step1.json()).toMatchObject({ error: "two_factor_required" });
    expect((await fresh.login(PRIYA, DEMO_PASSWORD, "123456")).status).toBe(401);
    expect((await fresh.login(PRIYA, DEMO_PASSWORD, totpAt(setup.secret, Date.now()))).status).toBe(200);
  });

  it("lists and revokes sessions", async () => {
    const a = new Client();
    const b = new Client();
    await a.login(MAYA);
    await b.login(MAYA);
    const { sessions } = await (await a.req("/api/sessions")).json();
    const other = sessions.find((s: { current: boolean }) => !s.current);
    expect((await a.req(`/api/sessions/${other.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await (await b.req("/api/session")).json()).toMatchObject({ authenticated: false });
  });
});

describe("authoritative actions", () => {
  it("enforces roles on the server, records denials, refuses state replacement", async () => {
    const lucas = new Client();
    await lucas.login(LUCAS);
    const denied = await lucas.act({ type: "task/create", patch: { name: "guest write", projectId: "p-atlas" } });
    expect(denied.status).toBe(403);
    expect(app.workspace.tasks.some((t) => t.name === "guest write")).toBe(false);
    expect(app.workspace.auditLog[0]).toMatchObject({ outcome: "denied" });
    const replace = await lucas.act({ type: "state/replace", state: {} });
    expect(replace.status).toBe(403);
    const forged = await lucas.act({ type: "impersonate", userId: "u-maya", reason: "trust me" });
    expect(forged.status).toBe(403);
  });

  it("streams each viewer only what they can see, in real time", async () => {
    const maya = new Client();
    const jordan = new Client();
    await maya.login(MAYA);
    await jordan.login(JORDAN);
    const ms = await maya.stream();
    const js = await jordan.stream();
    expect(js.view.projects.some((p) => p.id === "p-mobile")).toBe(false); // private
    await maya.act({ type: "task/create", patch: { name: "Secret mobile work", projectId: "p-mobile" } });
    await maya.act({ type: "task/create", patch: { name: "Public atlas work", projectId: "p-atlas" } });
    await ms.until(() => ms.view.tasks.some((t) => t.name === "Public atlas work"));
    await js.until(() => js.view.tasks.some((t) => t.name === "Public atlas work"));
    expect(js.view.tasks.some((t) => t.name === "Secret mobile work")).toBe(false);
    expect(ms.view.tasks.some((t) => t.name === "Secret mobile work")).toBe(true);
    expect(ms.events.some((e) => e.event === "patch" && e.data.ack === maya.seq)).toBe(true);
    ms.close();
    js.close();
  });

  it("persists changes to SQLite and reloads them after a restart", async () => {
    const maya = new Client();
    await maya.login(MAYA);
    await maya.act({ type: "task/create", patch: { name: "Survives restart", projectId: "p-atlas" } });
    await app.close();
    await boot();
    expect(app.workspace.tasks.some((t) => t.name === "Survives restart")).toBe(true);
    // order of newest-first feeds survives too
    expect(app.workspace.activities[0].createdAt >= app.workspace.activities[app.workspace.activities.length - 1].createdAt).toBe(true);
  });

  it("undoes your own change, but not over someone else's later edit", async () => {
    const maya = new Client();
    const priya = new Client();
    await maya.login(MAYA);
    await priya.login(PRIYA, DEMO_PASSWORD, undefined);
    const t = app.workspace.tasks.find((x) => x.projectId === "p-atlas" && !x.parentId) as Task;
    await maya.act({ type: "task/rename", id: t.id, name: "Maya's name" });
    expect((await maya.req("/api/undo", { method: "POST", json: {} })).status).toBe(200);
    expect(app.workspace.tasks.find((x) => x.id === t.id)!.name).toBe(t.name);
    await maya.act({ type: "task/rename", id: t.id, name: "Maya again" });
    await priya.act({ type: "task/rename", id: t.id, name: "Priya's edit" });
    // priya now needs 2FA from the earlier test; her action may be refused — use Jordan instead if so
    if (app.workspace.tasks.find((x) => x.id === t.id)!.name !== "Priya's edit") {
      const jordan = new Client();
      await jordan.login(JORDAN);
      await jordan.act({ type: "task/rename", id: t.id, name: "Priya's edit" });
    }
    expect((await maya.req("/api/undo", { method: "POST", json: {} })).status).toBe(409);
  });
});

describe("files", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

  it("sniffs content and blocks scripts, unknown types and malware", () => {
    expect(sniff(png, "x.bin")).toBe("image/png");
    expect(sniff(Buffer.from("<html><script>alert(1)</script>"), "a.txt")).toBeNull();
    expect(sniff(Buffer.from("plain notes"), "notes.txt")).toMatch(/text\/plain/);
    expect(sniff(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "app.exe")).toBeNull();
  });

  it("uploads, attaches and serves through short-lived signed links", async () => {
    const maya = new Client();
    await maya.login(MAYA);
    const t = app.workspace.tasks.find((x) => x.projectId === "p-atlas" && !x.parentId)!;
    const up = await maya.req(`/api/files?taskId=${t.id}&name=diagram.png`, { method: "POST", body: png });
    expect(up.status).toBe(201);
    const { fileId } = await up.json();
    expect(app.workspace.tasks.find((x) => x.id === t.id)!.attachments.some((a) => a.fileId === fileId)).toBe(true);
    const { url } = await (await maya.req(`/api/files/${fileId}/url`)).json();
    const dl = await maya.req(url);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await maya.req(url.replace(/sig=[^&]+/, "sig=forged"))).status).toBe(403);
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    expect((await maya.req(`/api/files?taskId=${t.id}&name=virus.txt`, { method: "POST", body: eicar })).status).toBe(422);
    expect((await maya.req(`/api/files?taskId=${t.id}&name=x.html`, { method: "POST", body: "<html>hi</html>" })).status).toBe(415);
    // someone who can't see the task can't fetch it, even with a valid link
    const jordan = new Client();
    await jordan.login(JORDAN);
    const mobileTask = app.workspace.tasks.find((x) => x.projectId === "p-mobile")!;
    const up2 = await maya.req(`/api/files?taskId=${mobileTask.id}&name=p.png`, { method: "POST", body: png });
    const id2 = (await up2.json()).fileId;
    const { url: url2 } = await (await maya.req(`/api/files/${id2}/url`)).json();
    expect((await jordan.req(url2)).status).toBe(404);
  });
});

describe("public forms and invitations", () => {
  it("accepts public submissions with a timed token, honeypot and rate limit", async () => {
    const maya = new Client();
    await maya.login(MAYA);
    expect((await fetch(`${base}/api/public/forms/form-1`)).status).toBe(404); // not public yet
    await maya.act({ type: "form/update", id: "form-1", patch: { public: true } });
    const form = await (await fetch(`${base}/api/public/forms/form-1`)).json();
    const post = (body: unknown) =>
      fetch(`${base}/api/public/forms/form-1`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "waypoint" },
        body: JSON.stringify(body),
      });
    const nameField = form.fields[0].id;
    // the directory never leaks to anonymous visitors, and they can't pick an assignee
    expect(form.fields.some((f: { type: string }) => f.type === "people")).toBe(false);
    expect((await post({ token: form.token, values: { [nameField]: "Too fast" } })).status).toBe(400);
    await new Promise((r) => setTimeout(r, 2600));
    expect((await post({ token: form.token, values: { [nameField]: "Real request" } })).status).toBe(201);
    expect(app.workspace.tasks.some((t) => t.notes.includes("public form link"))).toBe(true);
    const before = app.workspace.tasks.length;
    expect((await post({ token: form.token, website: "spam.biz", values: { [nameField]: "Bot" } })).status).toBe(201);
    expect(app.workspace.tasks.length).toBe(before); // honeypot: nothing stored
  });

  it("lets an invited person set a password and sign in", async () => {
    const maya = new Client();
    await maya.login(MAYA);
    await maya.act({ type: "invite/create", email: "new.hire@northwind.co", role: "member", projectIds: ["p-atlas"] });
    const invite = app.workspace.invites.find((i) => i.email === "new.hire@northwind.co")!;
    const newbie = new Client();
    expect((await newbie.req("/api/invites/accept", { method: "POST", json: { inviteId: invite.id, password: "short" } })).status).toBe(400);
    expect((await newbie.req("/api/invites/accept", { method: "POST", json: { inviteId: invite.id, password: "a-long-password" } })).status).toBe(200);
    expect(await (await newbie.req("/api/session")).json()).toMatchObject({ email: "new.hire@northwind.co" });
    // the invite can't be reused
    expect((await new Client().req("/api/invites/accept", { method: "POST", json: { inviteId: invite.id, password: "a-long-password" } })).status).toBe(404);
  });
});

describe("impersonation and backups", () => {
  it("runs 'View as' on the server with a reason and the viewed identity's scope", async () => {
    const maya = new Client();
    await maya.login(MAYA);
    const s = await maya.stream();
    expect((await maya.act({ type: "impersonate", userId: "u-lucas" })).status).toBe(403); // no reason
    expect((await maya.act({ type: "impersonate", userId: "u-lucas", reason: "Support ticket 12" })).status).toBe(200);
    await s.until(() => s.view.currentUserId === "u-lucas");
    expect(s.view.projects.some((p) => p.id === "p-atlas")).toBe(false);
    expect((await maya.act({ type: "task/create", patch: { name: "as lucas", projectId: "p-atlas" } })).status).toBe(403);
    expect((await maya.act({ type: "impersonate", userId: "u-maya" })).status).toBe(200);
    await s.until(() => s.view.currentUserId === "u-maya");
    s.close();
  });

  it("exports for admins only and refuses imports that would lock the owner out", async () => {
    const jordan = new Client();
    await jordan.login(JORDAN);
    expect((await jordan.req("/api/export")).status).toBe(403);
    const maya = new Client();
    await maya.login(MAYA);
    const exp = await maya.req("/api/export");
    expect(exp.status).toBe(200);
    const backup = await exp.json();
    expect(backup.tasks.length).toBeGreaterThan(0);
    const noOwner = { ...backup, users: backup.users.map((u: { id: string }) => (u.id === "u-maya" ? { ...u, workspaceRole: "member" } : u)) };
    expect((await maya.req("/api/import", { method: "POST", body: JSON.stringify(noOwner) })).status).toBe(400);
    expect((await maya.req("/api/import", { method: "POST", body: JSON.stringify(backup) })).status).toBe(200);
  });
});
