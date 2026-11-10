/**
 * Pure workspace engine: actions, authorization, the reducer and hydration.
 * No React, no DOM — imported by the browser store *and* the server, so both
 * enforce exactly the same rules.
 */
import type {
  Client,
  ClientNote,
  DevSettings,
  SecurityPolicy,
  TableView,
  ApprovalStatus,
  AuditEntry,
  Activity,
  ActivityType,
  AgentRun,
  AgentSession,
  ProjectRole,
  RecordTable,
  SavedView,
  ServiceTicket,
  Ticket,
  WorkspaceRole,
  AppState,
  ChatMessage,
  Comment,
  FieldDef,
  Goal,
  ID,
  Meeting,
  Notification,
  Portfolio,
  Project,
  Rule,
  RuleAction,
  RuleTriggerType,
  Section,
  Tag,
  Task,
  UIState,
  User,
} from "./types";
import { createSeedState } from "./seed";
import { DEFAULT_DEV_SETTINGS, DEFAULT_SECURITY } from "./seed-v3";
import {
  addDays,
  addMonths,
  diffDays,
  needsRebalance,
  orderBetween,
  rebalance,
  todayISO,
  uid,
} from "./utils";
import { dependentShifts } from "./schedule";
import { applyRules, nowStamp, pushActivity, runScheduledRules } from "./rules";
import { scanTaskForInjection } from "./aiGuard";
import { TEXT_LIMITS, clampText, isEmail, sanitizeState } from "./validate";
import {
  AGENT_STEP_SCOPE,
  agentCan,
  can as canPermission,
  canEditTask,
  canImpersonate,
  effectiveProjectRole,
  scopeStateForViewer,
  threadOwner,
  type Permission,
} from "./rbac";
import {
  AGENT_AUTH_SCOPES,
  agentComment,
  agentPlan,
  agentSubtasks,
  answerQuestion,
  draftStatusUpdate,
  parseTaskDraft,
} from "./ai";

/* =========================================================== actions */
export type Action =
  | { type: "task/create"; patch: Partial<Task> & { name: string }; silent?: boolean }
  | { type: "task/update"; id: ID; patch: Partial<Task>; silent?: boolean }
  | { type: "task/rename"; id: ID; name: string }
  | { type: "task/delete"; id: ID }
  | { type: "task/toggleComplete"; id: ID; value?: boolean }
  | {
      type: "task/move";
      id: ID;
      projectId?: ID | null;
      sectionId?: ID | null;
      beforeId?: ID | null;
    }
  | { type: "task/setField"; id: ID; fieldId: ID; value: unknown }
  | { type: "task/setPriority"; id: ID; priority: Task["priority"] }
  | { type: "task/setDue"; id: ID; dueDate: string | null; dueTime?: string | null }
  | { type: "task/setAssignee"; id: ID; userId: ID | null }
  | { type: "task/toggleTag"; id: ID; tagId: ID }
  | { type: "task/toggleFollower"; id: ID; userId: ID }
  | { type: "task/toggleLike"; id: ID }
  | { type: "task/toggleDependency"; id: ID; otherId: ID; kind: "blocked-by" | "blocking" }
  | { type: "task/duplicate"; id: ID }
  | { type: "task/decide"; id: ID; decision: Exclude<ApprovalStatus, "pending">; note?: string }
  | { type: "audit/denied"; attempted: Action["type"] }
  | { type: "tasks/bulk"; ids: ID[]; patch: Partial<Task> }
  | { type: "tasks/delete"; ids: ID[] }
  | { type: "section/create"; projectId: ID; name: string; afterId?: ID }
  | { type: "section/update"; id: ID; patch: Partial<Section> }
  | { type: "section/delete"; id: ID }
  | { type: "section/move"; id: ID; beforeId: ID | null }
  | { type: "project/create"; project: Partial<Project> & { name: string } }
  | { type: "project/update"; id: ID; patch: Partial<Project> }
  | { type: "project/delete"; id: ID }
  | { type: "project/toggleStar"; id: ID }
  | { type: "project/addMember"; id: ID; userId: ID }
  | { type: "status/create"; projectId: ID; title: string; text: string; state: Project["status"]["state"] }
  | { type: "comment/create"; taskId: ID; text: string }
  | { type: "comment/delete"; id: ID }
  | { type: "comment/like"; id: ID }
  | { type: "tag/create"; name: string; color: Tag["color"] }
  | { type: "tag/delete"; id: ID }
  | { type: "field/create"; field: Omit<FieldDef, "id" | "createdBy"> }
  | { type: "field/delete"; id: ID }
  | { type: "goal/create"; name: string; patch?: Partial<Goal> }
  | { type: "goal/update"; id: ID; patch: Partial<Goal> }
  | { type: "goal/delete"; id: ID }
  | { type: "portfolio/create"; name: string }
  | { type: "portfolio/update"; id: ID; patch: Partial<Portfolio> }
  | { type: "rule/create"; projectId: ID; name: string }
  | { type: "rule/update"; id: ID; patch: Partial<Rule> }
  | { type: "rule/delete"; id: ID }
  | { type: "rule/toggle"; id: ID }
  | { type: "rule/actionSet"; ruleId: ID; action: RuleAction }
  | { type: "rule/actionRemove"; ruleId: ID; actionId: ID }
  | { type: "agent/create"; patch: Partial<User> }
  | { type: "agent/update"; id: ID; patch: Partial<User> }
  | { type: "agent/toggle"; id: ID }
  | { type: "agent/runStart"; teammateId: ID; taskId: ID; kind?: "task" }
  | { type: "agent/runAdvance"; runId: ID }
  | { type: "agent/runCancel"; runId: ID }
  | { type: "chat/send"; text: string }
  | { type: "chat/newThread" }
  | { type: "chat/selectThread"; id: ID }
  | { type: "meeting/actionToTask"; meetingId: ID; actionItemId: ID }
  | {
      type: "form/submit";
      projectId: ID;
      values: Record<string, string | string[] | boolean>;
      /** set by the server for anonymous submissions through a public link */
      viaPublicLink?: boolean;
    }
  | { type: "template/instantiate"; templateId: ID; name: string; projectId?: ID }
  | { type: "meeting/create"; title: string }
  | { type: "form/update"; id: ID; patch: Partial<import("./types").ProjectForm> }
  | { type: "ticket/create"; spaceId: ID; title: string; description?: string }
  | { type: "ticket/update"; id: ID; patch: Partial<Ticket> }
  | { type: "session/start"; teammateId: ID; ticketId: ID | null; taskId: ID | null; prompt: string }
  | { type: "session/advance"; id: ID }
  | { type: "session/stop"; id: ID }
  | { type: "release/update"; id: ID; patch: Partial<import("./types").Release> }
  | { type: "service/update"; id: ID; patch: Partial<ServiceTicket> }
  | { type: "portal/publish"; id: ID }
  | { type: "portal/toggleProject"; id: ID; projectId: ID }
  | { type: "page/create"; title: string; parentId?: ID | null }
  | { type: "page/update"; id: ID; patch: Partial<import("./types").DocPage> }
  | { type: "table/recordAdd"; tableId: ID }
  | { type: "table/recordUpdate"; tableId: ID; recordId: ID; fieldId: ID; value: string }
  | { type: "savedView/create"; projectId: ID; name: string; view: SavedView["view"]; filters: Record<string, unknown>; sortKey: string; sortDir: "asc" | "desc" }
  | { type: "savedView/delete"; id: ID }
  | { type: "workspace/setRole"; userId: ID; role: WorkspaceRole }
  | { type: "project/setRole"; projectId: ID; userId: ID; role: ProjectRole }
  | { type: "project/removeMember"; projectId: ID; userId: ID }
  | { type: "invite/create"; email: string; role: WorkspaceRole; projectIds: ID[] }
  | { type: "invite/revoke"; id: ID }
  | { type: "invite/accept"; id: ID }
  | { type: "impersonate"; userId: ID; reason?: string }
  | { type: "agent/runApprove"; runId: ID }
  | { type: "agent/runRevert"; runId: ID }
  | { type: "task/fromTemplate"; templateId: ID; sectionId?: ID | null; name?: string }
  | { type: "taskTemplate/create"; name: string; fromTaskId: ID }
  | { type: "taskTemplate/delete"; id: ID }
  | { type: "rules/tick"; now: string }
  | { type: "message/post"; projectId: ID; text: string }
  | { type: "message/delete"; id: ID }
  | { type: "page/move"; id: ID; parentId: ID | null }
  | { type: "page/delete"; id: ID }
  | { type: "table/viewSave"; tableId: ID; view: TableView }
  | { type: "table/viewDelete"; tableId: ID; viewId: ID }
  | { type: "devSpace/settings"; spaceId: ID; patch: Partial<DevSettings> }
  | { type: "release/generateNotes"; id: ID }
  | { type: "client/update"; id: ID; patch: Partial<Pick<Client, "stage" | "ownerId" | "health">> }
  | { type: "clientNote/add"; clientId: ID; kind: ClientNote["kind"]; text: string }
  | { type: "clientNote/delete"; id: ID }
  | { type: "user/setCapacity"; userId: ID; hours: number }
  | { type: "workspace/security"; patch: Partial<SecurityPolicy> }
  | { type: "data/import"; state: AppState }
  | { type: "form/create"; projectId: ID }
  | { type: "notification/read"; id: ID }
  | { type: "notification/readAll" }
  | { type: "ui/patch"; patch: Partial<UIState> }
  | { type: "view/visit"; kind: "project" | "task"; id: ID }
  | { type: "state/load"; state: AppState }
  | { type: "state/replace"; state: AppState };

/* ============================================================ helpers */
function nextTaskOrder(tasks: Task[], sectionId: ID | null): number {
  const siblings = tasks
    .filter((t) => t.sectionId === sectionId && !t.parentId)
    .sort((a, b) => a.order - b.order);
  const last = siblings[siblings.length - 1];
  return last ? last.order + 1000 : 1000;
}

function projectsAndSections(state: AppState, taskId: ID) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return { projectId: null as ID | null, sectionId: null as ID | null };
  return { projectId: task.projectId, sectionId: task.sectionId };
}

function reorderList(tasks: Task[], sectionId: ID): Task[] {
  const inSection = tasks.filter((t) => t.sectionId === sectionId && !t.parentId);
  if (!needsRebalance(inSection.map((t) => t.order))) return tasks;
  const balanced = new Map(rebalance(inSection).map((t) => [t.id, t.order]));
  return tasks.map((t) =>
    balanced.has(t.id) ? { ...t, order: balanced.get(t.id) as number } : t
  );
}

/* ============================================================ reducer */

/**
 * Authorization gate for every mutation. Returns true when the current user
 * may perform `action` against `state`. Mirrored in the UI through `can()`;
 * this is the enforcement point, the UI is only a hint.
 *
 * Rules of thumb:
 *  - project-scoped writes resolve the project from the *stored* entity, never
 *    from ids supplied in the action, and check every id in bulk actions;
 *  - moving work into another project also needs `task:create` there;
 *  - workspace-level writes need the matching workspace role.
 */
/** Editors may turn a task into an approval (or back), but never decide one. */
function approvalPatchOk(patch: Partial<Task>): boolean {
  if ("approvals" in patch) return false; // votes only come from task/decide
  if (!("approvalStatus" in patch)) return true;
  return patch.approvalStatus === undefined || patch.approvalStatus === "pending";
}

/** Approvers for an approval task: explicit list, else the assignee. */
export function approversOf(task: Task): ID[] {
  if (task.approverIds?.length) return task.approverIds;
  return task.assigneeId ? [task.assigneeId] : [];
}

/** Aggregate votes into a status. */
export function approvalOutcome(task: Task, votes: Task["approvals"] = task.approvals): ApprovalStatus {
  const list = votes ?? [];
  if (list.some((v) => v.decision === "rejected")) return "rejected";
  if (list.some((v) => v.decision === "changes-requested")) return "changes-requested";
  const approvers = approversOf(task);
  const needed = Math.min(Math.max(1, task.approvalsRequired ?? approvers.length), Math.max(1, approvers.length));
  return list.filter((v) => v.decision === "approved").length >= needed ? "approved" : "pending";
}

/** Notifications created before recipients existed belong to the seed owner. */
export const LEGACY_RECIPIENT = "u-maya";

export function authorize(state: AppState, action: Action): boolean {
  const me = state.currentUserId;
  const allowed = (permission: Permission, projectId?: ID | null) =>
    canPermission(state, permission, { projectId: projectId ?? null });
  const taskById = (id: ID | null | undefined) =>
    id ? state.tasks.find((t) => t.id === id) : undefined;
  const onTask = (id: ID, permission: Permission) => {
    const task = taskById(id);
    return !!task && allowed(permission, task.projectId);
  };
  const canRetarget = (task: Task, projectId: ID | null | undefined) =>
    projectId === undefined || projectId === task.projectId || allowed("task:create", projectId);
  const isAdmin = allowed("workspace:admin");

  switch (action.type) {
    /* ---- tasks */
    case "task/create": {
      if (action.patch.id && state.tasks.some((t) => t.id === action.patch.id)) return false;
      const parent = taskById(action.patch.parentId);
      if (action.patch.parentId && !parent) return false;
      // subtasks inherit their parent's project for permission purposes
      const projectId = action.patch.projectId ?? parent?.projectId ?? null;
      if (parent && !allowed("task:edit", parent.projectId)) return false;
      return allowed("task:create", projectId);
    }
    case "task/update": {
      const task = taskById(action.id);
      return (
        !!task &&
        allowed("task:edit", task.projectId) &&
        canRetarget(task, action.patch.projectId) &&
        approvalPatchOk(action.patch)
      );
    }
    case "task/decide": {
      // only a named approver decides (once), and commenter access is enough
      const task = taskById(action.id);
      return (
        !!task &&
        task.approvalStatus === "pending" &&
        approversOf(task).includes(me) &&
        !(task.approvals ?? []).some((v) => v.userId === me) &&
        allowed("comment:create", task.projectId)
      );
    }
    case "task/move": {
      const task = taskById(action.id);
      return !!task && allowed("task:edit", task.projectId) && canRetarget(task, action.projectId);
    }
    case "task/rename":
    case "task/setField":
    case "task/setPriority":
    case "task/setDue":
    case "task/setAssignee":
    case "task/toggleTag":
    case "task/duplicate":
      return onTask(action.id, "task:edit");
    case "task/toggleComplete": {
      // approval tasks are completed by a decision, never by ticking the box
      const task = taskById(action.id);
      const value = action.value ?? !task?.completed;
      if (task?.approvalStatus && value) return false;
      return onTask(action.id, "task:edit");
    }
    case "task/toggleDependency":
      // editing one side of the link; the other task only needs to be visible
      return onTask(action.id, "task:edit") && onTask(action.otherId, "project:read");
    case "task/toggleLike":
      return onTask(action.id, "comment:create");
    case "task/toggleFollower":
      // following yourself is a commenter-level action; adding others is an edit
      return onTask(action.id, action.userId === me ? "comment:create" : "task:edit");
    case "task/delete":
      return onTask(action.id, "task:delete");
    case "tasks/bulk":
      return (
        action.ids.length > 0 &&
        action.ids.every((id) => {
          const task = taskById(id);
          return !!task && allowed("task:edit", task.projectId) && canRetarget(task, action.patch.projectId);
        }) &&
        approvalPatchOk(action.patch)
      );
    case "tasks/delete":
      return action.ids.length > 0 && action.ids.every((id) => onTask(id, "task:delete"));

    /* ---- sections */
    case "section/create":
      return allowed("task:create", action.projectId);
    case "section/update":
    case "section/delete":
    case "section/move": {
      const section = state.sections.find((s) => s.id === action.id);
      return !!section && allowed("task:edit", section.projectId);
    }

    /* ---- comments */
    case "comment/create":
      return onTask(action.taskId, "comment:create");
    case "comment/like": {
      const comment = state.comments.find((c) => c.id === action.id);
      return !!comment && onTask(comment.taskId, "comment:create");
    }
    case "comment/delete": {
      const comment = state.comments.find((c) => c.id === action.id);
      if (!comment) return false;
      // authors may delete their own comments; project owners moderate the rest
      return comment.authorId === me
        ? onTask(comment.taskId, "project:read")
        : onTask(comment.taskId, "project:update");
    }

    /* ---- projects */
    case "project/create":
      if (action.project.id && state.projects.some((p) => p.id === action.project.id)) return false;
      return allowed("project:create");
    case "template/instantiate":
      return (
        allowed("project:create") &&
        (!action.projectId || !state.projects.some((p) => p.id === action.projectId))
      );
    case "project/update":
      return allowed("project:update", action.id);
    case "project/toggleStar":
      return allowed("project:read", action.id);
    case "project/addMember":
      return allowed("project:share", action.id) && state.users.some((u) => u.id === action.userId);
    case "project/setRole":
    case "project/removeMember":
      return (
        allowed("project:share", action.projectId) && state.users.some((u) => u.id === action.userId)
      );
    case "project/delete":
      return allowed("project:delete", action.id);
    case "status/create":
      return allowed("task:edit", action.projectId);
    case "form/update": {
      const form = state.forms.find((f) => f.id === action.id);
      return !!form && allowed("form:manage", form.projectId);
    }
    case "form/create":
      return allowed("form:manage", action.projectId) && !state.forms.some((f) => f.projectId === action.projectId);
    case "form/submit":
      // intake forms are open to workspace members and to anyone who can see the project
      return allowed("project:read", action.projectId) || allowed("project:create");
    case "savedView/create":
      return allowed("project:read", action.projectId) && allowed("task:edit");
    case "savedView/delete": {
      const view = state.savedViews.find((v) => v.id === action.id);
      return !!view && (view.createdBy === me || allowed("project:update", view.projectId));
    }

    /* ---- automations */
    case "rule/create":
      return allowed("rule:manage", action.projectId);
    case "rule/update":
    case "rule/delete":
    case "rule/toggle":
    case "rule/actionSet":
    case "rule/actionRemove": {
      const ruleId = "ruleId" in action ? action.ruleId : action.id;
      const rule = state.rules.find((r) => r.id === ruleId);
      return !!rule && allowed("rule:manage", rule.projectId);
    }

    /* ---- workspace objects */
    case "tag/create":
      return allowed("task:edit");
    case "tag/delete":
    case "field/create":
    case "field/delete":
      return isAdmin;
    case "goal/create":
    case "portfolio/create":
    case "meeting/create":
      return allowed("project:create");
    case "goal/update":
      return allowed("project:create") && state.goals.some((g) => g.id === action.id);
    case "goal/delete": {
      const goal = state.goals.find((g) => g.id === action.id);
      return !!goal && (goal.ownerId === me || isAdmin);
    }
    case "portfolio/update": {
      const pf = state.portfolios.find((p) => p.id === action.id);
      return !!pf && (pf.ownerId === me || pf.memberIds.includes(me) || isAdmin);
    }
    case "meeting/actionToTask": {
      const meeting = state.meetings.find((m) => m.id === action.meetingId);
      const item = meeting?.actionItems.find((a) => a.id === action.actionItemId);
      return !!item && allowed("task:create", item.projectId ?? meeting?.projectId ?? null);
    }

    /* ---- AI teammates */
    case "agent/create":
    case "agent/update":
    case "agent/toggle":
      return allowed("agent:manage");
    case "agent/runStart":
      return onTask(action.taskId, "task:edit");
    case "agent/runCancel": {
      const run = state.agentRuns.find((r) => r.id === action.runId);
      return !!run && (run.taskId ? onTask(run.taskId, "task:edit") : allowed("task:edit"));
    }

    /* ---- workspace administration */
    case "workspace/setRole": {
      if (!isAdmin) return false;
      const target = state.users.find((u) => u.id === action.userId);
      if (!target || target.isAgent || target.id === me) return false;
      const myRole = state.users.find((u) => u.id === me)?.workspaceRole;
      const touchesOwner = action.role === "owner" || target.workspaceRole === "owner";
      if (touchesOwner && myRole !== "owner") return false; // only owners mint or demote owners
      return true;
    }
    case "invite/create": {
      const domains = state.security?.inviteDomains ?? [];
      const domain = action.email.split("@")[1] ?? "";
      if (domains.length && !domains.includes(domain)) return false;
      return allowed("workspace:invite") && (action.role !== "owner" || allowed("billing:manage"));
    }
    case "invite/revoke":
      return allowed("workspace:invite");
    case "impersonate": {
      const actor = state.impersonatorId ?? state.currentUserId;
      const starting = action.userId !== actor;
      // starting a "View as" session requires a stated reason
      if (starting && (action.reason ?? "").trim().length < 3) return false;
      return canImpersonate(state, action.userId);
    }
    case "workspace/security":
      return isAdmin;
    case "data/import":
      return allowed("billing:manage"); // owners only

    /* ---- AI teammate review */
    case "agent/runApprove":
    case "agent/runRevert": {
      const run = state.agentRuns.find((r) => r.id === action.runId);
      if (!run) return false;
      return run.taskId ? onTask(run.taskId, "task:edit") : allowed("agent:manage");
    }

    /* ---- templates, messages, workload */
    case "task/fromTemplate": {
      const tpl = state.taskTemplates.find((t) => t.id === action.templateId);
      if (!tpl) return false;
      if (action.sectionId && !state.sections.some((x) => x.id === action.sectionId && x.projectId === tpl.projectId)) return false;
      return allowed("task:create", tpl.projectId);
    }
    case "taskTemplate/create":
      return onTask(action.fromTaskId, "task:edit") && !!taskById(action.fromTaskId)?.projectId;
    case "taskTemplate/delete": {
      const tpl = state.taskTemplates.find((t) => t.id === action.id);
      return !!tpl && allowed("task:edit", tpl.projectId);
    }
    case "message/post":
      return allowed("comment:create", action.projectId);
    case "message/delete": {
      const m = state.messages.find((x) => x.id === action.id);
      if (!m) return false;
      return m.authorId === me ? allowed("project:read", m.projectId) : allowed("project:update", m.projectId);
    }
    case "user/setCapacity":
      return (
        Number.isFinite(action.hours) &&
        action.hours >= 0 &&
        action.hours <= 80 &&
        state.users.some((u) => u.id === action.userId && !u.isAgent) &&
        (action.userId === me || isAdmin)
      );

    /* ---- pages, tables, dev, CRM */
    case "page/move": {
      const page = state.pages.find((p) => p.id === action.id);
      if (!page || !allowed("task:edit")) return false;
      if (action.parentId) {
        // no cycles: the new parent may not be the page or one of its descendants
        let cursor: ID | null | undefined = action.parentId;
        for (let i = 0; cursor && i < 64; i++) {
          if (cursor === page.id) return false;
          cursor = state.pages.find((p) => p.id === cursor)?.parentId ?? null;
        }
        if (!state.pages.some((p) => p.id === action.parentId)) return false;
      }
      return true;
    }
    case "page/delete": {
      const page = state.pages.find((p) => p.id === action.id);
      return !!page && (page.authorId === me || isAdmin);
    }
    case "table/viewSave":
    case "table/viewDelete":
      return allowed("task:edit") && state.tables.some((t) => t.id === action.tableId);
    case "devSpace/settings": {
      const space = state.devSpaces.find((d) => d.id === action.spaceId);
      return !!space && allowed("task:edit") && (space.memberIds.includes(me) || isAdmin);
    }
    case "release/generateNotes":
      return allowed("task:edit") && state.releases.some((r) => r.id === action.id);
    case "client/update":
    case "clientNote/add":
      return allowed("task:edit");
    case "clientNote/delete": {
      const note = state.clientNotes.find((n) => n.id === action.id);
      return !!note && (note.authorId === me || isAdmin);
    }

    /* ---- dev / ops surfaces: workspace members, not guests */
    case "ticket/create":
    case "ticket/update":
    case "session/start":
    case "session/stop":
    case "release/update":
    case "page/create":
    case "page/update":
    case "table/recordAdd":
    case "table/recordUpdate":
    case "service/update":
    case "portal/publish":
    case "portal/toggleProject":
      return allowed("task:edit");

    case "chat/selectThread": {
      const thread = state.chatThreads.find((t) => t.id === action.id);
      return !!thread && threadOwner(thread) === me;
    }

    case "notification/read": {
      const n = state.notifications.find((x) => x.id === action.id);
      return !!n && (n.recipientId ?? LEGACY_RECIPIENT) === me;
    }

    /* ---- system, navigation and per-user state */
    case "agent/runAdvance": // driven by the runner timer, not by the user
    case "session/advance":
    case "invite/accept": // validated in the reducer (must be a live invite)
    case "audit/denied": // records a refused attempt by the current identity
    case "chat/send": // answers are grounded in the caller's scoped state
    case "chat/newThread":
    case "rules/tick": // clock-driven; the server refuses it from clients
    case "notification/readAll":
    case "ui/patch":
    case "view/visit":
    case "state/load":
    case "state/replace":
      return true;
  }
  return false; // default-deny anything not listed above
}

/** Bounds for append-only collections so persisted state stays well under quota. */
export const LIMITS = { activities: 1500, notifications: 250, agentRuns: 60, chatMessages: 400 };

function enforceLimits(state: AppState): AppState {
  if (
    state.activities.length <= LIMITS.activities &&
    state.notifications.length <= LIMITS.notifications
  ) {
    return state;
  }
  // both collections are newest-first
  return {
    ...state,
    activities: state.activities.slice(0, LIMITS.activities),
    notifications: state.notifications.slice(0, LIMITS.notifications),
  };
}

export function reducer(state: AppState, action: Action): AppState {
  const normalized = normalizeAction(action);
  if (!normalized || !authorize(state, normalized)) return state;
  const next = apply(state, normalized);
  if (next === state) return state;
  return enforceLimits(recordAudit(state, next, normalized));
}

/* ------------------------------------------------------- input limits */

/**
 * Trim and clamp user text before it reaches state. Returns null for actions
 * that would create something with an empty name or an invalid address.
 */
function normalizeAction(action: Action): Action | null {
  const L = TEXT_LIMITS;
  const name = (v: string) => clampText(v, L.name).trim();
  switch (action.type) {
    case "task/create": {
      const n = name(action.patch.name);
      if (!n) return null;
      const patch = { ...action.patch, name: n };
      if (patch.notes !== undefined) patch.notes = clampText(patch.notes, L.body);
      return { ...action, patch };
    }
    case "task/update":
    case "tasks/bulk": {
      // updates are often dispatched per keystroke: clamp, never trim
      const patch = { ...action.patch };
      if (patch.name !== undefined) patch.name = clampText(patch.name, L.name);
      if (patch.notes !== undefined) patch.notes = clampText(patch.notes, L.body);
      return { ...action, patch } as Action;
    }
    case "task/rename": {
      const n = name(action.name);
      return n ? { ...action, name: n } : null;
    }
    case "task/decide":
      return { ...action, note: action.note === undefined ? undefined : clampText(action.note, L.comment).trim() };
    case "comment/create": {
      const text = clampText(action.text, L.comment).trim();
      return text ? { ...action, text } : null;
    }
    case "chat/send": {
      const text = clampText(action.text, L.chat).trim();
      return text ? { ...action, text } : null;
    }
    case "message/post": {
      const text = clampText(action.text, L.comment).trim();
      return text ? { ...action, text } : null;
    }
    case "taskTemplate/create":
      return { ...action, name: clampText(action.name, L.title).trim() };
    case "impersonate":
      return { ...action, reason: action.reason === undefined ? undefined : clampText(action.reason, L.title) };
    case "section/create":
    case "tag/create":
    case "goal/create":
    case "portfolio/create":
    case "rule/create": {
      const n = clampText(action.name, L.title).trim();
      return n ? ({ ...action, name: n } as Action) : null;
    }
    case "section/update":
    case "goal/update":
    case "portfolio/update":
    case "rule/update": {
      const patch = { ...action.patch } as { name?: string; description?: string };
      if (patch.name !== undefined) patch.name = clampText(patch.name, L.title);
      if (patch.description !== undefined) patch.description = clampText(patch.description, L.body);
      return { ...action, patch } as Action;
    }
    case "project/create": {
      const n = clampText(action.project.name, L.title).trim();
      if (!n) return null;
      return {
        ...action,
        project: {
          ...action.project,
          name: n,
          description: action.project.description === undefined ? undefined : clampText(action.project.description, L.body),
        },
      };
    }
    case "project/update": {
      const patch = { ...action.patch };
      if (patch.name !== undefined) patch.name = clampText(patch.name, L.title);
      if (patch.description !== undefined) patch.description = clampText(patch.description, L.body);
      return { ...action, patch };
    }
    case "status/create":
      return { ...action, title: clampText(action.title, L.title), text: clampText(action.text, L.body) };
    case "page/create":
    case "meeting/create":
      return { ...action, title: clampText(action.title, L.title).trim() || "Untitled" };
    case "page/update": {
      const patch = { ...action.patch };
      if (patch.title !== undefined) patch.title = clampText(patch.title, L.title);
      if (patch.body !== undefined) patch.body = clampText(patch.body, L.body);
      return { ...action, patch };
    }
    case "ticket/create": {
      const title = clampText(action.title, L.title).trim();
      return title ? { ...action, title, description: clampText(action.description ?? "", L.body) } : null;
    }
    case "template/instantiate": {
      const n = clampText(action.name, L.title).trim();
      return n ? { ...action, name: n } : null;
    }
    case "savedView/create": {
      const n = clampText(action.name, L.title).trim();
      return n ? { ...action, name: n } : null;
    }
    case "table/recordUpdate":
      return { ...action, value: clampText(action.value, L.name) };
    case "invite/create": {
      const email = action.email.trim().toLowerCase();
      return isEmail(email) ? { ...action, email } : null;
    }
    case "form/submit": {
      const values: typeof action.values = {};
      for (const [k, v] of Object.entries(action.values)) {
        values[k] = typeof v === "string" ? clampText(v, L.body) : Array.isArray(v) ? v.map((x) => clampText(x, L.name)) : v;
      }
      return { ...action, values };
    }
    case "agent/create":
    case "agent/update": {
      const patch = { ...action.patch };
      if (patch.name !== undefined) patch.name = action.type === "agent/create" ? clampText(patch.name, L.title).trim() || "AI teammate" : clampText(patch.name, L.title);
      if (patch.instructions !== undefined) patch.instructions = clampText(patch.instructions, L.body);
      return { ...action, patch } as Action;
    }
    default:
      return action;
  }
}

/* ---------------------------------------------------------- audit log */
const AUDIT_LIMIT = 1000;
const AUDITED = new Set<Action["type"]>([
  "workspace/setRole",
  "project/setRole",
  "project/addMember",
  "project/removeMember",
  "project/delete",
  "project/update",
  "task/delete",
  "tasks/delete",
  "task/decide",
  "invite/create",
  "invite/revoke",
  "invite/accept",
  "impersonate",
  "agent/create",
  "agent/update",
  "agent/toggle",
  "field/delete",
  "tag/delete",
  "rule/delete",
  "goal/delete",
  "audit/denied",
  "workspace/security",
  "data/import",
  "agent/runRevert",
  "agent/runApprove",
  "page/delete",
  "user/setCapacity",
]);

function describeAudit(state: AppState, action: Action): string | null {
  const userName = (id: ID | null | undefined) => state.users.find((u) => u.id === id)?.name ?? "someone";
  const projectName = (id: ID) => state.projects.find((p) => p.id === id)?.name ?? "a project";
  const taskName = (id: ID) => state.tasks.find((t) => t.id === id)?.name ?? "a task";
  switch (action.type) {
    case "workspace/setRole":
      return `Changed ${userName(action.userId)}'s workspace role to ${action.role}`;
    case "project/setRole":
      return `Set ${userName(action.userId)} as ${action.role} on ${projectName(action.projectId)}`;
    case "project/addMember":
      return `Added ${userName(action.userId)} to ${projectName(action.id)}`;
    case "project/removeMember":
      return `Removed ${userName(action.userId)} from ${projectName(action.projectId)}`;
    case "project/delete":
      return `Deleted project ${projectName(action.id)}`;
    case "project/update":
      // only privacy/sharing changes are security relevant
      return action.patch.privacy ? `Made ${projectName(action.id)} ${action.patch.privacy}` : null;
    case "task/delete":
      return `Deleted task “${taskName(action.id)}”`;
    case "tasks/delete":
      return `Deleted ${action.ids.length} task${action.ids.length === 1 ? "" : "s"}`;
    case "task/decide":
      return `${action.decision === "approved" ? "Approved" : action.decision === "rejected" ? "Rejected" : "Requested changes on"} “${taskName(action.id)}”`;
    case "invite/create":
      return `Invited ${action.email} as ${action.role}`;
    case "invite/revoke":
      return `Revoked invitation for ${state.invites.find((i) => i.id === action.id)?.email ?? "someone"}`;
    case "invite/accept":
      return `${state.invites.find((i) => i.id === action.id)?.email ?? "Someone"} accepted an invitation`;
    case "impersonate": {
      const actor = state.impersonatorId ?? state.currentUserId;
      return action.userId === actor
        ? `${userName(actor)} stopped viewing as ${userName(state.currentUserId)}`
        : `${userName(actor)} started viewing as ${userName(action.userId)} — reason: ${action.reason?.trim() ?? ""}`;
    }
    case "agent/create":
      return `Created AI teammate ${action.patch.name ?? "New AI teammate"}`;
    case "agent/update": {
      const p = action.patch;
      if (!p.authScopes && !p.projectIds && p.instructions === undefined) return null;
      const what = [p.authScopes && "permissions", p.projectIds && "projects", p.instructions !== undefined && "instructions"]
        .filter(Boolean)
        .join(", ");
      return `Changed ${userName(action.id)}'s ${what}`;
    }
    case "agent/toggle":
      return `${state.users.find((u) => u.id === action.id)?.agentStatus === "paused" ? "Resumed" : "Paused"} ${userName(action.id)}`;
    case "field/delete":
      return `Deleted custom field ${state.fields.find((f) => f.id === action.id)?.name ?? ""}`.trim();
    case "tag/delete":
      return `Deleted tag ${state.tags.find((t) => t.id === action.id)?.name ?? ""}`.trim();
    case "rule/delete":
      return `Deleted rule “${state.rules.find((r) => r.id === action.id)?.name ?? ""}”`;
    case "goal/delete":
      return `Deleted goal “${state.goals.find((g) => g.id === action.id)?.name ?? ""}”`;
    case "audit/denied":
      return `Blocked an attempt to ${action.attempted.replace("/", ": ")}`;
    case "workspace/security":
      return `Changed security policy (${Object.keys(action.patch).join(", ")})`;
    case "data/import":
      return "Imported a workspace backup, replacing all data";
    case "agent/runRevert":
      return `Reverted an AI teammate run on “${taskName(state.agentRuns.find((r) => r.id === action.runId)?.taskId ?? "")}”`;
    case "agent/runApprove": {
      const run = state.agentRuns.find((r) => r.id === action.runId);
      return run?.flagged ? `Let a flagged AI teammate run continue on “${taskName(run.taskId ?? "")}”` : null;
    }
    case "page/delete":
      return `Deleted page “${state.pages.find((p) => p.id === action.id)?.title ?? ""}”`;
    case "user/setCapacity":
      return action.userId === state.currentUserId ? null : `Set ${userName(action.userId)}'s capacity to ${action.hours}h/week`;
    default:
      return null;
  }
}

function recordAudit(before: AppState, next: AppState, action: Action): AppState {
  if (!AUDITED.has(action.type)) return next;
  const detail = describeAudit(before, action);
  if (!detail) return next;
  const realActor = before.impersonatorId ?? before.currentUserId;
  const entry: AuditEntry = {
    id: uid("audit"),
    at: nowStamp(),
    actorId: action.type === "impersonate" ? realActor : before.currentUserId,
    viaId: action.type !== "impersonate" && before.impersonatorId ? before.impersonatorId : null,
    action: action.type,
    outcome: action.type === "audit/denied" ? "denied" : "allowed",
    detail,
  };
  return { ...next, auditLog: [entry, ...(next.auditLog ?? [])].slice(0, AUDIT_LIMIT) };
}

function apply(state: AppState, action: Action): AppState {
  switch (action.type) {
    /* ---------------------------------------------------------- tasks */
    case "task/create": {
      const projectId = action.patch.projectId ?? null;
      let sectionId = action.patch.sectionId ?? null;
      if (!sectionId && projectId) {
        const first = state.sections
          .filter((s) => s.projectId === projectId)
          .sort((a, b) => a.order - b.order)[0];
        sectionId = first?.id ?? null;
      }
      const task: Task = {
        id: action.patch.id ?? uid("tk"),
        name: action.patch.name,
        notes: action.patch.notes ?? "",
        completed: false,
        completedAt: null,
        assigneeId: action.patch.assigneeId ?? null,
        creatorId: state.currentUserId,
        projectId,
        sectionId,
        parentId: action.patch.parentId ?? null,
        dueDate: action.patch.dueDate ?? null,
        dueTime: action.patch.dueTime ?? null,
        startDate:
          action.patch.startDate ??
          (action.patch.dueDate ? addDays(action.patch.dueDate, -3) : null),
        order: nextTaskOrder(state.tasks, sectionId),
        priority: action.patch.priority ?? null,
        tagIds: action.patch.tagIds ?? [],
        followerIds: action.patch.followerIds ?? [state.currentUserId],
        customFields: action.patch.customFields ?? {},
        blockedByIds: action.patch.blockedByIds ?? [],
        blockingIds: action.patch.blockingIds ?? [],
        attachments: action.patch.attachments ?? [],
        likeUserIds: [],
        createdAt: nowStamp(),
        modifiedAt: nowStamp(),
        milestone: action.patch.milestone,
      };
      let next: AppState = {
        ...state,
        tasks: [...state.tasks, task],
        activities: action.silent
          ? state.activities
          : pushActivity(state.activities, task.id, state.currentUserId, "created"),
      };
      if (!action.silent && projectId) {
        next = applyRules(next, {
          type: "task-added",
          projectId,
          taskId: task.id,
        });
      }
      return next;
    }

    case "task/update": {
      const before = state.tasks.find((t) => t.id === action.id);
      if (!before) return state;
      const patch: Partial<Task> =
        action.patch.approvalStatus === "pending" ? { ...action.patch, approvals: [] } : action.patch;
      let activities = state.activities;
      let next: AppState = {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, ...patch, modifiedAt: nowStamp() } : t
        ),
      };
      if (!action.silent) {
        if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
          activities = pushActivity(activities, before.id, state.currentUserId, "assigned", {
            to: state.users.find((u) => u.id === patch.assigneeId)?.name ?? "Nobody",
          });
          next = { ...next, activities };
          next = applyRules(next, {
            type: "assignee-changed",
            projectId: before.projectId,
            taskId: before.id,
          });
        }
        if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) {
          next = {
            ...next,
            activities: pushActivity(next.activities, before.id, state.currentUserId, "due-date", {
              from: before.dueDate ?? "no date",
              to: patch.dueDate ?? "no date",
            }),
          };
          if (patch.dueDate) {
            next = applyRules(next, {
              type: "due-date-set",
              projectId: before.projectId,
              taskId: before.id,
            });
          }
        }
        if (patch.priority !== undefined && patch.priority !== before.priority) {
          next = {
            ...next,
            activities: pushActivity(next.activities, before.id, state.currentUserId, "priority", {
              to: patch.priority ?? "none",
            }),
          };
          next = applyRules(next, {
            type: "priority-changed",
            projectId: before.projectId,
            taskId: before.id,
          });
        }
        if (patch.sectionId !== undefined && patch.sectionId !== before.sectionId) {
          const sectionName =
            state.sections.find((s) => s.id === patch.sectionId)?.name ?? "—";
          next = {
            ...next,
            activities: pushActivity(next.activities, before.id, state.currentUserId, "section", {
              to: sectionName,
            }),
          };
        }
        if (patch.notes !== undefined && patch.notes !== before.notes) {
          next = {
            ...next,
            activities: pushActivity(next.activities, before.id, state.currentUserId, "description"),
          };
        }
      }
      if (patch.dueDate && patch.dueDate !== before.dueDate) {
        next = shiftDependents(next, before.id, patch.dueDate, before.dueDate);
      }
      return next;
    }

    case "task/rename":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, name: action.name, modifiedAt: nowStamp() }
            : t
        ),
      };

    case "task/delete":
      return removeTasks(state, [action.id]);

    case "audit/denied":
      // the entry itself is written by recordAudit(); return a new object so it runs
      return { ...state };

    case "task/decide": {
      const before = state.tasks.find((t) => t.id === action.id);
      if (!before) return state;
      const stamp = nowStamp();
      const votes = [...(before.approvals ?? []), { userId: state.currentUserId, decision: action.decision, note: action.note, at: stamp }];
      const outcome = approvalOutcome(before, votes);
      const done = outcome === "approved" || outcome === "rejected";
      const verb =
        action.decision === "approved" ? "approved" : action.decision === "rejected" ? "rejected" : "requested changes on";
      const comment: Comment = {
        id: uid("c"),
        taskId: before.id,
        authorId: state.currentUserId,
        text: `${verb[0].toUpperCase()}${verb.slice(1)} this${action.note ? `: ${action.note}` : "."}`,
        createdAt: stamp,
        likeUserIds: [],
      };
      const notifyIds = Array.from(new Set([before.creatorId, ...before.followerIds])).filter(
        (u) => u !== state.currentUserId
      );
      let next: AppState = {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === before.id
            ? { ...t, approvals: votes, approvalStatus: outcome, completed: done, completedAt: done ? stamp : null, modifiedAt: stamp }
            : t
        ),
        comments: [...state.comments, comment],
        activities: pushActivity(state.activities, before.id, state.currentUserId, "approval", {
          detail: verb,
        }),
        notifications: [
          ...notifyIds.map(
            (u): Notification => ({
              id: uid("n"),
              type: done ? "completed" : "comment",
              taskId: before.id,
              actorId: state.currentUserId,
              createdAt: stamp,
              read: false,
              text: `${verb} ${before.name}`,
              recipientId: u,
            })
          ),
          ...state.notifications,
        ],
      };
      if (done) {
        next = applyRules(next, { type: "task-completed", projectId: before.projectId, taskId: before.id });
      }
      return next;
    }

    case "task/toggleComplete": {
      const before = state.tasks.find((t) => t.id === action.id);
      if (!before) return state;
      const value = action.value ?? !before.completed;
      let next: AppState = {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                completed: value,
                completedAt: value ? nowStamp() : null,
                modifiedAt: nowStamp(),
                ...(t.approvalStatus && !value ? { approvalStatus: "pending" as const, approvals: [] } : {}),
                // the series continues on the next occurrence
                ...(value && t.recurrence ? { recurrence: undefined } : {}),
              }
            : t
        ),
        activities: pushActivity(
          state.activities,
          action.id,
          state.currentUserId,
          value ? "completed" : "uncompleted"
        ),
      };
      if (value && before.recurrence) next = spawnNextOccurrence(next, before);
      if (value) {
        next = applyRules(next, {
          type: "task-completed",
          projectId: before.projectId,
          taskId: before.id,
        });
      }
      return next;
    }

    case "task/move": {
      const before = state.tasks.find((t) => t.id === action.id);
      if (!before) return state;
      const projectId =
        action.projectId !== undefined ? action.projectId : before.projectId;
      let sectionId =
        action.sectionId !== undefined ? action.sectionId : before.sectionId;
      if (projectId !== before.projectId) {
        const firstSection = state.sections
          .filter((s) => s.projectId === projectId)
          .sort((a, b) => a.order - b.order)[0];
        sectionId =
          action.sectionId !== undefined ? action.sectionId : firstSection?.id ?? null;
      }
      const siblings = state.tasks
        .filter(
          (t) =>
            t.sectionId === sectionId &&
            t.id !== action.id &&
            !t.parentId
        )
        .sort((a, b) => a.order - b.order);
      const idx = action.beforeId
        ? siblings.findIndex((t) => t.id === action.beforeId)
        : siblings.length;
      const prev = idx > 0 ? siblings[idx - 1].order : null;
      const nextOrder = idx >= 0 && idx < siblings.length ? siblings[idx].order : null;
      const order = orderBetween(prev, nextOrder);

      let next: AppState = {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, projectId, sectionId, order, modifiedAt: nowStamp() }
            : t
        ),
      };
      if (projectId !== before.projectId) {
        next = {
          ...next,
          activities: pushActivity(next.activities, action.id, state.currentUserId, "moved-project", {
            to: state.projects.find((p) => p.id === projectId)?.name ?? "—",
          }),
        };
      }
      if (sectionId && before.sectionId !== sectionId) {
        next = { ...next, tasks: reorderList(next.tasks, sectionId) };
        next = applyRules(next, {
          type: "task-moved-section",
          projectId,
          taskId: action.id,
          value: sectionId ?? undefined,
        });
      }
      return next;
    }

    case "task/setField": {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task) return state;
      let next: AppState = {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                customFields: { ...t.customFields, [action.fieldId]: action.value as never },
                modifiedAt: nowStamp(),
              }
            : t
        ),
        activities: pushActivity(state.activities, action.id, state.currentUserId, "field", {
          to: state.fields.find((f) => f.id === action.fieldId)?.name,
        }),
      };
      next = applyRules(next, {
        type: "field-changed",
        projectId: task.projectId,
        taskId: task.id,
        value: action.fieldId,
      });
      return next;
    }

    case "task/setPriority":
      return reducer(state, {
        type: "task/update",
        id: action.id,
        patch: { priority: action.priority },
      });

    case "task/setDue":
      return reducer(state, {
        type: "task/update",
        id: action.id,
        patch: {
          dueDate: action.dueDate,
          dueTime: action.dueTime !== undefined ? action.dueTime : null,
          startDate:
            action.dueDate && !state.tasks.find((t) => t.id === action.id)?.startDate
              ? addDays(action.dueDate, -3)
              : state.tasks.find((t) => t.id === action.id)?.startDate ?? null,
        },
      });

    case "task/setAssignee": {
      let next = reducer(state, {
        type: "task/update",
        id: action.id,
        patch: {
          assigneeId: action.userId,
          followerIds: action.userId
            ? Array.from(
                new Set([
                  ...(state.tasks.find((t) => t.id === action.id)?.followerIds ?? []),
                  action.userId,
                ])
              )
            : state.tasks.find((t) => t.id === action.id)?.followerIds ?? [],
        },
      });
      const strayRuns = next.agentRuns.filter(
        (r) =>
          r.taskId === action.id &&
          r.teammateId !== action.userId &&
          (r.status === "running" || r.status === "queued")
      );
      if (strayRuns.length) {
        next = {
          ...next,
          agentRuns: next.agentRuns.map((r) =>
            strayRuns.some((s) => s.id === r.id)
              ? { ...r, status: "cancelled", finishedAt: nowStamp() }
              : r
          ),
        };
      }
      const agent = next.users.find((u) => u.id === action.userId && u.isAgent);
      if (agent && agent.agentStatus === "active") {
        return reducer(next, {
          type: "agent/runStart",
          teammateId: agent.id,
          taskId: action.id,
        });
      }
      return next;
    }

    case "task/toggleTag":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                tagIds: t.tagIds.includes(action.tagId)
                  ? t.tagIds.filter((id) => id !== action.tagId)
                  : [...t.tagIds, action.tagId],
                modifiedAt: nowStamp(),
              }
            : t
        ),
      };

    case "task/toggleFollower":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                followerIds: t.followerIds.includes(action.userId)
                  ? t.followerIds.filter((id) => id !== action.userId)
                  : [...t.followerIds, action.userId],
              }
            : t
        ),
      };

    case "task/toggleLike":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                likeUserIds: t.likeUserIds.includes(state.currentUserId)
                  ? t.likeUserIds.filter((id) => id !== state.currentUserId)
                  : [...t.likeUserIds, state.currentUserId],
              }
            : t
        ),
      };

    case "task/toggleDependency": {
      const kind = action.kind;
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id === action.id) {
            const list = kind === "blocked-by" ? t.blockedByIds : t.blockingIds;
            const nextList = list.includes(action.otherId)
              ? list.filter((id) => id !== action.otherId)
              : [...list, action.otherId];
            return {
              ...t,
              [kind === "blocked-by" ? "blockedByIds" : "blockingIds"]: nextList,
            };
          }
          if (t.id === action.otherId) {
            const key = kind === "blocked-by" ? "blockingIds" : "blockedByIds";
            const list = t[key];
            const nextList = list.includes(action.id)
              ? list.filter((id) => id !== action.id)
              : [...list, action.id];
            return { ...t, [key]: nextList };
          }
          return t;
        }),
      };
    }

    case "task/duplicate": {
      const src = state.tasks.find((t) => t.id === action.id);
      if (!src) return state;
      const copy: Task = {
        ...src,
        id: uid("tk"),
        name: `${src.name} (copy)`,
        order: nextTaskOrder(state.tasks, src.sectionId),
        createdAt: nowStamp(),
        modifiedAt: nowStamp(),
        completed: false,
        completedAt: null,
        attachments: src.attachments.map((a) => ({ ...a, id: uid("att") })),
        likeUserIds: [],
        // dependencies are two-sided links; copying one side would corrupt the graph
        blockedByIds: [],
        blockingIds: [],
      };
      return {
        ...state,
        tasks: [...state.tasks, copy],
        activities: pushActivity(state.activities, copy.id, state.currentUserId, "duplicated", {
          from: src.name,
        }),
      };
    }

    case "tasks/bulk":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          action.ids.includes(t.id)
            ? { ...t, ...action.patch, modifiedAt: nowStamp() }
            : t
        ),
      };

    case "tasks/delete":
      return removeTasks(state, action.ids);

    /* ------------------------------------------------------- sections */
    case "section/create": {
      const existing = state.sections
        .filter((s) => s.projectId === action.projectId)
        .sort((a, b) => a.order - b.order);
      let order = existing.length ? existing[existing.length - 1].order + 1000 : 1000;
      if (action.afterId) {
        const idx = existing.findIndex((s) => s.id === action.afterId);
        const prev = existing[idx]?.order ?? null;
        const next = existing[idx + 1]?.order ?? null;
        order = orderBetween(prev, next);
      }
      const section: Section = {
        id: uid("sec"),
        projectId: action.projectId,
        name: action.name,
        order,
        collapsed: false,
      };
      return { ...state, sections: [...state.sections, section] };
    }

    case "section/update":
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.id === action.id ? { ...s, ...action.patch } : s
        ),
      };

    case "section/delete": {
      const fallback = state.sections
        .filter((s) => s.projectId === state.sections.find((x) => x.id === action.id)?.projectId)
        .sort((a, b) => a.order - b.order)
        .find((s) => s.id !== action.id);
      // deleting the last section would orphan its tasks from every view
      if (!fallback) return state;
      return {
        ...state,
        sections: state.sections.filter((s) => s.id !== action.id),
        tasks: state.tasks.map((t) =>
          t.sectionId === action.id ? { ...t, sectionId: fallback?.id ?? null } : t
        ),
      };
    }

    case "section/move": {
      const target = state.sections.find((s) => s.id === action.id);
      if (!target) return state;
      const siblings = state.sections
        .filter((s) => s.projectId === target.projectId && s.id !== target.id)
        .sort((a, b) => a.order - b.order);
      const idx = action.beforeId
        ? siblings.findIndex((s) => s.id === action.beforeId)
        : siblings.length;
      const order = orderBetween(
        idx > 0 ? siblings[idx - 1].order : null,
        idx >= 0 && idx < siblings.length ? siblings[idx].order : null
      );
      return {
        ...state,
        sections: state.sections.map((s) => (s.id === action.id ? { ...s, order } : s)),
      };
    }

    /* ------------------------------------------------------- projects */
    case "project/create": {
      const id = action.project.id ?? uid("p");
      const teamId = action.project.teamId ?? state.teams[0].id;
      const project: Project = {
        id,
        name: action.project.name,
        teamId,
        color: action.project.color ?? "blue",
        icon: action.project.icon ?? "list",
        description: action.project.description ?? "",
        ownerId: state.currentUserId,
        memberIds: action.project.memberIds ?? [state.currentUserId],
        privacy: action.project.privacy ?? "public",
        starred: false,
        archived: false,
        dueDate: action.project.dueDate ?? null,
        createdAt: nowStamp(),
        defaultView: "list",
        status: { state: "none", text: "" },
        statusUpdates: [],
        fieldIds: ["fld-stage", "fld-effort"],
      };
      const baseSections: Section[] = ["To do", "In progress", "Complete"].map(
        (name, i) => ({
          id: uid("sec"),
          projectId: id,
          name,
          order: (i + 1) * 1000,
          collapsed: false,
        })
      );
      return {
        ...state,
        projects: [...state.projects, project],
        sections: [...state.sections, ...baseSections],
      };
    }

    case "project/update":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p
        ),
      };

    case "project/delete": {
      const pid = action.id;
      const removed = removeTasks(
        state,
        state.tasks.filter((t) => t.projectId === pid).map((t) => t.id)
      );
      const drop = (ids: ID[]) => ids.filter((id) => id !== pid);
      return {
        ...removed,
        projects: removed.projects.filter((p) => p.id !== pid),
        sections: removed.sections.filter((s) => s.projectId !== pid),
        rules: removed.rules.filter((r) => r.projectId !== pid),
        forms: removed.forms.filter((f) => f.projectId !== pid),
        savedViews: removed.savedViews.filter((v) => v.projectId !== pid),
        statusUpdates: removed.statusUpdates.filter((u) => u.projectId !== pid),
        goals: removed.goals.map((g) => (g.projectIds.includes(pid) ? { ...g, projectIds: drop(g.projectIds) } : g)),
        portfolios: removed.portfolios.map((p) => (p.projectIds.includes(pid) ? { ...p, projectIds: drop(p.projectIds) } : p)),
        portals: removed.portals.map((p) => (p.projectIds.includes(pid) ? { ...p, projectIds: drop(p.projectIds) } : p)),
        users: removed.users.map((u) => (u.projectIds?.includes(pid) ? { ...u, projectIds: drop(u.projectIds) } : u)),
        meetings: removed.meetings.map((m) => (m.projectId === pid ? { ...m, projectId: null } : m)),
        recentlyViewed: removed.recentlyViewed.filter((v) => !(v.type === "project" && v.id === pid)),
      };
    }

    case "project/toggleStar":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, starred: !p.starred } : p
        ),
      };

    case "project/addMember":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id
            ? { ...p, memberIds: Array.from(new Set([...p.memberIds, action.userId])) }
            : p
        ),
      };

    case "status/create": {
      const update = {
        id: uid("su"),
        projectId: action.projectId,
        authorId: state.currentUserId,
        createdAt: nowStamp(),
        state: action.state,
        title: action.title,
        text: action.text,
      };
      return {
        ...state,
        statusUpdates: [update, ...state.statusUpdates],
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                status: { state: action.state, text: action.title },
                statusUpdates: [update, ...p.statusUpdates],
              }
            : p
        ),
      };
    }

    /* ------------------------------------------------------- comments */
    case "comment/create": {
      const comment: Comment = {
        id: uid("c"),
        taskId: action.taskId,
        authorId: state.currentUserId,
        text: action.text,
        createdAt: nowStamp(),
        likeUserIds: [],
      };
      const task = state.tasks.find((t) => t.id === action.taskId);
      return {
        ...state,
        comments: [...state.comments, comment],
        activities: pushActivity(state.activities, action.taskId, state.currentUserId, "comment", {
          detail: action.text.slice(0, 80),
        }),
        notifications: task
          ? task.followerIds
              .filter((u) => u !== state.currentUserId)
              .map((u): Notification => ({
                id: uid("n"),
                type: "comment",
                taskId: action.taskId,
                actorId: state.currentUserId,
                createdAt: nowStamp(),
                read: false,
                text: `commented on ${task.name}`,
                recipientId: u,
              }))
              .concat(state.notifications)
          : state.notifications,
      };
    }

    case "comment/delete":
      return { ...state, comments: state.comments.filter((c) => c.id !== action.id) };

    case "comment/like":
      return {
        ...state,
        comments: state.comments.map((c) =>
          c.id === action.id
            ? {
                ...c,
                likeUserIds: c.likeUserIds.includes(state.currentUserId)
                  ? c.likeUserIds.filter((u) => u !== state.currentUserId)
                  : [...c.likeUserIds, state.currentUserId],
              }
            : c
        ),
      };

    /* ------------------------------------------------------------ tags */
    case "tag/create":
      return {
        ...state,
        tags: [...state.tags, { id: uid("tag"), name: action.name, color: action.color }],
      };

    case "tag/delete":
      return {
        ...state,
        tags: state.tags.filter((t) => t.id !== action.id),
        tasks: state.tasks.map((t) => ({
          ...t,
          tagIds: t.tagIds.filter((id) => id !== action.id),
        })),
      };

    /* ---------------------------------------------------------- fields */
    case "field/create":
      return {
        ...state,
        fields: [
          ...state.fields,
          { ...action.field, id: uid("fld"), createdBy: state.currentUserId },
        ],
      };

    case "field/delete":
      return { ...state, fields: state.fields.filter((f) => f.id !== action.id) };

    /* ----------------------------------------------------------- goals */
    case "goal/create":
      return {
        ...state,
        goals: [
          ...state.goals,
          {
            id: uid("g"),
            name: action.name,
            description: "",
            ownerId: state.currentUserId,
            teamId: state.teams[0].id,
            parentId: null,
            metric: "",
            startValue: 0,
            targetValue: 100,
            currentValue: 0,
            unit: "%",
            dueDate: addDays(todayISO(), 90),
            status: "on-track",
            projectIds: [],
            createdAt: nowStamp(),
            ...action.patch,
          },
        ],
      };

    case "goal/update":
      return {
        ...state,
        goals: state.goals.map((g) => (g.id === action.id ? { ...g, ...action.patch } : g)),
      };

    case "goal/delete":
      return {
        ...state,
        goals: state.goals.filter((g) => g.id !== action.id),
      };

    /* ------------------------------------------------------ portfolios */
    case "portfolio/create":
      return {
        ...state,
        portfolios: [
          ...state.portfolios,
          {
            id: uid("pf"),
            name: action.name,
            ownerId: state.currentUserId,
            memberIds: [state.currentUserId],
            color: "blue",
            projectIds: [],
            createdAt: nowStamp(),
          },
        ],
      };

    case "portfolio/update":
      return {
        ...state,
        portfolios: state.portfolios.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p
        ),
      };

    /* ----------------------------------------------------------- rules */
    case "rule/create":
      return {
        ...state,
        rules: [
          ...state.rules,
          {
            id: uid("r"),
            projectId: action.projectId,
            name: action.name,
            enabled: false,
            trigger: { type: "task-added", value: "" },
            actions: [],
            runCount: 0,
            createdBy: state.currentUserId,
          },
        ],
      };

    case "rule/update":
      return {
        ...state,
        rules: state.rules.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r)),
      };

    case "rule/delete":
      return { ...state, rules: state.rules.filter((r) => r.id !== action.id) };

    case "rule/toggle":
      return {
        ...state,
        rules: state.rules.map((r) =>
          r.id === action.id ? { ...r, enabled: !r.enabled } : r
        ),
      };

    case "rule/actionSet":
      return {
        ...state,
        rules: state.rules.map((r) => {
          if (r.id !== action.ruleId) return r;
          const exists = r.actions.some((a) => a.id === action.action.id);
          return {
            ...r,
            actions: exists
              ? r.actions.map((a) => (a.id === action.action.id ? action.action : a))
              : [...r.actions, action.action],
          };
        }),
      };

    case "rule/actionRemove":
      return {
        ...state,
        rules: state.rules.map((r) =>
          r.id === action.ruleId
            ? { ...r, actions: r.actions.filter((a) => a.id !== action.actionId) }
            : r
        ),
      };

    /* ------------------------------------------------------------ agents */
    case "agent/create": {
      const agent: User = {
        id: uid("ai"),
        name: action.patch.name ?? "New AI teammate",
        email: `${(action.patch.name ?? "agent").toLowerCase().replace(/[^a-z0-9]+/g, ".")}@ai.northwind.co`,
        initials: (action.patch.name ?? "AI").slice(0, 2).toUpperCase(),
        color: action.patch.color ?? "indigo",
        role: action.patch.role ?? "AI teammate",
        teamIds: action.patch.teamIds ?? [],
        isAgent: true,
        agentStatus: "active",
        modelLabel: action.patch.modelLabel ?? "Northwind Agent · fast",
        instructions: action.patch.instructions ?? "",
        skillIds: action.patch.skillIds ?? ["sk-triage"],
        projectIds: action.patch.projectIds ?? [],
        authScopes: action.patch.authScopes ?? ["scope-projects", "scope-comments"],
        runCount: 0,
      };
      return { ...state, users: [...state.users, agent] };
    }

    case "agent/update":
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.id ? { ...u, ...action.patch } : u
        ),
      };

    case "agent/toggle":
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.id
            ? { ...u, agentStatus: u.agentStatus === "paused" ? "active" : "paused" }
            : u
        ),
      };

    case "agent/runStart": {
      const agent = state.users.find((u) => u.id === action.teammateId);
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!agent || !task) return state;
      const live = state.agentRuns.find(
        (r) => r.taskId === task.id && (r.status === "running" || r.status === "queued" || r.status === "review")
      );
      if (live) return state;
      const stamp = nowStamp();
      const projectName = state.projects.find((p) => p.id === task.projectId)?.name ?? "this project";
      const stopped = (label: string, detail: string, note: string): AppState => ({
        ...state,
        agentRuns: [
          {
            id: uid("run"),
            teammateId: agent.id,
            taskId: task.id,
            projectId: task.projectId,
            kind: action.kind ?? "task",
            status: "cancelled",
            startedAt: stamp,
            finishedAt: stamp,
            cursor: 1,
            steps: [{ id: uid("st"), kind: "ack", label, detail, at: stamp }],
          } as AgentRun,
          ...state.agentRuns,
        ].slice(0, LIMITS.agentRuns),
        activities: pushActivity(state.activities, task.id, agent.id, "rule", { detail: note }),
      });

      // 1. the agent's own access
      if (!agentCan(state, agent.id, "scope-projects", task.projectId)) {
        return stopped(
          `${agent.name} can't work in ${projectName}`,
          `Add ${projectName} to ${agent.name}'s projects (and the scopes it needs) to let it pick this up.`,
          `${agent.name} has no access to ${projectName}, so it did not start`
        );
      }
      // 2. monthly budget
      const month = stamp.slice(0, 7);
      const used = agent.usage?.month === month ? agent.usage.runs : 0;
      if (agent.runBudget && used >= agent.runBudget) {
        return stopped(
          `${agent.name} reached its monthly budget`,
          `${used} of ${agent.runBudget} runs used in ${month}. Raise the budget on the teammate's page to continue.`,
          `${agent.name} is over budget, so it did not start`
        );
      }
      // 3. prompt-injection screening — pause for a human before doing anything
      const finding = scanTaskForInjection(state, task);
      const run: AgentRun = {
        id: uid("run"),
        teammateId: agent.id,
        taskId: task.id,
        projectId: task.projectId,
        kind: action.kind ?? "task",
        status: finding ? "review" : "running",
        startedAt: stamp,
        finishedAt: null,
        steps: agentPlan(state, agent, task),
        cursor: 0,
        changes: [],
        flagged: finding ? `Paused: the task ${finding.reason} (“${finding.excerpt}”). Approve to let ${agent.name} continue.` : undefined,
      };
      return {
        ...state,
        users: state.users.map((u) => (u.id === agent.id ? { ...u, usage: { month, runs: used + 1 } } : u)),
        agentRuns: [run, ...state.agentRuns].slice(0, LIMITS.agentRuns),
        activities: pushActivity(state.activities, task.id, agent.id, "rule", {
          detail: finding
            ? `${agent.name} paused before starting: possible prompt injection`
            : `${agent.name} started working on this task`,
        }),
      };
    }

    case "agent/runAdvance": {
      const run = state.agentRuns.find((r) => r.id === action.runId);
      if (!run || run.status !== "running") return state;
      const step = run.steps[run.cursor];
      if (!step) return state;
      const agent = state.users.find((u) => u.id === run.teammateId);
      const task = run.taskId ? state.tasks.find((t) => t.id === run.taskId) : null;
      if (!agent) return state;
      if (agent.agentStatus !== "active") return state; // paused agents hold their place
      const scope = AGENT_STEP_SCOPE[step.kind] ?? "scope-projects";
      const permitted = agentCan(state, agent.id, scope, task?.projectId ?? run.projectId);
      const scopeLabel = AGENT_AUTH_SCOPES.find((x) => x.id === scope)?.label ?? scope;
      const stamp = nowStamp();
      const last = run.cursor + 1 >= run.steps.length;
      const changes = [...(run.changes ?? [])];
      let next: AppState = state;
      const followers = task ? task.followerIds.filter((u) => u !== agent.id) : [];

      if (task && permitted) {
        if (step.kind === "plan" && !state.tasks.some((t) => t.parentId === task.id)) {
          const created: Task[] = agentSubtasks(task).map((s) => ({
            id: uid("tk"),
            name: s.name,
            notes: "",
            completed: false,
            completedAt: null,
            assigneeId: agent.id,
            creatorId: agent.id,
            projectId: task.projectId,
            sectionId: task.sectionId,
            parentId: task.id,
            dueDate: null,
            dueTime: null,
            startDate: null,
            order: s.order,
            priority: null,
            tagIds: [],
            followerIds: [...task.followerIds],
            customFields: {},
            blockedByIds: [],
            blockingIds: [],
            attachments: [],
            likeUserIds: [],
            createdAt: stamp,
            modifiedAt: stamp,
          }));
          created.forEach((t) => changes.push({ kind: "subtask", taskId: task.id, refId: t.id, summary: `Created subtask “${t.name}”` }));
          next = {
            ...next,
            tasks: [...next.tasks, ...created],
            activities: pushActivity(next.activities, task.id, agent.id, "rule", { detail: `created ${created.length} subtasks` }),
          };
        }
        if (step.kind === "field") {
          const before = task.customFields["fld-effort"];
          const value = 1 + (task.id.length % 5);
          changes.push({ kind: "field", taskId: task.id, refId: "fld-effort", summary: `Set effort to ${value} points`, before });
          next = {
            ...next,
            tasks: next.tasks.map((t) =>
              t.id === task.id ? { ...t, customFields: { ...t.customFields, "fld-effort": value }, modifiedAt: stamp } : t
            ),
          };
        }
        if (step.kind === "comment") {
          const ownSubs = next.tasks.filter((t) => t.parentId === task.id && t.assigneeId === agent.id);
          const finishOwn = step.label === "Posted a progress comment" && ownSubs.length > 0;
          const comment: Comment = {
            id: uid("c"),
            taskId: task.id,
            authorId: agent.id,
            text: finishOwn
              ? `Progress update: finished ${ownSubs.length}/${ownSubs.length} subtasks and left the task open for your review. Everything I changed is listed in the activity feed.`
              : agentComment(agent, task, step, state),
            createdAt: stamp,
            likeUserIds: [],
          };
          changes.push({ kind: "comment", taskId: task.id, refId: comment.id, summary: "Posted a comment" });
          if (finishOwn) {
            ownSubs
              .filter((t) => !t.completed)
              .forEach((t) => changes.push({ kind: "complete", taskId: task.id, refId: t.id, summary: `Completed subtask “${t.name}”` }));
          }
          next = {
            ...next,
            tasks: finishOwn
              ? next.tasks.map((t) =>
                  t.parentId === task.id && t.assigneeId === agent.id && !t.completed
                    ? { ...t, completed: true, completedAt: stamp }
                    : t
                )
              : next.tasks,
            comments: [...next.comments, comment],
            notifications: [
              ...followers.map(
                (u): Notification => ({
                  id: uid("n"),
                  type: "comment",
                  taskId: task.id,
                  actorId: agent.id,
                  createdAt: stamp,
                  read: false,
                  text: `commented on ${task.name}`,
                  recipientId: u,
                })
              ),
              ...next.notifications,
            ],
          };
        }
        if (step.kind === "complete" && !task.completed && !task.approvalStatus) {
          changes.push({ kind: "complete", taskId: task.id, refId: task.id, summary: "Completed the task" });
          next = {
            ...next,
            tasks: next.tasks.map((t) => (t.id === task.id ? { ...t, completed: true, completedAt: stamp } : t)),
          };
        }
      }

      const review = last && !!agent.requireReview && changes.length > 0;
      next = {
        ...next,
        agentRuns: next.agentRuns.map((r) =>
          r.id === run.id
            ? {
                ...r,
                cursor: r.cursor + 1,
                status: last ? (review ? "review" : "done") : "running",
                finishedAt: last && !review ? stamp : null,
                changes,
                steps: r.steps.map((s, i) =>
                  i === r.cursor
                    ? { ...s, at: stamp, ...(permitted ? {} : { detail: `Skipped — needs the “${scopeLabel}” permission` }) }
                    : s
                ),
              }
            : r
        ),
      };
      if (last) {
        next = {
          ...next,
          users: review ? next.users : next.users.map((u) => (u.id === agent.id ? { ...u, runCount: (u.runCount ?? 0) + 1 } : u)),
          activities: pushActivity(next.activities, run.taskId ?? run.projectId ?? "", agent.id, "rule", {
            detail: review
              ? `${agent.name} finished and is waiting for someone to review ${changes.length} change${changes.length === 1 ? "" : "s"}`
              : `${agent.name} finished a run`,
          }),
        };
      }
      return next;
    }

    case "agent/runApprove": {
      const run = state.agentRuns.find((r) => r.id === action.runId);
      if (!run || run.status !== "review") return state;
      const agent = state.users.find((u) => u.id === run.teammateId);
      const stamp = nowStamp();
      // a flagged run that hasn't started yet resumes; a finished run is accepted
      const resume = !!run.flagged && run.cursor === 0;
      return {
        ...state,
        agentRuns: state.agentRuns.map((r) =>
          r.id === run.id
            ? { ...r, status: resume ? "running" : "done", flagged: undefined, finishedAt: resume ? null : stamp }
            : r
        ),
        users: resume
          ? state.users
          : state.users.map((u) => (u.id === run.teammateId ? { ...u, runCount: (u.runCount ?? 0) + 1 } : u)),
        activities: run.taskId
          ? pushActivity(state.activities, run.taskId, state.currentUserId, "rule", {
              detail: resume
                ? `let ${agent?.name ?? "the AI teammate"} continue after reviewing the warning`
                : `approved ${agent?.name ?? "the AI teammate"}'s changes`,
            })
          : state.activities,
      };
    }

    case "agent/runRevert": {
      const run = state.agentRuns.find((r) => r.id === action.runId);
      if (!run || (run.status !== "review" && run.status !== "done")) return state;
      const changes = run.changes ?? [];
      const createdSubs = changes.filter((c) => c.kind === "subtask").map((c) => c.refId);
      const createdComments = new Set(changes.filter((c) => c.kind === "comment").map((c) => c.refId));
      const completed = new Set(changes.filter((c) => c.kind === "complete").map((c) => c.refId));
      const fields = changes.filter((c) => c.kind === "field");
      let next = removeTasks(state, createdSubs);
      next = {
        ...next,
        comments: next.comments.filter((c) => !createdComments.has(c.id)),
        tasks: next.tasks.map((t) => {
          let out = t;
          if (completed.has(t.id)) out = { ...out, completed: false, completedAt: null };
          for (const f of fields) {
            if (f.taskId === t.id) {
              const cf = { ...out.customFields };
              if (f.before === undefined) delete cf[f.refId];
              else cf[f.refId] = f.before as never;
              out = { ...out, customFields: cf };
            }
          }
          return out;
        }),
        agentRuns: next.agentRuns.map((r) =>
          r.id === run.id ? { ...r, status: "reverted", finishedAt: nowStamp(), flagged: undefined } : r
        ),
      };
      if (run.taskId) {
        next = {
          ...next,
          activities: pushActivity(next.activities, run.taskId, state.currentUserId, "rule", {
            detail: `reverted ${changes.length} change${changes.length === 1 ? "" : "s"} made by an AI teammate`,
          }),
        };
      }
      return next;
    }

    case "agent/runCancel":
      return {
        ...state,
        agentRuns: state.agentRuns.map((r) =>
          r.id === action.runId
            ? { ...r, status: "cancelled", finishedAt: nowStamp() }
            : r
        ),
      };

    /* ----------------------------------------------- templates & recurrence */
    case "taskTemplate/create": {
      const src = state.tasks.find((t) => t.id === action.fromTaskId);
      if (!src?.projectId) return state;
      return {
        ...state,
        taskTemplates: [
          ...state.taskTemplates,
          {
            id: uid("ttpl"),
            projectId: src.projectId,
            name: action.name || src.name,
            taskName: src.name,
            notes: src.notes,
            subtasks: state.tasks.filter((t) => t.parentId === src.id).sort((a, b) => a.order - b.order).map((t) => t.name),
            priority: src.priority,
            tagIds: [...src.tagIds],
            createdBy: state.currentUserId,
          },
        ],
      };
    }

    case "taskTemplate/delete":
      return { ...state, taskTemplates: state.taskTemplates.filter((t) => t.id !== action.id) };

    case "task/fromTemplate": {
      const tpl = state.taskTemplates.find((t) => t.id === action.templateId);
      if (!tpl) return state;
      const parentId = uid("tk");
      let next = apply(state, {
        type: "task/create",
        patch: {
          id: parentId,
          name: (action.name ?? tpl.taskName).trim() || tpl.name,
          notes: tpl.notes,
          projectId: tpl.projectId,
          sectionId: action.sectionId ?? undefined,
          priority: tpl.priority,
          tagIds: [...tpl.tagIds],
          assigneeId: state.currentUserId,
        },
      });
      tpl.subtasks.forEach((name, i) => {
        next = apply(next, {
          type: "task/create",
          patch: { id: uid("tk"), name, parentId, projectId: tpl.projectId, order: (i + 1) * 1000 } as Partial<Task> & { name: string },
          silent: true,
        });
      });
      return next;
    }

    /* ---------------------------------------------------------- scheduler */
    case "rules/tick":
      return runScheduledRules(state, action.now);

    /* ----------------------------------------------------------- messages */
    case "message/post":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: uid("pmsg"), projectId: action.projectId, authorId: state.currentUserId, text: action.text, createdAt: nowStamp() },
        ],
      };

    case "message/delete":
      return { ...state, messages: state.messages.filter((m) => m.id !== action.id) };

    /* -------------------------------------------------------------- pages */
    case "page/move":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === action.id ? { ...p, parentId: action.parentId, updatedAt: nowStamp() } : p
        ),
      };

    case "page/delete": {
      const page = state.pages.find((p) => p.id === action.id);
      if (!page) return state;
      return {
        ...state,
        // children move up a level instead of disappearing
        pages: state.pages
          .filter((p) => p.id !== action.id)
          .map((p) => (p.parentId === action.id ? { ...p, parentId: page.parentId ?? null } : p)),
      };
    }

    /* ------------------------------------------------------------- tables */
    case "table/viewSave":
      return {
        ...state,
        tables: state.tables.map((t) => {
          if (t.id !== action.tableId) return t;
          const views = t.views ?? [];
          const view = { ...action.view, name: clampText(action.view.name, TEXT_LIMITS.title).trim() || "Untitled view" };
          return {
            ...t,
            views: views.some((v) => v.id === view.id) ? views.map((v) => (v.id === view.id ? view : v)) : [...views, view],
          };
        }),
      };

    case "table/viewDelete":
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === action.tableId ? { ...t, views: (t.views ?? []).filter((v) => v.id !== action.viewId) } : t
        ),
      };

    /* ---------------------------------------------------------------- dev */
    case "devSpace/settings":
      return {
        ...state,
        devSpaces: state.devSpaces.map((d) =>
          d.id === action.spaceId
            ? { ...d, settings: { ...DEFAULT_DEV_SETTINGS, ...(d.settings ?? {}), ...action.patch } }
            : d
        ),
      };

    case "release/generateNotes":
      return {
        ...state,
        releases: state.releases.map((r) => (r.id === action.id ? { ...r, notes: releaseNotes(state, r.id) } : r)),
      };

    /* ---------------------------------------------------------------- CRM */
    case "client/update":
      return {
        ...state,
        clients: state.clients.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case "clientNote/add": {
      const text = clampText(action.text, TEXT_LIMITS.comment).trim();
      if (!text || !state.clients.some((c) => c.id === action.clientId)) return state;
      return {
        ...state,
        clientNotes: [
          { id: uid("cn"), clientId: action.clientId, authorId: state.currentUserId, kind: action.kind, text, createdAt: nowStamp() },
          ...state.clientNotes,
        ],
      };
    }

    case "clientNote/delete":
      return { ...state, clientNotes: state.clientNotes.filter((n) => n.id !== action.id) };

    /* ----------------------------------------------------------- workload */
    case "user/setCapacity":
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.userId ? { ...u, capacityHours: Math.round(action.hours) } : u)),
      };

    /* ----------------------------------------------------------- security */
    case "workspace/security": {
      const p = action.patch;
      const current = state.security ?? DEFAULT_SECURITY;
      const next: SecurityPolicy = {
        sessionHours: p.sessionHours !== undefined ? Math.min(168, Math.max(1, Math.round(p.sessionHours))) : current.sessionHours,
        requireTwoFactor: p.requireTwoFactor ?? current.requireTwoFactor,
        inviteDomains:
          p.inviteDomains !== undefined
            ? Array.from(new Set(p.inviteDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))).slice(0, 20)
            : current.inviteDomains,
        impersonationMinutes:
          p.impersonationMinutes !== undefined ? Math.min(240, Math.max(5, Math.round(p.impersonationMinutes))) : current.impersonationMinutes,
      };
      return { ...state, security: next };
    }

    case "data/import": {
      // untrusted file: full hydrate + sanitize; identity and audit are kept
      const incoming = hydrate(JSON.stringify(action.state));
      return {
        ...incoming,
        currentUserId: state.currentUserId,
        impersonatorId: state.impersonatorId,
        ui: state.ui,
        auditLog: state.auditLog,
      };
    }

    /* -------------------------------------------------------------- chat */
    case "chat/send": {
      const me = state.currentUserId;
      const mine = (id: ID | null) =>
        !!id && state.chatThreads.some((t) => t.id === id && threadOwner(t) === me);
      const threadId = mine(state.activeThreadId)
        ? (state.activeThreadId as ID)
        : state.chatThreads.find((t) => threadOwner(t) === me)?.id ?? uid("thread");
      const userMessage: ChatMessage = {
        id: uid("msg"),
        threadId,
        role: "user",
        text: action.text,
        createdAt: nowStamp(),
        citations: [],
        actions: [],
      };
      const reply = answerQuestion(scopeStateForViewer(state), action.text);
      const aiMessage: ChatMessage = {
        id: uid("msg"),
        threadId,
        role: "ai",
        text: reply.text,
        createdAt: nowStamp(),
        citations: reply.citations,
        actions: reply.actions,
      };
      const existingThread = state.chatThreads.find((t) => t.id === threadId);
      const threads = existingThread
        ? state.chatThreads.map((t) =>
            t.id === threadId
              ? { ...t, updatedAt: nowStamp(), title: t.title === "New chat" ? action.text.slice(0, 60) : t.title }
              : t
          )
        : [
            {
              id: threadId,
              ownerId: me,
              title: action.text.slice(0, 60),
              createdAt: nowStamp(),
              updatedAt: nowStamp(),
            },
            ...state.chatThreads,
          ];
      return {
        ...state,
        chatThreads: threads,
        activeThreadId: threadId,
        chatMessages: [...state.chatMessages, userMessage, aiMessage].slice(-400),
      };
    }

    case "chat/newThread": {
      const thread = {
        id: uid("thread"),
        ownerId: state.currentUserId,
        title: "New chat",
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
      };
      return {
        ...state,
        chatThreads: [thread, ...state.chatThreads],
        activeThreadId: thread.id,
      };
    }

    case "chat/selectThread":
      return { ...state, activeThreadId: action.id };

    /* ---------------------------------------------------------- meetings */
    case "meeting/actionToTask": {
      const meeting = state.meetings.find((m) => m.id === action.meetingId);
      const item = meeting?.actionItems.find((a) => a.id === action.actionItemId);
      if (!meeting || !item || item.created) return state;
      const projectId = item.projectId ?? meeting.projectId ?? null;
      const firstSection = projectId
        ? state.sections
            .filter((s) => s.projectId === projectId)
            .sort((a, b) => a.order - b.order)[0]
        : null;
      const task: Task = {
        id: uid("tk"),
        name: item.text,
        notes: `Extracted from “${meeting.title}” by Quill.`,
        completed: false,
        completedAt: null,
        assigneeId: item.assigneeId,
        creatorId: "ai-quill",
        projectId,
        sectionId: firstSection?.id ?? null,
        parentId: null,
        dueDate: addDays(todayISO(), 3),
        dueTime: null,
        startDate: todayISO(),
        order: nextTaskOrder(state.tasks, firstSection?.id ?? null),
        priority: null,
        tagIds: [],
        followerIds: ["u-maya"],
        customFields: {},
        blockedByIds: [],
        blockingIds: [],
        attachments: [],
        likeUserIds: [],
        createdAt: nowStamp(),
        modifiedAt: nowStamp(),
      };
      return {
        ...state,
        tasks: [...state.tasks, task],
        meetings: state.meetings.map((m) =>
          m.id === meeting.id
            ? {
                ...m,
                actionItems: m.actionItems.map((a) =>
                  a.id === item.id ? { ...a, created: true } : a
                ),
              }
            : m
        ),
        activities: pushActivity(state.activities, task.id, "ai-quill", "created", {
          detail: "from a meeting action item",
        }),
      };
    }

    /* ------------------------------------------------------------- forms */
    case "form/submit": {
      const project = state.projects.find((p) => p.id === action.projectId);
      if (!project) return state;
      const form = state.forms.find((f) => f.projectId === action.projectId);
      const values = action.values;
      // map answers through each field's `mapsTo` (legacy seed ids kept as fallback)
      const byMap = (key: string) => form?.fields.find((f) => f.mapsTo === key && values[f.id] !== undefined && values[f.id] !== "");
      const mapped = (key: string) => {
        const f = byMap(key);
        return f ? values[f.id] : undefined;
      };
      const name = String(mapped("name") ?? values["ff-1"] ?? values["ff-6"] ?? values["name"] ?? "Form submission");
      const rawNotes = String(mapped("notes") ?? values["ff-2"] ?? values["ff-7"] ?? values["notes"] ?? "");
      const notes = action.viaPublicLink ? `${rawNotes}\n\n— Submitted through the public form link` : rawNotes;
      const dueRaw = (mapped("dueDate") ?? values["ff-3"] ?? values["ff-8"] ?? values["dueDate"] ?? null) as string | null;
      const due = typeof dueRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
      const requester = mapped("assigneeId") ?? values["ff-4"] ?? values["assigneeId"];
      const urgency = String(mapped("priority") ?? values["ff-5"] ?? "");
      let assigneeId: ID | null = state.currentUserId;
      if (typeof requester === "string" && state.users.some((u) => u.id === requester)) {
        assigneeId = requester;
      } else if (Array.isArray(requester) && requester[0]) {
        assigneeId = requester[0];
      }
      const firstSection = state.sections
        .filter((s) => s.projectId === project.id)
        .sort((a, b) => a.order - b.order)[0];
      const task: Task = {
        id: uid("tk"),
        name,
        notes,
        completed: false,
        completedAt: null,
        assigneeId,
        creatorId: state.currentUserId,
        projectId: project.id,
        sectionId: firstSection?.id ?? null,
        parentId: null,
        dueDate: due,
        dueTime: null,
        startDate: due ? addDays(due, -3) : null,
        order: nextTaskOrder(state.tasks, firstSection?.id ?? null),
        priority: urgency === "High" ? "high" : urgency === "Low" ? "low" : urgency === "Medium" ? "medium" : null,
        tagIds: [],
        followerIds: [state.currentUserId],
        customFields: {},
        blockedByIds: [],
        blockingIds: [],
        attachments: [],
        likeUserIds: [],
        createdAt: nowStamp(),
        modifiedAt: nowStamp(),
      };
      let next: AppState = {
        ...state,
        tasks: [...state.tasks, task],
        forms: state.forms.map((f) =>
          f.id === form?.id ? { ...f, submissions: f.submissions + 1 } : f
        ),
        activities: pushActivity(state.activities, task.id, state.currentUserId, "created", {
          detail: "submitted through a form",
        }),
      };
      next = applyRules(next, {
        type: "task-added",
        projectId: project.id,
        taskId: task.id,
      });
      return next;
    }

    /* --------------------------------------------------------- templates */
    case "template/instantiate": {
      const template = state.templates.find((t) => t.id === action.templateId);
      if (!template) return state;
      const projectId = action.projectId ?? uid("p");
      const project: Project = {
        id: projectId,
        name: action.name,
        teamId: template.teamId,
        color: template.color,
        icon: template.icon,
        description: template.description,
        ownerId: state.currentUserId,
        memberIds: [state.currentUserId],
        privacy: "public",
        starred: false,
        archived: false,
        dueDate: null,
        createdAt: nowStamp(),
        defaultView: "board",
        status: { state: "none", text: "" },
        statusUpdates: [],
        fieldIds: ["fld-priority", "fld-stage", "fld-effort"],
      };
      const sections: Section[] = [];
      const tasks: Task[] = [];
      template.sections.forEach((section, si) => {
        const sectionId = uid("sec");
        sections.push({
          id: sectionId,
          projectId,
          name: section.name,
          order: (si + 1) * 1000,
          collapsed: false,
        });
        section.tasks.forEach((t, ti) => {
          tasks.push({
            id: uid("tk"),
            name: t.name,
            notes: "",
            completed: false,
            completedAt: null,
            assigneeId: state.currentUserId,
            creatorId: state.currentUserId,
            projectId,
            sectionId,
            parentId: null,
            dueDate: t.offsetDays != null ? addDays(todayISO(), t.offsetDays) : null,
            dueTime: null,
            startDate: todayISO(),
            order: (ti + 1) * 1000,
            priority: t.priority ?? null,
            tagIds: [],
            followerIds: [state.currentUserId],
            customFields: {},
            blockedByIds: [],
            blockingIds: [],
            attachments: [],
            likeUserIds: [],
            createdAt: nowStamp(),
            modifiedAt: nowStamp(),
            milestone: t.milestone,
          });
        });
      });
      return {
        ...state,
        projects: [...state.projects, project],
        sections: [...state.sections, ...sections],
        tasks: [...state.tasks, ...tasks],
      };
    }

    /* ---------------------------------------------------------- meetings */
    case "meeting/create": {
      const meeting: Meeting = {
        id: uid("mtg"),
        title: action.title,
        startedAt: nowStamp(),
        durationMin: 25,
        attendeeIds: [state.currentUserId],
        projectId: state.projects[0]?.id ?? null,
        source: "recall",
        summary:
          "Recording finished. Waypoint AI is extracting the summary and action items — this demo generates them from the transcript below.",
        transcript: [
          {
            id: uid("tr"),
            speakerId: state.currentUserId,
            at: "00:05",
            text: "Quick sync — let us capture what changed and who is picking up what.",
          },
        ],
        actionItems: [],
      };
      return { ...state, meetings: [meeting, ...state.meetings] };
    }

    case "form/update":
      return {
        ...state,
        forms: state.forms.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)),
      };

    case "form/create": {
      const project = state.projects.find((p) => p.id === action.projectId);
      if (!project) return state;
      const fid = uid("form");
      return {
        ...state,
        forms: [
          ...state.forms,
          {
            id: fid,
            projectId: project.id,
            title: `${project.name} request`,
            description: "Tell us what you need. We'll turn it into a task and follow up.",
            submissions: 0,
            public: false,
            fields: [
              { id: `${fid}-name`, label: "What do you need?", type: "text", required: true, mapsTo: "name" },
              { id: `${fid}-notes`, label: "Details", type: "textarea", mapsTo: "notes" },
              { id: `${fid}-due`, label: "When do you need it?", type: "date", mapsTo: "dueDate" },
            ],
          },
        ],
      };
    }


    /* -------------------------------------------------- dev / tickets */
    case "ticket/create": {
      const space = state.devSpaces.find((sp) => sp.id === action.spaceId);
      const count = state.tickets.filter((t) => t.spaceId === action.spaceId).length + 418;
      const ticket: Ticket = {
        id: uid("ticket"),
        spaceId: action.spaceId,
        key: `${space?.key ?? "DEV"}-${count}`,
        title: action.title,
        description: action.description ?? "",
        status: "todo",
        priority: null,
        assigneeId: state.currentUserId,
        reporterId: state.currentUserId,
        storyPoints: null,
        sprint: "Sprint 24.8",
        labelIds: [],
        linkedTaskId: null,
        agentSessionIds: [],
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
      };
      return { ...state, tickets: [ticket, ...state.tickets] };
    }

    case "ticket/update": {
      const next: AppState = {
        ...state,
        tickets: state.tickets.map((t) =>
          t.id === action.id ? { ...t, ...action.patch, updatedAt: nowStamp() } : t
        ),
      };
      return action.patch.status ? automateReleases(next, action.id) : next;
    }

    case "session/start": {
      const teammate = state.users.find((u) => u.id === action.teammateId);
      if (!teammate) return state;
      const steps = [
        "Reading the ticket and linked task context",
        "Searching the codebase for the relevant module",
        "Drafting a change and running the test suite",
        "Waiting for a human review",
      ].map((label, i) => ({
        id: uid("sstep"),
        at: i === 0 ? nowStamp() : "",
        label,
        detail: i === 1 ? "6 files matched" : undefined,
      }));
      const session: AgentSession = {
        id: uid("session"),
        teammateId: action.teammateId,
        ticketId: action.ticketId,
        taskId: action.taskId,
        title: action.prompt.slice(0, 80),
        prompt: action.prompt,
        status: "running",
        startedAt: nowStamp(),
        durationSec: 0,
        tokens: 1200,
        steps: steps.map((st, i) => ({ ...st, at: i === 0 ? nowStamp() : "" })),
        artifacts: [],
      };
      return {
        ...state,
        agentSessions: [session, ...state.agentSessions],
        tickets: action.ticketId
          ? state.tickets.map((t) =>
              t.id === action.ticketId
                ? {
                    ...t,
                    agentSessionIds: [...t.agentSessionIds, session.id],
                    updatedAt: nowStamp(),
                  }
                : t
            )
          : state.tickets,
      };
    }

    case "session/advance": {
      const session = state.agentSessions.find((s) => s.id === action.id);
      if (!session || session.status !== "running") return state;
      const nextIndex = session.steps.findIndex((st) => !st.at);
      if (nextIndex === -1) return state;
      const steps = session.steps.map((st, i) =>
        i === nextIndex ? { ...st, at: nowStamp() } : st
      );
      const finished = steps.every((st) => st.at);
      const ticket = finished && session.ticketId ? state.tickets.find((t) => t.id === session.ticketId) : null;
      const toReview =
        !!ticket &&
        ticket.status !== "done" &&
        !!state.devSpaces.find((d) => d.id === ticket.spaceId)?.settings?.sessionToReview;
      return {
        ...state,
        tickets: toReview
          ? state.tickets.map((t) => (t.id === ticket!.id ? { ...t, status: "review", updatedAt: nowStamp() } : t))
          : state.tickets,
        agentSessions: state.agentSessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                steps,
                status: finished ? "done" : "running",
                durationSec: s.durationSec + 42,
                tokens: s.tokens + 2400,
                artifacts: finished
                  ? [
                      { name: "agent/atlas-fix", kind: "branch" },
                      { name: "+96 −18 diff", kind: "diff" },
                      { name: "tests passing", kind: "test" },
                    ]
                  : s.artifacts,
              }
            : s
        ),
      };
    }

    case "session/stop":
      return {
        ...state,
        agentSessions: state.agentSessions.map((s) =>
          s.id === action.id ? { ...s, status: "waiting" } : s
        ),
      };

    case "release/update":
      return {
        ...state,
        releases: state.releases.map((r) =>
          r.id === action.id ? { ...r, ...action.patch } : r
        ),
      };

    /* ------------------------------------------------------- service desk */
    case "service/update":
      return {
        ...state,
        serviceTickets: state.serviceTickets.map((t) =>
          t.id === action.id ? { ...t, ...action.patch } : t
        ),
      };

    /* ------------------------------------------------------------- agency */
    case "portal/publish":
      return {
        ...state,
        portals: state.portals.map((p) =>
          p.id === action.id ? { ...p, status: "live", lastPublishedAt: nowStamp() } : p
        ),
      };

    case "portal/toggleProject":
      return {
        ...state,
        portals: state.portals.map((p) =>
          p.id === action.id
            ? {
                ...p,
                projectIds: p.projectIds.includes(action.projectId)
                  ? p.projectIds.filter((x) => x !== action.projectId)
                  : [...p.projectIds, action.projectId],
              }
            : p
        ),
      };

    /* ------------------------------------------------------ pages / docs */
    case "page/create": {
      const page = {
        id: uid("page"),
        title: action.title,
        body: "",
        authorId: state.currentUserId,
        collaboratorIds: [state.currentUserId],
        projectId: null,
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
        starred: false,
        parentId: action.parentId && state.pages.some((p) => p.id === action.parentId) ? action.parentId : null,
        order: state.pages.filter((p) => (p.parentId ?? null) === (action.parentId ?? null)).length * 1000 + 1000,
      };
      return { ...state, pages: [page, ...state.pages] };
    }

    case "page/update":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, updatedAt: nowStamp() } : p
        ),
      };

    /* ------------------------------------------------------------ tables */
    case "table/recordAdd":
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === action.tableId
            ? {
                ...t,
                records: [...t.records, { id: uid("rec"), values: {} }],
                updatedAt: nowStamp(),
              }
            : t
        ),
      };

    case "table/recordUpdate":
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === action.tableId
            ? {
                ...t,
                records: t.records.map((r) =>
                  r.id === action.recordId
                    ? { ...r, values: { ...r.values, [action.fieldId]: action.value } }
                    : r
                ),
                updatedAt: nowStamp(),
              }
            : t
        ),
      };

    /* ------------------------------------------------------- saved views */
    case "savedView/create":
      return {
        ...state,
        savedViews: [
          ...state.savedViews,
          {
            id: uid("sv"),
            projectId: action.projectId,
            name: action.name,
            view: action.view,
            filters: action.filters,
            sortKey: action.sortKey,
            sortDir: action.sortDir,
            createdBy: state.currentUserId,
          },
        ],
      };

    case "savedView/delete":
      return { ...state, savedViews: state.savedViews.filter((v) => v.id !== action.id) };

    /* -------------------------------------------------------- rbac / admin */
    case "workspace/setRole":
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.userId ? { ...u, workspaceRole: action.role } : u
        ),
      };

    case "project/setRole":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                roles: { ...(p.roles ?? {}), [action.userId]: action.role },
                memberIds: p.memberIds.includes(action.userId)
                  ? p.memberIds
                  : [...p.memberIds, action.userId],
              }
            : p
        ),
      };

    case "project/removeMember":
      return {
        ...state,
        projects: state.projects.map((p) => {
          if (p.id !== action.projectId) return p;
          const roles = { ...(p.roles ?? {}) };
          delete roles[action.userId];
          return {
            ...p,
            roles,
            memberIds: p.memberIds.filter((id) => id !== action.userId),
          };
        }),
      };

    case "invite/create": {
      const invite = {
        id: uid("inv"),
        email: action.email,
        role: action.role,
        projectIds: action.projectIds,
        status: "sent" as const,
        invitedById: state.currentUserId,
        createdAt: nowStamp(),
      };
      return { ...state, invites: [invite, ...state.invites] };
    }

    case "invite/revoke":
      return {
        ...state,
        invites: state.invites.map((i) =>
          i.id === action.id ? { ...i, status: "revoked" } : i
        ),
      };

    case "invite/accept": {
      const invite = state.invites.find((i) => i.id === action.id);
      // only live invitations can be redeemed, and only once per address
      if (!invite || invite.status !== "sent") return state;
      if (state.users.some((u) => u.email.toLowerCase() === invite.email.toLowerCase())) return state;
      const name = invite.email
        .split("@")[0]
        .split(/[._-]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
      const user = {
        id: uid("u"),
        name,
        email: invite.email,
        initials: name
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        color: "blue-green" as const,
        role: invite.role === "guest" ? "Guest" : "Member",
        teamIds: [],
        workspaceRole: invite.role,
      };
      return {
        ...state,
        users: [...state.users, user],
        invites: state.invites.map((i) =>
          i.id === action.id ? { ...i, status: "accepted" } : i
        ),
        projects: state.projects.map((p) =>
          invite.projectIds.includes(p.id)
            ? { ...p, memberIds: [...p.memberIds, user.id] }
            : p
        ),
      };
    }

    case "impersonate": {
      const actor = state.impersonatorId ?? state.currentUserId;
      const returning = action.userId === actor;
      if (returning) {
        return { ...state, currentUserId: actor, impersonatorId: null, impersonationExpiresAt: null, impersonationReason: null };
      }
      const minutes = state.security?.impersonationMinutes ?? 30;
      const actorName = state.users.find((u) => u.id === actor)?.name ?? "An admin";
      return {
        ...state,
        currentUserId: action.userId,
        impersonatorId: actor,
        impersonationExpiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
        impersonationReason: action.reason?.trim() ?? "",
        // the person being viewed always finds out
        notifications: [
          {
            id: uid("n"),
            type: "mention",
            taskId: "",
            actorId: actor,
            createdAt: nowStamp(),
            read: false,
            text: `${actorName} viewed the workspace as you: “${action.reason?.trim() ?? ""}”`,
            recipientId: action.userId,
          },
          ...state.notifications,
        ],
      };
    }

    /* --------------------------------------------------- notifications */
    case "notification/read":
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, read: true } : n
        ),
      };

    case "notification/readAll": {
      const me = state.currentUserId;
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          !n.read && (n.recipientId ?? LEGACY_RECIPIENT) === me ? { ...n, read: true } : n
        ),
      };
    }

    /* -------------------------------------------------------------- ui */
    case "ui/patch":
      return { ...state, ui: { ...state.ui, ...action.patch } };

    case "view/visit": {
      const next = [
        { type: action.kind, id: action.id },
        ...state.recentlyViewed.filter(
          (v) => !(v.type === action.kind && v.id === action.id)
        ),
      ].slice(0, 8);
      return { ...state, recentlyViewed: next };
    }

    case "state/load":
    case "state/replace":
      return action.state;

    default:
      return state;
  }
}

/**
 * Auto-scheduling: when a project has `autoShiftDates`, dependents that would
 * now start on or before their blocker finishes are pushed later (keeping
 * their duration), transitively. Only tasks the actor may edit are moved.
 */
function shiftDependents(state: AppState, taskId: ID, newDue: string, previousDue: string | null): AppState {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task?.projectId) return state;
  const project = state.projects.find((p) => p.id === task.projectId);
  if (!project?.autoShiftDates || !task.blockingIds.length) return state;
  const shifts = dependentShifts(
    state.tasks,
    taskId,
    newDue,
    (t) => canPermission(state, "task:edit", { projectId: t.projectId }),
    project.autoShiftMode === "buffer" && previousDue ? { mode: "buffer", previousDue } : undefined
  );
  if (!shifts.size) return state;
  const stamp = nowStamp();
  let activities = state.activities;
  for (const [id, s] of shifts) {
    activities = pushActivity(activities, id, state.currentUserId, "due-date", {
      to: s.dueDate,
      detail: `shifted ${s.days} day${s.days === 1 ? "" : "s"} by a dependency`,
    });
  }
  return {
    ...state,
    activities,
    tasks: state.tasks.map((t) => {
      const s = shifts.get(t.id);
      return s ? { ...t, startDate: s.startDate, dueDate: s.dueDate, modifiedAt: stamp } : t;
    }),
  };
}

/** Due date of the next occurrence of a recurring task. */
export function nextOccurrenceDate(from: string, r: NonNullable<Task["recurrence"]>): string {
  const n = Math.max(1, Math.round(r.interval || 1));
  switch (r.every) {
    case "day":
      return addDays(from, n);
    case "week":
      return addDays(from, 7 * n);
    case "month":
      return addMonths(from, n);
    case "weekday": {
      let d = from;
      for (let left = n; left > 0; ) {
        d = addDays(d, 1);
        const dow = new Date(`${d}T00:00:00`).getDay();
        if (dow !== 0 && dow !== 6) left--;
      }
      return d;
    }
  }
}

function spawnNextOccurrence(state: AppState, done: Task): AppState {
  const rec = done.recurrence!;
  const base = done.dueDate ?? todayISO();
  const due = nextOccurrenceDate(base, rec);
  const span = done.startDate && done.dueDate ? diffDays(done.dueDate, done.startDate) : null;
  const next: Task = {
    ...done,
    id: uid("tk"),
    completed: false,
    completedAt: null,
    dueDate: due,
    startDate: span !== null ? addDays(due, -span) : null,
    order: done.order + 1,
    recurrence: rec,
    attachments: [],
    likeUserIds: [],
    blockedByIds: [],
    blockingIds: [],
    approvals: done.approvalStatus ? [] : undefined,
    approvalStatus: done.approvalStatus ? "pending" : undefined,
    createdAt: nowStamp(),
    modifiedAt: nowStamp(),
  };
  return {
    ...state,
    tasks: [...state.tasks, next],
    activities: pushActivity(state.activities, next.id, state.currentUserId, "created", {
      detail: `next occurrence of a recurring task, due ${due}`,
    }),
  };
}

/**
 * Release automation (per dev space settings): when every ticket in an open
 * release is done it becomes "ready", with notes generated if enabled.
 */
function automateReleases(state: AppState, ticketId: ID): AppState {
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket) return state;
  const settings = state.devSpaces.find((d) => d.id === ticket.spaceId)?.settings;
  if (!settings) return state;
  return {
    ...state,
    releases: state.releases.map((r) => {
      if (!r.ticketIds.includes(ticketId) || r.status === "shipped") return r;
      const all = r.ticketIds.map((id) => state.tickets.find((t) => t.id === id));
      const allDone = all.length > 0 && all.every((t) => t?.status === "done");
      let next = r;
      if (settings.autoReadyRelease) {
        if (allDone && r.status !== "ready") next = { ...next, status: "ready" };
        if (!allDone && r.status === "ready") next = { ...next, status: "in-progress" };
      }
      if (settings.releaseNotes) next = { ...next, notes: releaseNotes(state, r.id) };
      return next;
    }),
  };
}

/** Markdown-ish release notes from a release's done tickets. */
export function releaseNotes(state: AppState, releaseId: ID): string {
  const release = state.releases.find((r) => r.id === releaseId);
  if (!release) return "";
  const tickets = release.ticketIds
    .map((id) => state.tickets.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t);
  const done = tickets.filter((t) => t.status === "done");
  const open = tickets.filter((t) => t.status !== "done");
  return [
    `${release.name} (${release.version})`,
    "",
    "Shipped:",
    ...(done.length ? done.map((t) => `• ${t.key} ${t.title}`) : ["• Nothing yet"]),
    ...(open.length ? ["", "Still open:", ...open.map((t) => `• ${t.key} ${t.title} (${t.status})`)] : []),
  ].join("\n");
}

/** Remove tasks plus their subtasks and every record that points at them. */
function removeTasks(state: AppState, ids: ID[]): AppState {
  if (!ids.length) return state;
  const index = childIndex(state.tasks);
  const existing = new Set(state.tasks.map((t) => t.id));
  const removed = new Set<ID>();
  for (const id of ids) {
    if (!existing.has(id) || removed.has(id)) continue;
    removed.add(id);
    collectDescendants(state.tasks, id, index).forEach((c) => removed.add(c));
  }
  if (!removed.size) return state;
  const stamp = nowStamp();
  return {
    ...state,
    tasks: state.tasks
      .filter((t) => !removed.has(t.id))
      .map((t) =>
        t.blockedByIds.some((x) => removed.has(x)) || t.blockingIds.some((x) => removed.has(x))
          ? {
              ...t,
              blockedByIds: t.blockedByIds.filter((x) => !removed.has(x)),
              blockingIds: t.blockingIds.filter((x) => !removed.has(x)),
            }
          : t
      ),
    comments: state.comments.filter((c) => !removed.has(c.taskId)),
    activities: state.activities.filter((a) => !removed.has(a.taskId)),
    notifications: state.notifications.filter((n) => !n.taskId || !removed.has(n.taskId)),
    agentRuns: state.agentRuns.map((r) =>
      r.taskId && removed.has(r.taskId) && (r.status === "running" || r.status === "queued")
        ? { ...r, status: "cancelled", finishedAt: stamp }
        : r
    ),
    tickets: state.tickets.map((t) =>
      t.linkedTaskId && removed.has(t.linkedTaskId) ? { ...t, linkedTaskId: null } : t
    ),
    recentlyViewed: state.recentlyViewed.filter((v) => !(v.type === "task" && removed.has(v.id))),
  };
}

function childIndex(tasks: Task[]): Map<ID, ID[]> {
  const children = new Map<ID, ID[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId);
    if (list) list.push(t.id);
    else children.set(t.parentId, [t.id]);
  }
  return children;
}

function collectDescendants(tasks: Task[], id: ID, children = childIndex(tasks)): ID[] {
  const out: ID[] = [];
  const seen = new Set<ID>([id]);
  const stack = [id];
  while (stack.length) {
    for (const child of children.get(stack.pop() as ID) ?? []) {
      if (seen.has(child)) continue; // tolerate corrupted parent cycles
      seen.add(child);
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/* ============================================================ storage */
export const STORAGE_KEY = "waypoint-v1-state";

/**
 * Hydrate persisted state. Migration is by fallback: any top-level collection
 * the stored snapshot lacks (or has in the wrong shape) is taken from the seed,
 * so adding a collection to `types.ts` + the seed is enough.
 */
export function hydrate(raw: string | null): AppState {
  const seed = createSeedState();
  if (!raw) return seed;
  try {
    const parsed = JSON.parse(raw) as Partial<AppState> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) return seed;
    const merged = { ...seed, ...parsed } as AppState;
    const seedRecord = seed as unknown as Record<string, unknown>;
    const mergedRecord = merged as unknown as Record<string, unknown>;
    for (const key of Object.keys(seedRecord)) {
      if (Array.isArray(seedRecord[key]) && !Array.isArray(mergedRecord[key])) {
        mergedRecord[key] = seedRecord[key];
      }
    }
    merged.ui = { ...seed.ui, ...(parsed.ui ?? {}) };
    if (!merged.users.some((u) => u.id === merged.currentUserId)) {
      merged.currentUserId = seed.currentUserId;
    }
    // snapshots written before impersonation was tracked: assume the seed owner
    if (merged.impersonatorId === undefined) {
      merged.impersonatorId =
        merged.currentUserId !== seed.currentUserId ? seed.currentUserId : null;
    }
    const { state: clean, repairs } = sanitizeState(merged);
    if (repairs > 0) console.warn(`Repaired ${repairs} invalid record(s) in saved workspace data`);
    return clean;
  } catch {
    return seed;
  }
}

/** Last-resort shrink when the browser refuses to store the snapshot. */
export function compactForStorage(state: AppState): AppState {
  return {
    ...state,
    activities: state.activities.slice(0, 300),
    notifications: state.notifications.slice(0, 80),
    chatMessages: state.chatMessages.slice(-100),
    agentRuns: state.agentRuns.slice(0, 20),
  };
}


export { applyRules, projectsAndSections };
