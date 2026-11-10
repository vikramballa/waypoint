import { describe, expect, it } from "vitest";
import { createSeedState } from "./seed";
import { hydrate, reducer, type Action } from "./store";
import { scopeStateForViewer } from "./rbac";
import { analyzeSchedule, dependentShifts } from "./schedule";
import { sanitizeState, TEXT_LIMITS } from "./validate";
import type { AppState, Task } from "./types";
import { addDays, todayISO } from "./utils";

const seed = (): AppState => createSeedState();
const as = (s: AppState, userId: string): AppState => ({ ...s, currentUserId: userId });
const run = (s: AppState, ...actions: Action[]): AppState => actions.reduce((acc, a) => reducer(acc, a), s);
const task = (s: AppState, id: string) => s.tasks.find((t) => t.id === id)!;

/* ------------------------------------------------------------------ data */

describe("saved-data validation", () => {
  it("leaves clean seed data untouched", () => {
    const s = seed();
    const { state, repairs } = sanitizeState(s);
    expect(repairs).toBe(0);
    expect(state.tasks).toEqual(s.tasks);
    expect(state.projects).toEqual(s.projects);
  });

  it("repairs tampered or corrupted records", () => {
    const s = seed();
    const t0 = s.tasks[0];
    const tampered = {
      ...s,
      users: s.users.map((u) => (u.id === "u-lucas" ? { ...u, workspaceRole: "superadmin" } : u)),
      projects: s.projects.map((p) =>
        p.id === "p-atlas" ? { ...p, privacy: "everyone", roles: { "u-hana": "god", "u-ghost": "owner" } } : p
      ),
      tasks: [
        ...s.tasks.map((t) =>
          t.id === t0.id
            ? { ...t, projectId: "p-missing", blockedByIds: ["nope", t.id], followerIds: "x", name: "a".repeat(80_000) }
            : t
        ),
        { ...t0 }, // duplicate id
        42, // not a record
      ],
      comments: [...s.comments, { ...s.comments[0], id: "c-orphan", taskId: "gone" }],
      currentUserId: "u-deleted",
    } as unknown as AppState;
    const { state, repairs } = sanitizeState(tampered);
    expect(repairs).toBeGreaterThan(5);
    expect(state.users.find((u) => u.id === "u-lucas")!.workspaceRole).toBe("guest");
    const atlas = state.projects.find((p) => p.id === "p-atlas")!;
    expect(atlas.privacy).toBe("private");
    expect(atlas.roles).toEqual({});
    expect(state.tasks.filter((t) => t.id === t0.id)).toHaveLength(1);
    const fixed = task(state, t0.id);
    expect(fixed.projectId).toBeNull();
    expect(fixed.blockedByIds).toEqual([]);
    expect(fixed.followerIds).toEqual([]);
    expect(fixed.name.length).toBeLessThanOrEqual(50_000);
    expect(state.comments.some((c) => c.id === "c-orphan")).toBe(false);
    expect(state.currentUserId).toBe("u-maya");
  });

  it("runs on every hydrate, including cross-tab payloads", () => {
    const bad = { ...seed(), users: seed().users.map((u) => ({ ...u, workspaceRole: "root" })) };
    const loaded = hydrate(JSON.stringify(bad));
    expect(loaded.users.every((u) => u.workspaceRole === "guest")).toBe(true);
  });
});

describe("input limits", () => {
  it("trims, clamps and rejects empty text", () => {
    const s = seed();
    const long = run(s, { type: "task/create", patch: { name: "x".repeat(5000), projectId: "p-atlas" } });
    expect(long.tasks[long.tasks.length - 1].name).toHaveLength(TEXT_LIMITS.name);
    expect(run(s, { type: "task/create", patch: { name: "   ", projectId: "p-atlas" } }).tasks.length).toBe(s.tasks.length);
    const t = s.tasks.find((x) => x.projectId === "p-atlas")!;
    expect(run(s, { type: "comment/create", taskId: t.id, text: "  " }).comments.length).toBe(s.comments.length);
    const c = run(s, { type: "comment/create", taskId: t.id, text: "y".repeat(50_000) });
    expect(c.comments[c.comments.length - 1].text).toHaveLength(TEXT_LIMITS.comment);
    expect(run(s, { type: "task/rename", id: t.id, name: "" }).tasks).toBe(s.tasks);
  });

  it("validates invitation addresses", () => {
    const s = seed();
    expect(run(s, { type: "invite/create", email: "not-an-email", role: "member", projectIds: [] }).invites.length)
      .toBe(s.invites.length);
    const ok = run(s, { type: "invite/create", email: "  Ada@Example.COM ", role: "member", projectIds: [] });
    expect(ok.invites[0].email).toBe("ada@example.com");
  });
});

/* --------------------------------------------------------------- agents */

describe("AI teammates act under their own permissions", () => {
  const advanceAll = (s: AppState, runId: string) => {
    for (let i = 0; i < 8; i++) s = reducer(s, { type: "agent/runAdvance", runId });
    return s;
  };

  it("refuses visibly when the agent has no access to the project", () => {
    const s = seed();
    const t = s.tasks.find((x) => x.projectId === "p-mobile" && !x.parentId)!; // quill lacks p-mobile
    const next = reducer(s, { type: "task/setAssignee", id: t.id, userId: "ai-quill" });
    const r = next.agentRuns.find((x) => x.taskId === t.id && x.teammateId === "ai-quill")!;
    expect(r.status).toBe("cancelled");
    expect(r.steps[0].label).toMatch(/can't work in/);
    expect(advanceAll(next, r.id).tasks.filter((x) => x.parentId === t.id).length)
      .toBe(s.tasks.filter((x) => x.parentId === t.id).length);
  });

  it("skips steps whose scope was not granted", () => {
    let s = seed();
    s = reducer(s, { type: "agent/update", id: "ai-scout", patch: { authScopes: ["scope-projects", "scope-comments"] } });
    const t = s.tasks.find((x) => x.name === "Load test 10k tasks per project")!;
    s = reducer(s, { type: "task/setAssignee", id: t.id, userId: "ai-scout" });
    const r = s.agentRuns.find((x) => x.taskId === t.id)!;
    s = advanceAll(s, r.id);
    expect(s.tasks.filter((x) => x.parentId === t.id)).toHaveLength(0); // no scope-create
    const plan = s.agentRuns.find((x) => x.id === r.id)!.steps.find((st) => st.kind === "plan");
    if (plan) expect(plan.detail).toMatch(/Skipped/);
    expect(s.comments.some((c) => c.authorId === "ai-scout" && c.taskId === t.id)).toBe(true); // has scope-comments
  });

  it("holds a run while the agent is paused", () => {
    let s = seed();
    const t = s.tasks.find((x) => x.name === "Load test 10k tasks per project")!;
    s = reducer(s, { type: "task/setAssignee", id: t.id, userId: "ai-scout" });
    const r = s.agentRuns.find((x) => x.taskId === t.id)!;
    s = reducer(s, { type: "agent/toggle", id: "ai-scout" });
    const held = reducer(s, { type: "agent/runAdvance", runId: r.id });
    expect(held.agentRuns.find((x) => x.id === r.id)!.cursor).toBe(r.cursor);
  });
});

/* ------------------------------------------------------------ audit log */

describe("audit log", () => {
  it("records sensitive changes with the real actor behind impersonation", () => {
    let s = seed();
    s = reducer(s, { type: "workspace/setRole", userId: "u-priya", role: "admin" });
    expect(s.auditLog[0]).toMatchObject({ actorId: "u-maya", outcome: "allowed", action: "workspace/setRole" });
    expect(s.auditLog[0].detail).toMatch(/Priya Nair's workspace role to admin/);

    s = reducer(s, { type: "impersonate", userId: "u-lucas", reason: "Support ticket 4821" });
    expect(s.auditLog[0].detail).toMatch(/Maya Chen started viewing as Lucas/);
    s = reducer(s, { type: "audit/denied", attempted: "project/delete" });
    expect(s.auditLog[0]).toMatchObject({ actorId: "u-lucas", viaId: "u-maya", outcome: "denied" });
  });

  it("ignores routine edits and stays admin-only", () => {
    const s = seed();
    const t = s.tasks.find((x) => x.projectId === "p-atlas")!;
    expect(reducer(s, { type: "task/rename", id: t.id, name: "Renamed" }).auditLog).toHaveLength(0);
    const logged = reducer(s, { type: "workspace/setRole", userId: "u-priya", role: "admin" });
    expect(scopeStateForViewer(as(logged, "u-jordan")).auditLog).toHaveLength(0);
    expect(scopeStateForViewer(as(logged, "u-alex")).auditLog.length).toBe(1);
  });
});

/* ------------------------------------------------------------- approvals */

describe("approval tasks", () => {
  const setup = () => {
    let s = seed();
    // hana is only a commenter on Atlas — enough to approve
    s = run(
      s,
      { type: "task/create", patch: { id: "tk-appr", name: "Approve launch copy", projectId: "p-atlas" } },
      // set after creation: Atlas' triage rule reassigns new tasks
      { type: "task/setAssignee", id: "tk-appr", userId: "u-hana" }
    );
    s = reducer(as(s, "u-priya"), { type: "task/update", id: "tk-appr", patch: { approvalStatus: "pending" } });
    return s;
  };

  it("lets editors request an approval but not decide it", () => {
    const s = setup();
    expect(task(s, "tk-appr").approvalStatus).toBe("pending");
    const forged = reducer(as(s, "u-priya"), { type: "task/update", id: "tk-appr", patch: { approvalStatus: "approved" } });
    expect(task(forged, "tk-appr").approvalStatus).toBe("pending");
    const bulk = reducer(as(s, "u-priya"), { type: "tasks/bulk", ids: ["tk-appr"], patch: { approvalStatus: "approved" } });
    expect(task(bulk, "tk-appr").approvalStatus).toBe("pending");
    const ticked = reducer(as(s, "u-priya"), { type: "task/toggleComplete", id: "tk-appr" });
    expect(task(ticked, "tk-appr").completed).toBe(false);
    const wrongPerson = reducer(as(s, "u-priya"), { type: "task/decide", id: "tk-appr", decision: "approved" });
    expect(task(wrongPerson, "tk-appr").approvalStatus).toBe("pending");
  });

  it("lets the approver decide with commenter access, then audits it", () => {
    const s = setup();
    const approved = reducer(as(s, "u-hana"), { type: "task/decide", id: "tk-appr", decision: "approved", note: "Ship it" });
    const t = task(approved, "tk-appr");
    expect(t.approvalStatus).toBe("approved");
    expect(t.completed).toBe(true);
    expect(approved.comments.some((c) => c.taskId === "tk-appr" && c.text === "Approved this: Ship it")).toBe(true);
    expect(approved.auditLog[0].detail).toMatch(/Approved/);
    // decided approvals cannot be re-decided
    const again = reducer(as(approved, "u-hana"), { type: "task/decide", id: "tk-appr", decision: "rejected" });
    expect(task(again, "tk-appr").approvalStatus).toBe("approved");
  });

  it("keeps 'changes requested' open and reopening returns to pending", () => {
    const s = setup();
    const changes = reducer(as(s, "u-hana"), { type: "task/decide", id: "tk-appr", decision: "changes-requested" });
    expect(task(changes, "tk-appr").completed).toBe(false);
    const rejected = reducer(as(s, "u-hana"), { type: "task/decide", id: "tk-appr", decision: "rejected" });
    const reopened = reducer(as(rejected, "u-priya"), { type: "task/toggleComplete", id: "tk-appr", value: false });
    expect(task(reopened, "tk-appr")).toMatchObject({ completed: false, approvalStatus: "pending" });
  });
});

/* ------------------------------------------------------------- schedule */

describe("critical path and auto-scheduling", () => {
  const today = todayISO();
  const mk = (base: Task, id: string, start: number, due: number, extra: Partial<Task> = {}): Task => ({
    ...base,
    id,
    name: id,
    parentId: null,
    completed: false,
    startDate: addDays(today, start),
    dueDate: addDays(today, due),
    blockedByIds: [],
    blockingIds: [],
    ...extra,
  });
  const chain = (base: Task) => [
    mk(base, "A", 0, 2, { blockingIds: ["B"] }),
    mk(base, "B", 3, 5, { blockedByIds: ["A"], blockingIds: ["C"] }),
    mk(base, "C", 6, 9, { blockedByIds: ["B"] }),
    mk(base, "D", 0, 1), // independent, finishes early
    mk(base, "E", 1, 2, { blockingIds: ["F"] }),
    mk(base, "F", 2, 4, { blockedByIds: ["E"] }), // starts before its blocker finishes
  ];

  it("finds the zero-slack chain, slack elsewhere, and conflicts", () => {
    const base = seed().tasks[0];
    const a = analyzeSchedule(chain(base));
    expect(a.criticalIds.sort()).toEqual(["A", "B", "C"]);
    expect(a.byId.get("D")!.slack).toBe(8);
    expect(a.conflictIds).toEqual(["F"]);
    expect(a.byId.get("F")!.forecastStart).toBe(addDays(today, 3)); // pushed after E
    expect(a.forecastEnd).toBe(addDays(today, 9));
  });

  it("pushes dependents later, transitively, keeping durations", () => {
    const base = seed().tasks[0];
    const shifts = dependentShifts(chain(base), "A", addDays(today, 4), () => true);
    expect(shifts.get("B")).toEqual({ startDate: addDays(today, 5), dueDate: addDays(today, 7), days: 2 });
    expect(shifts.get("C")).toEqual({ startDate: addDays(today, 8), dueDate: addDays(today, 11), days: 2 });
    expect(dependentShifts(chain(base), "A", addDays(today, 1), () => true).size).toBe(0);
    expect(dependentShifts(chain(base), "A", addDays(today, 4), (t) => t.id !== "B").size).toBe(0);
  });

  it("auto-shifts in the reducer only when the project opts in", () => {
    let s = seed();
    const base = s.tasks.find((t) => t.projectId === "p-atlas")!;
    const tasks = chain({ ...base, projectId: "p-atlas" });
    s = { ...s, tasks: [...s.tasks, ...tasks] };
    const moved = { type: "task/update", id: "A", patch: { dueDate: addDays(today, 4) } } as Action;
    expect(task(reducer(s, moved), "B").startDate).toBe(addDays(today, 3));
    s = reducer(s, { type: "project/update", id: "p-atlas", patch: { autoShiftDates: true } });
    const after = reducer(s, moved);
    expect(task(after, "B").startDate).toBe(addDays(today, 5));
    expect(task(after, "C").dueDate).toBe(addDays(today, 11));
    expect(after.activities.some((x) => x.taskId === "C" && x.detail?.includes("by a dependency"))).toBe(true);
  });
});
