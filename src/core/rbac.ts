import type {
  AppState,
  ID,
  Project,
  ProjectRole,
  WorkspaceRole,
} from "./types";

export type Permission =
  | "project:read"
  | "project:create"
  | "project:update"
  | "project:share"
  | "project:delete"
  | "task:create"
  | "task:edit"
  | "task:delete"
  | "comment:create"
  | "field:manage"
  | "rule:manage"
  | "form:manage"
  | "agent:manage"
  | "workspace:invite"
  | "workspace:admin"
  | "billing:manage";

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  owner: 3,
};

const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/** Minimum project role required for each project-scoped permission. */
const PROJECT_PERMISSION_MIN: Partial<Record<Permission, ProjectRole>> = {
  "project:read": "viewer",
  "comment:create": "commenter",
  "task:create": "editor",
  "task:edit": "editor",
  "rule:manage": "editor",
  "field:manage": "editor",
  "form:manage": "editor",
  "task:delete": "owner",
  "project:update": "owner",
  "project:share": "owner",
  "project:delete": "owner",
};

/** Minimum workspace role required for workspace-scoped permissions. */
const WORKSPACE_PERMISSION_MIN: Partial<Record<Permission, WorkspaceRole>> = {
  "project:create": "member",
  "agent:manage": "member",
  "workspace:invite": "admin",
  "workspace:admin": "admin",
  "billing:manage": "owner",
};

export const PROJECT_ROLES: ProjectRole[] = ["viewer", "commenter", "editor", "owner"];
export const WORKSPACE_ROLES: WorkspaceRole[] = ["guest", "member", "admin", "owner"];

export const ROLE_LABEL: Record<ProjectRole | WorkspaceRole, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
  owner: "Owner",
  guest: "Guest",
  member: "Member",
  admin: "Admin",
};

export const WORKSPACE_ROLE_DESCRIPTION: Record<WorkspaceRole, string> = {
  owner: "Full control, billing and workspace deletion",
  admin: "Manage members, roles and every project",
  member: "Create projects and work in public projects",
  guest: "Only projects they are explicitly invited to",
};

export const PROJECT_ROLE_DESCRIPTION: Record<ProjectRole, string> = {
  owner: "Manage the project, members and automations",
  editor: "Create and edit tasks, rules and fields",
  commenter: "Comment and react, cannot change tasks",
  viewer: "Read-only access",
};

export function effectiveProjectRole(
  state: AppState,
  project: Project,
  userId: ID = state.currentUserId
): ProjectRole | null {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  const workspaceRole = user.workspaceRole ?? "member";
  // Workspace owners and admins administer every project, regardless of an
  // explicit (possibly downgraded) project role.
  if (workspaceRole === "owner" || workspaceRole === "admin") return "owner";
  if (user.isAgent) return project.roles?.[userId] ?? (project.memberIds.includes(userId) ? "editor" : null);
  const explicit = project.roles?.[userId];
  if (explicit) return explicit;
  if (workspaceRole === "guest") return project.memberIds.includes(userId) ? "viewer" : null;
  if (project.privacy === "private") {
    return project.memberIds.includes(userId) ? "editor" : null;
  }
  return "editor";
}

export function can(
  state: AppState,
  permission: Permission,
  opts: { projectId?: ID | null; userId?: ID } = {}
): boolean {
  const userId = opts.userId ?? state.currentUserId;
  const user = state.users.find((u) => u.id === userId);
  if (!user) return false;
  const workspaceRole = user.workspaceRole ?? "member";
  const workspaceRank = WORKSPACE_ROLE_RANK[workspaceRole];

  const workspaceMin = WORKSPACE_PERMISSION_MIN[permission];
  if (workspaceMin && workspaceRank < WORKSPACE_ROLE_RANK[workspaceMin]) {
    // project owners still cannot grant workspace-level powers
    return false;
  }

  const projectMin = PROJECT_PERMISSION_MIN[permission];
  if (projectMin) {
    if (!opts.projectId) {
      // personal work (no project) is allowed for everyone except guests
      if (workspaceRole === "guest") return projectMin === "viewer";
      return true;
    }
    const project = state.projects.find((p) => p.id === opts.projectId);
    if (!project) return false;
    const role = effectiveProjectRole(state, project, userId);
    if (!role) return false;
    return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[projectMin];
  }

  if (workspaceMin) return true;
  return workspaceRole !== "guest";
}

/** Tasks inherit permissions from their project, subtasks from their parent. */
export function canEditTask(state: AppState, taskId: ID): boolean {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return false;
  return can(state, "task:edit", { projectId: task.projectId });
}

export function visibleProjects(state: AppState, userId = state.currentUserId): Project[] {
  return state.projects.filter((p) => {
    if (p.archived) return false;
    return can(state, "project:read", { projectId: p.id, userId });
  });
}

export interface PermissionRow {
  permission: Permission;
  label: string;
  description: string;
}

export const PROJECT_PERMISSION_MATRIX: PermissionRow[] = [
  { permission: "project:read", label: "View project", description: "See tasks, files and comments" },
  { permission: "comment:create", label: "Comment", description: "Comment on tasks, like and follow" },
  { permission: "task:create", label: "Create tasks", description: "Add tasks, subtasks and sections" },
  { permission: "task:edit", label: "Edit tasks", description: "Change fields, assignees, due dates" },
  { permission: "rule:manage", label: "Manage automations", description: "Create and toggle rules" },
  { permission: "field:manage", label: "Manage fields", description: "Add and remove custom fields" },
  { permission: "task:delete", label: "Delete tasks", description: "Remove tasks and their subtasks" },
  { permission: "project:share", label: "Share project", description: "Invite members and change roles" },
  { permission: "project:delete", label: "Delete project", description: "Archive or delete the project" },
];

export const WORKSPACE_PERMISSION_MATRIX: PermissionRow[] = [
  { permission: "project:create", label: "Create projects", description: "Start new projects and use templates" },
  { permission: "agent:manage", label: "Manage AI teammates", description: "Create, configure and pause agents" },
  { permission: "workspace:invite", label: "Invite members", description: "Invite and revoke workspace access" },
  { permission: "workspace:admin", label: "Administer workspace", description: "Change roles, teams and settings" },
  { permission: "billing:manage", label: "Manage billing", description: "Plan, seats and invoices" },
];

export function projectMatrixValue(role: ProjectRole, permission: Permission): boolean {
  const min = PROJECT_PERMISSION_MIN[permission];
  if (!min) return false;
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[min];
}

export function workspaceMatrixValue(role: WorkspaceRole, permission: Permission): boolean {
  const min = WORKSPACE_PERMISSION_MIN[permission];
  if (!min) return false;
  return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[min];
}

/* ======================================================= read scoping */

function isWorkspaceAdmin(state: AppState, userId: ID): boolean {
  const role = state.users.find((u) => u.id === userId)?.workspaceRole ?? "member";
  return role === "owner" || role === "admin";
}

/**
 * Who is really driving the session. While an admin is impersonating someone
 * ("View as"), `currentUserId` is the impersonated user and `impersonatorId`
 * is the admin. Only the real actor may start or stop impersonation.
 */
/** Owner of a chat thread; threads saved before ownership existed belong to the seed owner. */
export const threadOwner = (thread: { ownerId?: ID }): ID => thread.ownerId ?? "u-maya";

export function realActorId(state: AppState): ID {
  return state.impersonatorId ?? state.currentUserId;
}

export function canImpersonate(state: AppState, targetId: ID): boolean {
  const actor = realActorId(state);
  const target = state.users.find((u) => u.id === targetId);
  if (!target || target.isAgent) return false;
  if (targetId === actor) return true; // returning to yourself is always allowed
  return can(state, "workspace:admin", { userId: actor });
}

/**
 * Task visibility. A task is readable when:
 *  - its project is readable, or
 *  - it is a subtask of a readable task (subtasks inherit their parent), or
 *  - it has no project and the user created, owns or follows it, or
 *  - it is assigned to the user (assignees can always see their own work).
 */
export function taskVisibility(state: AppState, userId: ID = state.currentUserId) {
  if (isWorkspaceAdmin(state, userId)) {
    return { all: true as const, readableProjects: null, isVisible: (_id: ID) => true };
  }
  const readableProjects = new Set(
    state.projects
      .filter((p) => can(state, "project:read", { projectId: p.id, userId }))
      .map((p) => p.id)
  );
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const memo = new Map<ID, boolean>();
  const visit = (id: ID, depth: number): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const t = byId.get(id);
    let v = false;
    if (t && depth < 32) {
      v =
        t.assigneeId === userId ||
        (t.projectId !== null && readableProjects.has(t.projectId)) ||
        (t.parentId !== null && byId.has(t.parentId)
          ? visit(t.parentId, depth + 1)
          : t.projectId === null &&
            (t.creatorId === userId || t.followerIds.includes(userId)));
    }
    memo.set(id, v);
    return v;
  };
  return { all: false as const, readableProjects, isVisible: (id: ID) => visit(id, 0) };
}

/**
 * The slice of the workspace the current user is allowed to read. The
 * reducer always works on the full state; the UI and the AI engine only ever
 * see this projection, so private projects, their tasks, comments, activity,
 * rules and forms never reach a member or guest who was not invited.
 *
 * Owners and admins read everything, so they get the original object back
 * (no copying, referential equality preserved).
 */
export function scopeStateForViewer(state: AppState): AppState {
  const userId = state.currentUserId;
  const vis = taskVisibility(state, userId);
  // AI chats are personal for everyone, admins included
  const ownThreads = state.chatThreads.filter((t) => threadOwner(t) === userId);
  const chat =
    ownThreads.length === state.chatThreads.length
      ? null
      : (() => {
          const ids = new Set(ownThreads.map((t) => t.id));
          return {
            chatThreads: ownThreads,
            chatMessages: state.chatMessages.filter((m) => ids.has(m.threadId)),
            activeThreadId:
              state.activeThreadId && ids.has(state.activeThreadId) ? state.activeThreadId : null,
          };
        })();
  // notifications are personal for everyone, admins included
  const mineOnly = state.notifications.filter((n) => (n.recipientId ?? "u-maya") === userId);
  const personal = {
    ...(chat ?? {}),
    ...(mineOnly.length !== state.notifications.length ? { notifications: mineOnly } : {}),
  };
  if (vis.all) return Object.keys(personal).length ? { ...state, ...personal } : state;
  const readable = vis.readableProjects;
  const isGuest =
    (state.users.find((u) => u.id === userId)?.workspaceRole ?? "member") === "guest";
  const projectOk = (id: ID | null | undefined) => id != null && readable.has(id);
  const taskOk = (id: ID | null | undefined) => id != null && vis.isVisible(id);

  const tasks = state.tasks
    .filter((t) => vis.isVisible(t.id))
    .map((t) => {
      const blockedByIds = t.blockedByIds.filter(taskOk);
      const blockingIds = t.blockingIds.filter(taskOk);
      return blockedByIds.length === t.blockedByIds.length &&
        blockingIds.length === t.blockingIds.length
        ? t
        : { ...t, blockedByIds, blockingIds };
    });

  return {
    ...state,
    projects: state.projects.filter((p) => readable.has(p.id)),
    sections: state.sections.filter((s) => readable.has(s.projectId)),
    tasks,
    comments: state.comments.filter((c) => taskOk(c.taskId)),
    activities: state.activities.filter((a) => taskOk(a.taskId) || projectOk(a.taskId)),
    notifications: mineOnly.filter((n) => !n.taskId || taskOk(n.taskId)),
    messages: state.messages.filter((m) => projectOk(m.projectId)),
    taskTemplates: state.taskTemplates.filter((t) => projectOk(t.projectId)),
    rules: state.rules.filter((r) => projectOk(r.projectId)),
    forms: state.forms.filter((f) => projectOk(f.projectId)),
    savedViews: state.savedViews.filter((v) => projectOk(v.projectId)),
    statusUpdates: state.statusUpdates.filter((u) => projectOk(u.projectId)),
    agentRuns: state.agentRuns.filter((r) =>
      r.taskId ? taskOk(r.taskId) : !r.projectId || projectOk(r.projectId)
    ),
    goals: state.goals
      .filter((g) => !isGuest || g.ownerId === userId)
      .map((g) => (g.projectIds.every(projectOk) ? g : { ...g, projectIds: g.projectIds.filter(projectOk) })),
    portfolios: state.portfolios
      .filter((p) => p.ownerId === userId || p.memberIds.includes(userId))
      .map((p) => (p.projectIds.every(projectOk) ? p : { ...p, projectIds: p.projectIds.filter(projectOk) })),
    meetings: state.meetings.filter(
      (m) => m.attendeeIds.includes(userId) || (!isGuest && (!m.projectId || projectOk(m.projectId)))
    ),
    invites: state.invites.filter((i) => i.invitedById === userId),
    auditLog: [], // security events are for workspace admins only
    recentlyViewed: state.recentlyViewed.filter((v) =>
      v.type === "project" ? projectOk(v.id) : taskOk(v.id)
    ),
    ...(chat ?? {}),
    // Guests only see what they were explicitly invited to.
    ...(isGuest
      ? {
          tickets: [],
          agentSessions: [],
          releases: [],
          serviceTickets: [],
          clients: [],
          contacts: [],
          portals: [],
          tables: [],
          clientNotes: [],
          pages: state.pages.filter(
            (p) => p.authorId === userId || p.collaboratorIds.includes(userId)
          ),
        }
      : {}),
  };
}

/* ===================================================== AI teammates */

/** Scope an agent needs for each kind of run step. */
export const AGENT_STEP_SCOPE: Record<string, string> = {
  ack: "scope-projects",
  plan: "scope-create",
  subtask: "scope-create",
  comment: "scope-comments",
  field: "scope-assign",
  complete: "scope-assign",
  status: "scope-status",
  done: "scope-projects",
};

/**
 * Agents act under their *own* grants, never the human who assigned them:
 * they must be active, hold the OAuth-style scope for the step, and have the
 * project in their `projectIds` (or an explicit editor+ role on it).
 */
export function agentCan(state: AppState, agentId: ID, scope: string, projectId: ID | null): boolean {
  const agent = state.users.find((u) => u.id === agentId);
  if (!agent?.isAgent || agent.agentStatus !== "active") return false;
  // read + comment are baseline scopes every agent holds (shown as "required" in the UI)
  const required = scope === "scope-projects" || scope === "scope-comments";
  if (!required && !(agent.authScopes ?? []).includes(scope)) return false;
  if (!projectId) return true; // personal task: the assigner owns it
  const project = state.projects.find((p) => p.id === projectId);
  if (!project || project.archived) return false;
  if ((agent.projectIds ?? []).includes(projectId)) return true;
  const role = effectiveProjectRole(state, project, agentId);
  return role === "editor" || role === "owner";
}
