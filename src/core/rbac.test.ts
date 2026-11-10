import { describe, expect, it } from "vitest";
import { createSeedState } from "./seed";
import { authorize, hydrate, LIMITS, reducer, type Action } from "./store";
import type { AppState, Task } from "./types";
import { scopeStateForViewer, taskVisibility } from "./rbac";

const seed = (): AppState => createSeedState();
const as = (s: AppState, userId: string): AppState => ({ ...s, currentUserId: userId });
const run = (s: AppState, ...actions: Action[]): AppState =>
  actions.reduce((acc, a) => reducer(acc, a), s);
const taskIn = (s: AppState, projectId: string): Task =>
  s.tasks.find((t) => t.projectId === projectId && !t.parentId)!;

/*
 * Seed roles used below:
 *   u-maya  workspace owner        u-alex  admin
 *   u-priya member, website owner, mobile commenter
 *   u-hana  member, atlas commenter
 *   u-jordan member, not on p-mobile (private)
 *   u-lucas guest: website viewer, brand editor, campaign viewer
 */

describe("RBAC: write enforcement", () => {
  it("checks every id in bulk edits, not just the first", () => {
    const s = seed();
    const brand = taskIn(s, "p-brand"); // lucas is editor
    const website = taskIn(s, "p-website"); // lucas is viewer
    const next = reducer(as(s, "u-lucas"), {
      type: "tasks/bulk",
      ids: [brand.id, website.id],
      patch: { name: "pwned" },
    });
    expect(next.tasks.find((t) => t.id === website.id)!.name).not.toBe("pwned");
    expect(next.tasks.find((t) => t.id === brand.id)!.name).not.toBe("pwned");
  });

  it("checks every id in bulk deletes", () => {
    const s = seed();
    const own = taskIn(s, "p-website"); // priya owns website
    const atlas = taskIn(s, "p-atlas"); // priya is only an editor there
    const next = reducer(as(s, "u-priya"), { type: "tasks/delete", ids: [own.id, atlas.id] });
    expect(next.tasks.some((t) => t.id === atlas.id)).toBe(true);
  });

  it("requires create rights on the destination when moving work between projects", () => {
    const s = seed();
    const brand = taskIn(s, "p-brand"); // lucas edits brand, only views website
    for (const action of [
      { type: "task/move", id: brand.id, projectId: "p-website" },
      { type: "task/update", id: brand.id, patch: { projectId: "p-website" } },
      { type: "tasks/bulk", ids: [brand.id], patch: { projectId: "p-website" } },
    ] as Action[]) {
      const next = reducer(as(s, "u-lucas"), action);
      expect(next.tasks.find((t) => t.id === brand.id)!.projectId).toBe("p-brand");
    }
  });

  it("derives subtask permissions from the parent, not the supplied projectId", () => {
    const s = seed();
    const parent = taskIn(s, "p-website"); // lucas: viewer
    const next = reducer(as(s, "u-lucas"), {
      type: "task/create",
      patch: { name: "sneaky subtask", parentId: parent.id },
    });
    expect(next.tasks.some((t) => t.name === "sneaky subtask")).toBe(false);
  });

  it("lets authors delete their own comments but not other people's", () => {
    let s = seed();
    const task = taskIn(s, "p-atlas");
    s = reducer(as(s, "u-hana"), { type: "comment/create", taskId: task.id, text: "hana's note" });
    const hanaComment = s.comments.find((c) => c.text === "hana's note")!;
    s = reducer(as(s, "u-priya"), { type: "comment/create", taskId: task.id, text: "priya's note" });
    const priyaComment = s.comments.find((c) => c.text === "priya's note")!;
    // hana is only a commenter on atlas: cannot moderate priya's comment
    expect(reducer(as(s, "u-hana"), { type: "comment/delete", id: priyaComment.id }).comments)
      .toContainEqual(priyaComment);
    // ...but can delete her own
    expect(reducer(as(s, "u-hana"), { type: "comment/delete", id: hanaComment.id }).comments)
      .not.toContainEqual(hanaComment);
    // the workspace owner moderates anything
    expect(reducer(s, { type: "comment/delete", id: priyaComment.id }).comments)
      .not.toContainEqual(priyaComment);
  });

  it("lets commenters like and follow, but not edit", () => {
    const s = seed();
    const task = taskIn(s, "p-atlas"); // hana: commenter
    const liked = reducer(as(s, "u-hana"), { type: "task/toggleLike", id: task.id });
    expect(liked.tasks.find((t) => t.id === task.id)!.likeUserIds).toContain("u-hana");
    const renamed = reducer(as(s, "u-hana"), { type: "task/rename", id: task.id, name: "x" });
    expect(renamed.tasks.find((t) => t.id === task.id)!.name).toBe(task.name);
  });

  it("blocks guests from workspace objects", () => {
    const s = as(seed(), "u-lucas");
    const goal = s.goals[0];
    const tag = s.tags[0];
    expect(reducer(s, { type: "goal/delete", id: goal.id }).goals).toContainEqual(goal);
    expect(reducer(s, { type: "tag/delete", id: tag.id }).tags).toContainEqual(tag);
    expect(reducer(s, { type: "portfolio/create", name: "x" }).portfolios.length).toBe(s.portfolios.length);
    const tmpl = s.templates[0];
    expect(reducer(s, { type: "template/instantiate", templateId: tmpl.id, name: "x" }).projects.length)
      .toBe(s.projects.length);
  });

  it("never lets a template overwrite an existing project id", () => {
    const s = seed();
    const next = reducer(s, {
      type: "template/instantiate",
      templateId: s.templates[0].id,
      name: "Collide",
      projectId: "p-atlas",
    });
    expect(next.projects.filter((p) => p.id === "p-atlas")).toHaveLength(1);
  });

  it("scopes rule edits to the rule's own project (ruleId actions)", () => {
    const s = seed();
    const rule = s.rules.find((r) => r.projectId === "p-atlas")!;
    const next = reducer(as(s, "u-jordan"), {
      type: "rule/actionSet",
      ruleId: rule.id,
      action: { id: "evil", type: "complete", value: "" },
    });
    // jordan is an editor on atlas (public) so this is allowed; on the private
    // mobile project he has no access at all
    expect(next.rules.find((r) => r.id === rule.id)!.actions.some((a) => a.id === "evil")).toBe(true);
    const mobileRule = { ...rule, id: "r-mobile", projectId: "p-mobile" };
    const withMobile = { ...s, rules: [...s.rules, mobileRule] };
    const blocked = reducer(as(withMobile, "u-jordan"), {
      type: "rule/actionSet",
      ruleId: "r-mobile",
      action: { id: "evil", type: "complete", value: "" },
    });
    expect(blocked.rules.find((r) => r.id === "r-mobile")!.actions.some((a) => a.id === "evil")).toBe(false);
  });

  it("protects the owner role", () => {
    const s = seed();
    // admin cannot demote the owner or mint a new owner
    const a1 = reducer(as(s, "u-alex"), { type: "workspace/setRole", userId: "u-maya", role: "member" });
    expect(a1.users.find((u) => u.id === "u-maya")!.workspaceRole).toBe("owner");
    const a2 = reducer(as(s, "u-alex"), { type: "workspace/setRole", userId: "u-priya", role: "owner" });
    expect(a2.users.find((u) => u.id === "u-priya")!.workspaceRole).toBe("member");
    // nobody changes their own role (prevents the last owner locking everyone out)
    const self = reducer(s, { type: "workspace/setRole", userId: "u-maya", role: "member" });
    expect(self.users.find((u) => u.id === "u-maya")!.workspaceRole).toBe("owner");
    // owner can still administer
    const ok = reducer(s, { type: "workspace/setRole", userId: "u-priya", role: "admin" });
    expect(ok.users.find((u) => u.id === "u-priya")!.workspaceRole).toBe("admin");
  });

  it("does not redeem revoked invitations", () => {
    let s = reducer(seed(), { type: "invite/create", email: "eve@x.co", role: "member", projectIds: [] });
    const inv = s.invites[0];
    s = reducer(s, { type: "invite/revoke", id: inv.id });
    const accepted = reducer(s, { type: "invite/accept", id: inv.id });
    expect(accepted.users.some((u) => u.email === "eve@x.co")).toBe(false);
  });

  it("only admins can impersonate, and the real actor is remembered", () => {
    const s = seed();
    // a guest cannot become the owner
    const escalate = reducer(as(s, "u-lucas"), { type: "impersonate", userId: "u-maya" });
    expect(escalate.currentUserId).toBe("u-lucas");
    // owner views as guest, then returns
    const viewing = reducer(s, { type: "impersonate", userId: "u-lucas", reason: "Support ticket 4821" });
    expect(viewing.currentUserId).toBe("u-lucas");
    expect(viewing.impersonatorId).toBe("u-maya");
    // while impersonating a guest you can hop to another user (actor is still the owner)
    expect(reducer(viewing, { type: "impersonate", userId: "u-hana", reason: "Support ticket 4821" }).impersonatorId).toBe("u-maya");
    const back = reducer(viewing, { type: "impersonate", userId: "u-maya" });
    expect(back.currentUserId).toBe("u-maya");
    expect(back.impersonatorId).toBeNull();
  });

  it("default-denies unknown actions", () => {
    expect(authorize(seed(), { type: "nope" } as unknown as Action)).toBe(false);
  });
});

describe("RBAC: read scoping", () => {
  it("is the identity for owners and admins", () => {
    const s = seed();
    expect(scopeStateForViewer(s)).toBe(s);
    const admin = scopeStateForViewer(as(s, "u-alex"));
    // admins read every project and task (same references, no copying)
    expect(admin.projects).toBe(s.projects);
    expect(admin.tasks).toBe(s.tasks);
    expect(admin.comments).toBe(s.comments);
    expect(taskVisibility(as(s, "u-alex")).all).toBe(true);
  });

  it("hides private projects and everything hanging off them", () => {
    const s = as(seed(), "u-jordan");
    const scoped = scopeStateForViewer(s);
    const mobileTaskIds = new Set(s.tasks.filter((t) => t.projectId === "p-mobile").map((t) => t.id));
    expect(scoped.projects.some((p) => p.id === "p-mobile")).toBe(false);
    expect(scoped.sections.some((x) => x.projectId === "p-mobile")).toBe(false);
    expect(scoped.tasks.some((t) => t.projectId === "p-mobile" && t.assigneeId !== "u-jordan")).toBe(false);
    expect(scoped.comments.some((c) => mobileTaskIds.has(c.taskId))).toBe(false);
    expect(scoped.rules.some((r) => r.projectId === "p-mobile")).toBe(false);
  });

  it("limits guests to invited projects", () => {
    const scoped = scopeStateForViewer(as(seed(), "u-lucas"));
    const ids = scoped.projects.map((p) => p.id).sort();
    expect(ids).toEqual(["p-brand", "p-campaign", "p-website"]);
    expect(scoped.tasks.every((t) =>
      t.assigneeId === "u-lucas" || !t.projectId || ids.includes(t.projectId) ||
      // subtasks inherit from a visible parent
      scoped.tasks.some((p) => p.id === t.parentId)
    )).toBe(true);
    expect(scoped.tickets).toHaveLength(0);
    expect(scoped.invites).toHaveLength(0);
  });

  it("grounds AI chat answers in the caller's scope", () => {
    const s = as(seed(), "u-lucas");
    const next = reducer(s, { type: "chat/send", text: "What is the status of Mobile App v3?" });
    const reply = next.chatMessages[next.chatMessages.length - 1];
    expect(reply.citations.some((c) => c.id === "p-mobile")).toBe(false);
    expect(reply.text).not.toMatch(/Mobile App v3/);
  });
});

describe("data integrity", () => {
  it("cascades project deletes to every dependent collection", () => {
    const s = seed();
    const next = reducer(s, { type: "project/delete", id: "p-atlas" });
    const gone = new Set(s.tasks.filter((t) => t.projectId === "p-atlas").map((t) => t.id));
    expect(next.tasks.some((t) => gone.has(t.id) || t.projectId === "p-atlas")).toBe(false);
    expect(next.comments.some((c) => gone.has(c.taskId))).toBe(false);
    expect(next.notifications.some((n) => n.taskId && gone.has(n.taskId))).toBe(false);
    expect(next.goals.some((g) => g.projectIds.includes("p-atlas"))).toBe(false);
    expect(next.portfolios.some((p) => p.projectIds.includes("p-atlas"))).toBe(false);
    expect(next.forms.some((f) => f.projectId === "p-atlas")).toBe(false);
    expect(next.recentlyViewed.some((v) => v.id === "p-atlas")).toBe(false);
    expect(next.tasks.some((t) => t.blockedByIds.some((id) => gone.has(id)) || t.blockingIds.some((id) => gone.has(id)))).toBe(false);
  });

  it("refuses to delete a project's last section", () => {
    let s = seed();
    s = reducer(s, { type: "project/create", project: { id: "p-x", name: "X" } });
    const secs = s.sections.filter((x) => x.projectId === "p-x");
    s = run(s, ...secs.slice(1).map((x): Action => ({ type: "section/delete", id: x.id })));
    const last = reducer(s, { type: "section/delete", id: secs[0].id });
    expect(last.sections.some((x) => x.id === secs[0].id)).toBe(true);
  });

  it("does not copy one-sided dependencies when duplicating", () => {
    const s = seed();
    const blocked = s.tasks.find((t) => t.blockedByIds.length > 0)!;
    const next = reducer(s, { type: "task/duplicate", id: blocked.id });
    const copy = next.tasks[next.tasks.length - 1];
    expect(copy.blockedByIds).toEqual([]);
  });

  it("caps append-only collections", () => {
    let s = seed();
    const task = taskIn(s, "p-atlas");
    s = { ...s, activities: Array.from({ length: LIMITS.activities + 50 }, (_, i) => ({ ...s.activities[0], id: `a${i}` })) };
    s = reducer(s, { type: "task/rename", id: task.id, name: "x" });
    expect(s.activities.length).toBeLessThanOrEqual(LIMITS.activities);
  });

  it("hydrates old snapshots by filling missing collections and ui keys", () => {
    const s = seed();
    const legacy = { ...s, invites: undefined, savedViews: "corrupt", ui: { theme: "dark" } };
    const loaded = hydrate(JSON.stringify(legacy));
    expect(Array.isArray(loaded.invites)).toBe(true);
    expect(Array.isArray(loaded.savedViews)).toBe(true);
    expect(loaded.ui.theme).toBe("dark");
    expect(loaded.ui.showCompleted).toBe(s.ui.showCompleted);
    expect(hydrate("{not json").tasks.length).toBe(s.tasks.length);
    expect(hydrate(null).currentUserId).toBe("u-maya");
  });

  it("migrates legacy impersonation snapshots so the user can return", () => {
    const legacy = { ...seed(), currentUserId: "u-lucas" };
    delete (legacy as Partial<AppState>).impersonatorId;
    expect(hydrate(JSON.stringify(legacy)).impersonatorId).toBe("u-maya");
  });
});

describe("AI chat privacy", () => {
  it("keeps chat history private to its owner, even from admins", () => {
    const s = seed();
    expect(scopeStateForViewer(as(s, "u-lucas")).chatThreads).toHaveLength(0);
    expect(scopeStateForViewer(as(s, "u-lucas")).chatMessages).toHaveLength(0);
    expect(scopeStateForViewer(as(s, "u-alex")).chatMessages).toHaveLength(0);
    expect(scopeStateForViewer(s).chatThreads.length).toBe(s.chatThreads.length);
  });

  it("starts a fresh thread instead of appending to someone else's", () => {
    const s = as(seed(), "u-priya");
    const next = reducer(s, { type: "chat/send", text: "what is overdue?" });
    const mine = next.chatThreads.filter((t) => t.ownerId === "u-priya");
    expect(mine).toHaveLength(1);
    expect(next.chatMessages.filter((m) => m.threadId === "thread-1").length)
      .toBe(s.chatMessages.filter((m) => m.threadId === "thread-1").length);
    expect(reducer(s, { type: "chat/selectThread", id: "thread-1" }).activeThreadId).toBe(s.activeThreadId);
  });
});
