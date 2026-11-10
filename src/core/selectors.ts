import type {
  AppState,
  Goal,
  ID,
  Project,
  Section,
  Task,
  User,
} from "./types";
import {
  addDays,
  diffDays,
  groupBy,
  pct,
  sortByOrder,
  todayISO,
} from "./utils";

export const selectProject = (state: AppState, id: ID) =>
  state.projects.find((p) => p.id === id);

export const selectTask = (state: AppState, id: ID) =>
  state.tasks.find((t) => t.id === id);

export const selectUser = (state: AppState, id: ID | null | undefined) =>
  state.users.find((u) => u.id === id);

export const sectionsOf = (state: AppState, projectId: ID): Section[] =>
  [...state.sections]
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.order - b.order);

export function projectTasks(state: AppState, projectId: ID): Task[] {
  return sortByOrder(
    state.tasks.filter((t) => t.projectId === projectId && !t.parentId)
  );
}

export function sectionTasks(
  state: AppState,
  sectionId: ID | null,
  opts: { includeCompleted?: boolean } = {}
): Task[] {
  const includeCompleted = opts.includeCompleted ?? true;
  return sortByOrder(
    state.tasks.filter(
      (t) =>
        t.sectionId === sectionId &&
        !t.parentId &&
        (includeCompleted || !t.completed)
    )
  );
}

export function subtasksOf(state: AppState, taskId: ID): Task[] {
  return sortByOrder(state.tasks.filter((t) => t.parentId === taskId));
}

export function rootTasksOf(state: AppState, projectId: ID): Task[] {
  return sortByOrder(
    state.tasks.filter((t) => t.projectId === projectId && !t.parentId)
  );
}

/* ------------------------------------------------------------- my tasks */
export interface MyTaskBuckets {
  recent: Task[];
  today: Task[];
  upcoming: Task[];
  later: Task[];
  completed: Task[];
  noDate: Task[];
}

export function myTasks(state: AppState, userId = state.currentUserId): MyTaskBuckets {
  const mine = state.tasks.filter(
    (t) => t.assigneeId === userId && !t.parentId
  );
  const today = todayISO();
  const recent = mine
    .filter((t) => {
      if (t.completed) return false;
      const age = diffDays(today, t.createdAt.slice(0, 10));
      return age >= -1 && age <= 3;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);
  const active = mine.filter((t) => !t.completed);
  const withDate = active.filter((t) => t.dueDate);
  return {
    recent,
    today: sortByOrder(withDate.filter((t) => (t.dueDate as string) <= today)),
    upcoming: sortByOrder(
      withDate.filter(
        (t) => (t.dueDate as string) > today && diffDays(t.dueDate as string, today) <= 7
      )
    ),
    later: sortByOrder(withDate.filter((t) => diffDays(t.dueDate as string, today) > 7)),
    noDate: sortByOrder(active.filter((t) => !t.dueDate)),
    completed: sortByOrder(mine.filter((t) => t.completed)).slice(0, 25),
  };
}

export function myTaskCount(state: AppState, userId = state.currentUserId): number {
  return state.tasks.filter(
    (t) => t.assigneeId === userId && !t.completed && !t.parentId
  ).length;
}

/* -------------------------------------------------------------- inbox */
export interface InboxItem {
  id: string;
  kind: "notification" | "activity";
  createdAt: string;
  actorId: ID;
  taskId: ID | null;
  text: string;
  read: boolean;
  type: string;
}

export function inboxItems(state: AppState): InboxItem[] {
  const notifications: InboxItem[] = state.notifications.map((n) => ({
    id: n.id,
    kind: "notification",
    createdAt: n.createdAt,
    actorId: n.actorId,
    taskId: n.taskId,
    text: n.text,
    read: n.read,
    type: n.type,
  }));
  const activities: InboxItem[] = state.activities
    .filter((a) => a.actorId !== state.currentUserId)
    .slice(0, 40)
    .map((a) => {
      const task = state.tasks.find((t) => t.id === a.taskId);
      const label =
        a.type === "completed"
          ? `completed ${task?.name ?? "a task"}`
          : a.type === "section"
            ? `moved ${task?.name ?? "a task"} to ${a.to}`
            : a.type === "assigned"
              ? `assigned ${task?.name ?? "a task"} to ${a.to}`
              : a.type === "comment"
                ? `commented on ${task?.name ?? "a task"}`
                : a.type === "priority"
                  ? `set priority to ${a.to} on ${task?.name ?? "a task"}`
                  : a.type === "due-date"
                    ? `changed the due date of ${task?.name ?? "a task"}`
                    : `updated ${task?.name ?? "a task"}`;
      return {
        id: a.id,
        kind: "activity" as const,
        createdAt: a.createdAt,
        actorId: a.actorId,
        taskId: a.taskId,
        text: label,
        read: true,
        type: a.type,
      };
    });
  return [...notifications, ...activities].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}

export function unreadCount(state: AppState): number {
  return state.notifications.filter((n) => !n.read).length;
}

/* ------------------------------------------------------------- metrics */
export function projectStats(state: AppState, projectId: ID) {
  const tasks = rootTasksOf(state, projectId);
  const done = tasks.filter((t) => t.completed);
  const overdue = tasks.filter(
    (t) => !t.completed && t.dueDate && t.dueDate < todayISO()
  );
  const thisWeek = tasks.filter(
    (t) =>
      !t.completed &&
      t.dueDate &&
      diffDays(t.dueDate, todayISO()) >= 0 &&
      diffDays(t.dueDate, todayISO()) <= 7
  );
  return {
    total: tasks.length,
    done: done.length,
    open: tasks.length - done.length,
    overdue: overdue.length,
    thisWeek: thisWeek.length,
    percent: pct(done.length, tasks.length),
  };
}

export function completionSeries(state: AppState, projectId: ID, days = 14) {
  const series: { date: string; completed: number; created: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(todayISO(), -i);
    const completed = state.tasks.filter(
      (t) =>
        t.projectId === projectId &&
        t.completedAt &&
        t.completedAt.slice(0, 10) === date
    ).length;
    const created = state.tasks.filter(
      (t) => t.projectId === projectId && t.createdAt.slice(0, 10) === date
    ).length;
    series.push({ date, completed, created });
  }
  return series;
}

export function tasksByAssignee(state: AppState, projectIds: ID[]) {
  const counts = new Map<ID | "none", number>();
  for (const t of state.tasks) {
    if (!t.projectId || !projectIds.includes(t.projectId) || t.completed || t.parentId)
      continue;
    const key = t.assigneeId ?? "none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({
      user: state.users.find((u) => u.id === id),
      id,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

export function workloadByWeek(
  state: AppState,
  projectIds: ID[],
  weeks = 4
): { weekStart: string; rows: { userId: ID; count: number }[] }[] {
  const out: { weekStart: string; rows: { userId: ID; count: number }[] }[] = [];
  const today = todayISO();
  for (let w = 0; w < weeks; w += 1) {
    const start = addDays(today, w * 7);
    const end = addDays(start, 6);
    const rows = state.users
      .map((u) => ({
        userId: u.id,
        count: state.tasks.filter(
          (t) =>
            t.assigneeId === u.id &&
            !t.completed &&
            t.dueDate &&
            t.dueDate >= start &&
            t.dueDate <= end &&
            t.projectId &&
            projectIds.includes(t.projectId)
        ).length,
      }))
      .filter((r) => r.count > 0);
    out.push({ weekStart: start, rows });
  }
  return out;
}

export function goalProgress(goal: Goal): number {
  const span = goal.targetValue - goal.startValue;
  if (span === 0) return 100;
  return Math.max(
    0,
    Math.min(100, Math.round(((goal.currentValue - goal.startValue) / span) * 100))
  );
}

export function goalChildren(state: AppState, goalId: ID): Goal[] {
  return state.goals.filter((g) => g.parentId === goalId);
}

export function portfolioRollup(state: AppState, projectIds: ID[]) {
  const stats = projectIds.map((id) => projectStats(state, id));
  const total = stats.reduce((n, s) => n + s.total, 0);
  const done = stats.reduce((n, s) => n + s.done, 0);
  const overdue = stats.reduce((n, s) => n + s.overdue, 0);
  return { total, done, overdue, percent: pct(done, total) };
}

/* -------------------------------------------------------------- search */
export interface SearchResults {
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
  users: User[];
  tags: { id: ID; name: string }[];
}

export function searchAll(state: AppState, rawQuery: string): SearchResults {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return { tasks: [], projects: [], goals: [], users: [], tags: [] };
  const hit = (s: string) => s.toLowerCase().includes(q);
  return {
    tasks: state.tasks.filter(
      (t) =>
        !t.parentId &&
        (hit(t.name) ||
          hit(t.notes) ||
          state.comments.some((c) => c.taskId === t.id && hit(c.text)))
    ),
    projects: state.projects.filter(
      (p) => hit(p.name) || hit(p.description ?? "")
    ),
    goals: state.goals.filter((g) => hit(g.name) || hit(g.description)),
    users: state.users.filter((u) => hit(u.name) || hit(u.email)),
    tags: state.tags.filter((t) => hit(t.name)),
  };
}

/* ------------------------------------------------------------- filters */
export interface TaskFilters {
  text?: string;
  assigneeIds?: ID[];
  tagIds?: ID[];
  completed?: "all" | "open" | "done";
  due?: "any" | "overdue" | "today" | "week" | "none";
  priority?: Task["priority"] | "any";
  fieldId?: ID;
  fieldValue?: string;
}

export function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  const today = todayISO();
  return tasks.filter((t) => {
    if (filters.text && !t.name.toLowerCase().includes(filters.text.toLowerCase()))
      return false;
    if (filters.assigneeIds?.length && !filters.assigneeIds.includes(t.assigneeId ?? ""))
      return false;
    if (filters.tagIds?.length && !filters.tagIds.some((id) => t.tagIds.includes(id)))
      return false;
    if (filters.completed === "open" && t.completed) return false;
    if (filters.completed === "done" && !t.completed) return false;
    if (filters.due && filters.due !== "any") {
      if (filters.due === "none" && t.dueDate) return false;
      if (filters.due !== "none" && !t.dueDate) return false;
      if (filters.due === "overdue" && !(t.dueDate && t.dueDate < today && !t.completed))
        return false;
      if (filters.due === "today" && t.dueDate !== today) return false;
      if (
        filters.due === "week" &&
        !(t.dueDate && diffDays(t.dueDate, today) >= 0 && diffDays(t.dueDate, today) <= 7)
      )
        return false;
    }
    if (filters.priority && filters.priority !== "any" && t.priority !== filters.priority)
      return false;
    if (filters.fieldId) {
      const v = t.customFields[filters.fieldId];
      if (filters.fieldValue && String(v ?? "") !== filters.fieldValue) return false;
    }
    return true;
  });
}

export type SortKey =
  | "order"
  | "name"
  | "due"
  | "assignee"
  | "priority"
  | "created"
  | "modified";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function sortTasks(
  state: AppState,
  tasks: Task[],
  key: SortKey,
  dir: "asc" | "desc"
): Task[] {
  const sign = dir === "asc" ? 1 : -1;
  const sorted = [...tasks].sort((a, b) => {
    switch (key) {
      case "name":
        return a.name.localeCompare(b.name) * sign;
      case "due":
        return ((a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")) * sign;
      case "assignee": {
        const an = selectUser(state, a.assigneeId)?.name ?? "zzz";
        const bn = selectUser(state, b.assigneeId)?.name ?? "zzz";
        return an.localeCompare(bn) * sign;
      }
      case "priority":
        return (
          ((a.priority ? PRIORITY_RANK[a.priority] : 9) -
            (b.priority ? PRIORITY_RANK[b.priority] : 9)) *
          sign
        );
      case "created":
        return a.createdAt.localeCompare(b.createdAt) * sign;
      case "modified":
        return a.modifiedAt.localeCompare(b.modifiedAt) * sign;
      default:
        return (a.order - b.order) * sign;
    }
  });
  return sorted;
}

/* ---------------------------------------------------------- misc groups */
export function groupInboxByDay(items: InboxItem[]) {
  return groupBy(items, (item) => item.createdAt.slice(0, 10));
}

export const VIEW_LABEL: Record<string, string> = {
  overview: "Overview",
  list: "List",
  board: "Board",
  timeline: "Timeline",
  calendar: "Calendar",
  dashboard: "Dashboard",
  files: "Files",
  messages: "Messages",
};
