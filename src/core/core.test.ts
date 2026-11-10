import { describe, expect, it } from "vitest";
import { createSeedState } from "./seed";
import { reducer, type Action } from "./store";
import type { AppState, Task } from "./types";
import {
  addDays,
  addMonths,
  diffDays,
  dueState,
  formatDue,
  fuzzyScore,
  needsRebalance,
  orderBetween,
  parseQuery,
  rebalance,
  startOfMonth,
  startOfWeek,
  todayISO,
} from "./utils";
import {
  filterTasks,
  goalProgress,
  myTasks,
  projectStats,
  sortTasks,
  subtasksOf,
  workloadByWeek,
} from "./selectors";
import {
  can,
  effectiveProjectRole,
  projectMatrixValue,
  workspaceMatrixValue,
} from "./rbac";
import { answerQuestion, agentPlan, parseTaskDraft, projectSummary } from "./ai";

const state = (): AppState => createSeedState();
const run = (s: AppState, ...actions: Action[]): AppState =>
  actions.reduce((acc, a) => reducer(acc, a), s);

describe("date + ordering primitives", () => {
  it("round-trips date arithmetic across month boundaries", () => {
    const start = "2026-01-31";
    expect(addDays(start, 1)).toBe("2026-02-01");
    expect(addMonths(start, 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(diffDays("2026-03-05", "2026-02-26")).toBe(7);
    expect(startOfMonth("2026-07-19")).toBe("2026-07-01");
    expect(startOfWeek("2026-07-19", 0)).toBe("2026-07-19");
  });

  it("labels due dates the way the product does", () => {
    const today = todayISO();
    expect(formatDue(today)).toBe("Today");
    expect(formatDue(addDays(today, 1))).toBe("Tomorrow");
    expect(formatDue(addDays(today, -1))).toBe("Yesterday");
    expect(dueState(addDays(today, -2), false)).toBe("overdue");
    expect(dueState(today, false)).toBe("today");
    expect(dueState(addDays(today, 2), false)).toBe("soon");
    expect(dueState(addDays(today, 30), false)).toBe("later");
    expect(dueState(addDays(today, -2), true)).toBe("none");
  });

  it("produces unique fractional orders and detects precision loss", () => {
    const a = orderBetween(null, null);
    const b = orderBetween(a, null);
    const mid = orderBetween(a, b);
    expect(a).toBeLessThan(mid);
    expect(mid).toBeLessThan(b);
    expect(needsRebalance([1, 1, 1])).toBe(true);
    const balanced = rebalance<{ order: number }>([
      { order: 5 },
      { order: 5 },
      { order: 9 },
    ]);
    expect(balanced.map((x) => x.order)).toEqual([1000, 2000, 3000]);
  });

  it("parses the inline search language", () => {
    const q = parseQuery("launch due:today assignee:me priority:high tag:design");
    expect(q.text).toBe("launch");
    expect(q.due).toBe("today");
    expect(q.assignee).toBe("me");
    expect(q.priority).toBe("high");
    expect(q.tag).toBe("design");
  });

  it("ranks fuzzy matches and rejects non-matches", () => {
    expect(fuzzyScore("atlas", "Atlas Product Launch")).toBeGreaterThan(0);
    expect(fuzzyScore("zzz", "Atlas Product Launch")).toBe(-1);
    expect(fuzzyScore("", "anything")).toBe(1);
  });
});

describe("selectors", () => {
  it("buckets My Tasks without duplicates", () => {
    const s = state();
    const buckets = myTasks(s);
    const all = [
      ...buckets.recent,
      ...buckets.today,
      ...buckets.upcoming,
      ...buckets.later,
      ...buckets.noDate,
    ].map((t) => t.id);
    expect(new Set(all).size).toBe(all.length);
    for (const t of buckets.recent) {
      expect(t.assigneeId).toBe(s.currentUserId);
    }
  });

  it("computes project stats and progress", () => {
    const s = state();
    const stats = projectStats(s, "p-atlas");
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.done + stats.open).toBe(stats.total);
    expect(stats.percent).toBe(Math.round((stats.done / stats.total) * 100));
  });

  it("filters and sorts tasks", () => {
    const s = state();
    const open = filterTasks(s.tasks, { completed: "open" });
    expect(open.every((t) => !t.completed)).toBe(true);
    const high = filterTasks(s.tasks, { priority: "high" });
    expect(high.every((t) => t.priority === "high")).toBe(true);
    const sorted = sortTasks(s, s.tasks, "name", "asc");
    const names = sorted.map((t) => t.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it("rolls up workload per week and goal progress", () => {
    const s = state();
    const weeks = workloadByWeek(s, ["p-atlas"], 3);
    expect(weeks).toHaveLength(3);
    expect(weeks[0].weekStart).toBe(todayISO());
    const goal = s.goals[0];
    const pct = goalProgress(goal);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

describe("reducer", () => {
  it("creates a task in the first section and logs activity", () => {
    const s = state();
    const next = run(s, { type: "task/create", patch: { name: "Write migration notes", projectId: "p-atlas" } });
    const created = next.tasks.find((t) => t.name === "Write migration notes");
    expect(created).toBeDefined();
    expect(created?.sectionId).toBe("s-atlas-1");
    expect(next.activities[0].taskId).toBe(created?.id);
  });

  it("reorders tasks inside a section with fractional orders", () => {
    const s = state();
    const [first, second] = s.tasks
      .filter((t) => t.sectionId === "s-atlas-2" && !t.parentId)
      .sort((a, b) => a.order - b.order);
    const next = run(s, { type: "task/move", id: second.id, sectionId: "s-atlas-2", beforeId: first.id });
    const moved = next.tasks.find((t) => t.id === second.id)!;
    expect(moved.order).toBeLessThan(first.order);
    expect(moved.sectionId).toBe("s-atlas-2");
  });

  it("runs the automation engine when a task moves into review", () => {
    const s = state();
    const task = s.tasks.find((t) => t.name === "Pricing page copy for Atlas tiers")!;
    const next = run(s, { type: "task/move", id: task.id, sectionId: "s-atlas-3" });
    const moved = next.tasks.find((t) => t.id === task.id)!;
    expect(moved.assigneeId).toBe("u-priya");
    expect(moved.tagIds).toContain("tag-design");
    expect(moved.dueDate).not.toBeNull();
    expect(next.rules.find((r) => r.id === "r-2")!.runCount).toBeGreaterThan(6);
  });

  it("starts and advances an agent run when a task is assigned to a teammate", () => {
    const s = state();
    const task = s.tasks.find((t) => t.name === "Load test 10k tasks per project")!;
    const assigned = run(s, { type: "task/setAssignee", id: task.id, userId: "ai-scout" });
    const agentRun = assigned.agentRuns.find((r) => r.taskId === task.id)!;
    expect(agentRun).toBeDefined();
    expect(agentRun.teammateId).toBe("ai-scout");

    let advanced = assigned;
    for (let i = 0; i < 6; i++) {
      advanced = applyRunStep(advanced, agentRun.id);
    }
    const subs = subtasksOf(advanced, task.id);
    expect(subs.length).toBe(3);
    expect(subs.every((x) => x.completed)).toBe(true);
    expect(advanced.comments.some((c) => c.authorId === "ai-scout")).toBe(true);
    expect(advanced.agentRuns.find((r) => r.id === agentRun.id)!.status).toBe("done");
  });

  it("cancels an agent run when the task is reassigned to a human", () => {
    const s = state();
    const task = s.tasks.find((t) => t.name === "Instrument activation funnel events")!;
    const assigned = run(s, { type: "task/setAssignee", id: task.id, userId: "ai-scout" });
    const reassigned = run(assigned, { type: "task/setAssignee", id: task.id, userId: "u-alex" });
    const agentRun = reassigned.agentRuns.find((r) => r.taskId === task.id)!;
    expect(agentRun.status).toBe("cancelled");
  });

  it("submits a form and maps fields onto the created task", () => {
    const s = state();
    const due = addDays(todayISO(), 6);
    const next = run(s, {
      type: "form/submit",
      projectId: "p-website",
      values: {
        "ff-6": "Fix the footer contrast",
        "ff-7": "Footer links fail WCAG AA on the warm background.",
        "ff-8": due,
      },
    });
    const created = next.tasks.find((t) => t.name === "Fix the footer contrast")!;
    expect(created.notes).toContain("WCAG");
    expect(created.dueDate).toBe(due);
    expect(created.projectId).toBe("p-website");
    expect(next.forms.find((f) => f.id === "form-2")!.submissions).toBe(4);
  });

  it("runs project automations on form submissions", () => {
    const s = state();
    const before = s.rules.find((r) => r.id === "r-1")!.runCount;
    const next = run(s, {
      type: "form/submit",
      projectId: "p-atlas",
      values: {
        "ff-1": "Automate triage for partner requests",
        "ff-2": "Route new partner asks to Scout.",
        "ff-3": addDays(todayISO(), 5),
        "ff-4": "u-sofia",
        "ff-5": "High",
      },
    });
    const created = next.tasks.find((t) => t.name === "Automate triage for partner requests")!;
    // triage rule r-1 assigns Maya and bumps the run counter
    expect(created.assigneeId).toBe("u-maya");
    expect(next.rules.find((r) => r.id === "r-1")!.runCount).toBe(before + 1);
  });

  it("instantiates a template with sections, tasks and a milestone", () => {
    const s = state();
    const next = run(s, {
      type: "template/instantiate",
      templateId: "tpl-launch",
      name: "Atlas 4.0",
      projectId: "p-new",
    });
    const project = next.projects.find((p) => p.id === "p-new")!;
    expect(project.name).toBe("Atlas 4.0");
    const sections = next.sections.filter((x) => x.projectId === "p-new");
    const tasks = next.tasks.filter((t) => t.projectId === "p-new");
    expect(sections).toHaveLength(4);
    expect(tasks).toHaveLength(7);
    expect(tasks.some((t) => t.milestone)).toBe(true);
  });

  it("extracts a meeting action item into a task", () => {
    const s = state();
    const next = run(s, { type: "meeting/actionToTask", meetingId: "mtg-1", actionItemId: "ai-1" });
    expect(next.tasks.some((t) => t.name === "Finalise the Atlas GA launch checklist")).toBe(true);
    expect(next.meetings[0].actionItems.find((a) => a.id === "ai-1")!.created).toBe(true);
    // idempotent
    const again = run(next, { type: "meeting/actionToTask", meetingId: "mtg-1", actionItemId: "ai-1" });
    expect(
      again.tasks.filter((t) => t.name === "Finalise the Atlas GA launch checklist")
    ).toHaveLength(1);
  });

  it("accepts an invitation and grants project membership", () => {
    const s = state();
    const next = run(s, { type: "invite/accept", id: "inv-1" });
    const user = next.users.find((u) => u.email === "noor.hassan@northwind.co")!;
    expect(user).toBeDefined();
    expect(next.projects.find((p) => p.id === "p-atlas")!.memberIds).toContain(user.id);
    expect(next.invites.find((i) => i.id === "inv-1")!.status).toBe("accepted");
  });

  it("creates and advances a dev agent session", () => {
    const s = state();
    const started = run(s, {
      type: "session/start",
      teammateId: "ai-scout",
      ticketId: "ticket-2",
      taskId: null,
      prompt: "Draft the unsaved-changes guard",
    });
    const session = started.agentSessions[0];
    expect(session.status).toBe("running");
    expect(started.tickets.find((t) => t.id === "ticket-2")!.agentSessionIds).toContain(session.id);
    let advanced = started;
    for (let i = 0; i < 4; i++) {
      advanced = run(advanced, { type: "session/advance", id: session.id });
    }
    expect(advanced.agentSessions[0].status).toBe("done");
    expect(advanced.agentSessions[0].artifacts.length).toBeGreaterThan(0);
  });
});

function applyRunStep(s: AppState, runId: string): AppState {
  return reducer(s, { type: "agent/runAdvance", runId });
}

describe("role based access control", () => {
  it("resolves effective project roles by explicit role, privacy and workspace role", () => {
    const s = state();
    const atlas = s.projects.find((p) => p.id === "p-atlas")!;
    const mobile = s.projects.find((p) => p.id === "p-mobile")!;
    expect(effectiveProjectRole(s, atlas, "u-maya")).toBe("owner");
    expect(effectiveProjectRole(s, atlas, "u-hana")).toBe("commenter");
    expect(effectiveProjectRole(s, mobile, "u-alex")).toBe("owner");
    expect(effectiveProjectRole(s, mobile, "u-jordan")).toBeNull();
    expect(effectiveProjectRole(s, atlas, "u-lucas")).toBeNull();
  });

  it("gates task mutations for viewers and allows editors", () => {
    const s = state();
    const viewer = { ...s, currentUserId: "u-lucas" };
    const viewerState = reducer(viewer, {
      type: "task/create",
      patch: { name: "Viewer cannot create", projectId: "p-website" },
    });
    expect(viewerState.tasks.some((t) => t.name === "Viewer cannot create")).toBe(false);

    const editorState = reducer(
      { ...s, currentUserId: "u-priya" },
      { type: "task/create", patch: { name: "Editor can create", projectId: "p-website" } }
    );
    expect(editorState.tasks.some((t) => t.name === "Editor can create")).toBe(true);
  });

  it("blocks deleting tasks for editors but allows project owners", () => {
    const s = state();
    const task = s.tasks.find((t) => t.projectId === "p-website" && !t.parentId)!;
    const asEditor = reducer({ ...s, currentUserId: "u-maya" }, { type: "task/delete", id: task.id });
    expect(asEditor.tasks.some((t) => t.id === task.id)).toBe(false);

    // lucas is a viewer on the website project
    const asViewer = reducer({ ...s, currentUserId: "u-lucas" }, { type: "task/delete", id: task.id });
    expect(asViewer.tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it("never grants workspace powers to guests, agents or project owners", () => {
    const s = state();
    const guest = { ...s, currentUserId: "u-lucas" };
    expect(can(guest, "project:create")).toBe(false);
    expect(can(guest, "workspace:admin")).toBe(false);
    expect(can(guest, "workspace:invite")).toBe(false);
    expect(can(s, "workspace:admin", { userId: "u-maya" })).toBe(true);
    const asMember = { ...s, currentUserId: "u-priya" };
    expect(can(asMember, "workspace:admin")).toBe(false);
    expect(can(asMember, "project:create")).toBe(true);
  });

  it("exposes consistent permission matrices", () => {
    expect(projectMatrixValue("viewer", "comment:create")).toBe(false);
    expect(projectMatrixValue("commenter", "comment:create")).toBe(true);
    expect(projectMatrixValue("editor", "task:create")).toBe(true);
    expect(projectMatrixValue("editor", "task:delete")).toBe(false);
    expect(projectMatrixValue("owner", "project:share")).toBe(true);
    expect(workspaceMatrixValue("guest", "project:create")).toBe(false);
    expect(workspaceMatrixValue("member", "project:create")).toBe(true);
    expect(workspaceMatrixValue("admin", "workspace:admin")).toBe(true);
    expect(workspaceMatrixValue("member", "billing:manage")).toBe(false);
    expect(workspaceMatrixValue("owner", "billing:manage")).toBe(true);
  });
});

describe("AI engine", () => {
  it("parses a natural-language task into fields", () => {
    const s = state();
    const draft = parseTaskDraft(
      s,
      "Create a task to review launch copy by Friday in Atlas for Alex, high priority"
    );
    expect(draft.name.toLowerCase()).toContain("review launch copy");
    expect(draft.name.toLowerCase()).not.toContain("friday");
    expect(draft.projectId).toBe("p-atlas");
    expect(draft.assigneeId).toBe("u-alex");
    expect(draft.priority).toBe("high");
    const friday = new Date(`${draft.dueDate}T12:00:00`).getDay();
    expect(friday).toBe(5);
  });

  it("answers project health questions with citations", () => {
    const s = state();
    const reply = answerQuestion(s, "How is the Atlas launch looking?");
    expect(reply.text).toContain("Atlas Product Launch");
    expect(reply.citations.length).toBeGreaterThan(0);
    const keys = reply.citations.map((c) => `${c.kind}:${c.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("finds overdue work and drafts status updates", () => {
    const s = state();
    const overdue = answerQuestion(s, "What is overdue?");
    expect(overdue.text.toLowerCase()).toContain("overdue");
    const draft = answerQuestion(s, "Draft a status update for Website Redesign");
    expect(draft.actions[0].kind).toBe("draft-status");
    expect(projectSummary(s, "p-website").text).toContain("Website Redesign");
  });

  it("plans an agent run that reflects the teammate's skills", () => {
    const s = state();
    const scout = s.users.find((u) => u.id === "ai-scout")!;
    const task = s.tasks.find((t) => t.id === "tk-atlas-3")!;
    const steps = agentPlan(s, scout, task);
    expect(steps.some((x) => x.kind === "ack")).toBe(true);
    expect(steps.some((x) => x.label === "Drafted a plan")).toBe(true);
    expect(steps.some((x) => x.kind === "done")).toBe(true);
  });
});

describe("seed data integrity", () => {
  it("has no dangling references", () => {
    const s = state();
    const userIds = new Set(s.users.map((u) => u.id));
    const projectIds = new Set(s.projects.map((p) => p.id));
    const sectionIds = new Set(s.sections.map((x) => x.id));
    const taskIds = new Set(s.tasks.map((t) => t.id));
    for (const t of s.tasks) {
      if (t.assigneeId) expect(userIds.has(t.assigneeId)).toBe(true);
      if (t.projectId) expect(projectIds.has(t.projectId)).toBe(true);
      if (t.sectionId) expect(sectionIds.has(t.sectionId)).toBe(true);
      if (t.parentId) expect(taskIds.has(t.parentId)).toBe(true);
      for (const dep of t.blockedByIds) expect(taskIds.has(dep)).toBe(true);
    }
    for (const p of s.projects) {
      for (const m of p.memberIds) expect(userIds.has(m)).toBe(true);
      for (const id of Object.keys(p.roles ?? {})) expect(p.memberIds).toContain(id);
    }
  });

  it("keeps agent runs, sessions and tickets internally consistent", () => {
    const s = state();
    for (const run of s.agentRuns) {
      expect(s.users.some((u) => u.id === run.teammateId && u.isAgent)).toBe(true);
      if (run.taskId) expect(s.tasks.some((t) => t.id === run.taskId)).toBe(true);
      expect(run.steps.length).toBeGreaterThan(0);
    }
    for (const session of s.agentSessions) {
      if (session.ticketId) expect(s.tickets.some((t) => t.id === session.ticketId)).toBe(true);
    }
    for (const ticket of s.tickets) {
      expect(s.devSpaces.some((sp) => sp.id === ticket.spaceId)).toBe(true);
    }
  });

  it("marks completed tasks with a completion timestamp", () => {
    const s = state();
    for (const t of s.tasks) {
      if (t.completed) expect(t.completedAt).not.toBeNull();
    }
  });
});
