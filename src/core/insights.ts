/**
 * Derived intelligence over workspace state: goal health, project risk,
 * workload capacity and rebalancing, and plain-English task search.
 * Pure functions — callers pass the (scoped) state they are allowed to see.
 */
import type { AppState, Goal, GoalStatus, ID, Priority, Task, User } from "./types";
import { effectiveProjectRole } from "./rbac";
import { analyzeSchedule } from "./schedule";
import { addDays, diffDays, startOfWeek, todayISO } from "./utils";

const rootTasks = (state: AppState, projectId: ID) =>
  state.tasks.filter((t) => t.projectId === projectId && !t.parentId);

/* ================================================================ goals */

export interface GoalHealth {
  /** 0–100 */
  progress: number;
  /** where progress "should" be given elapsed time, 0–100 */
  expected: number;
  status: GoalStatus;
  source: "manual" | "projects";
  /** human explanation */
  reason: string;
}

function manualProgress(goal: Goal): number {
  const span = goal.targetValue - goal.startValue;
  if (span === 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((goal.currentValue - goal.startValue) / span) * 100)));
}

export function goalHealth(state: AppState, goal: Goal): GoalHealth {
  const auto = goal.progressSource === "projects" && goal.projectIds.length > 0;
  let progress = manualProgress(goal);
  let reason = "Updated manually";
  if (auto) {
    const tasks = goal.projectIds.flatMap((id) => rootTasks(state, id));
    const done = tasks.filter((t) => t.completed).length;
    progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    reason = `${done} of ${tasks.length} tasks done across ${goal.projectIds.length} linked project${goal.projectIds.length === 1 ? "" : "s"}`;
  }
  const start = goal.createdAt.slice(0, 10);
  const due = goal.dueDate;
  const today = todayISO();
  let expected = 0;
  if (due) {
    const total = Math.max(1, diffDays(due, start));
    expected = Math.max(0, Math.min(100, Math.round((diffDays(today, start) / total) * 100)));
  }
  let status: GoalStatus = goal.status;
  if (auto || goal.progressSource === "projects") {
    if (progress >= 100) status = "achieved";
    else if (!due) status = "on-track";
    else if (today > due) status = "off-track";
    else if (progress >= expected - 10) status = "on-track";
    else if (progress >= expected - 25) status = "at-risk";
    else status = "off-track";
    if (status !== "achieved" && due) {
      reason += ` · ${progress}% done vs ${expected}% of time elapsed`;
    }
  }
  return { progress, expected, status, source: auto ? "projects" : "manual", reason };
}

/* ======================================================== project risk */

export interface RiskFactor {
  key: string;
  label: string;
  weight: number;
  taskIds: ID[];
}

export interface ProjectRisk {
  projectId: ID;
  /** 0 (calm) – 100 (on fire) */
  score: number;
  level: "low" | "medium" | "high";
  factors: RiskFactor[];
  forecastEnd: string | null;
}

/**
 * Explainable slip-risk score. Each factor contributes a capped weight and
 * cites the tasks behind it, so the radar can show *why*.
 */
export function projectRisk(state: AppState, projectId: ID): ProjectRisk {
  const project = state.projects.find((p) => p.id === projectId);
  const tasks = rootTasks(state, projectId);
  const open = tasks.filter((t) => !t.completed);
  const today = todayISO();
  const factors: RiskFactor[] = [];
  const add = (key: string, label: string, weight: number, taskIds: ID[] = []) => {
    if (weight > 0) factors.push({ key, label, weight: Math.round(weight), taskIds });
  };

  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  if (open.length && overdue.length) {
    add("overdue", `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}`, Math.min(30, (overdue.length / open.length) * 60), overdue.map((t) => t.id));
  }

  const schedule = analyzeSchedule(tasks);
  if (project?.dueDate && schedule.forecastEnd && schedule.forecastEnd > project.dueDate) {
    const late = diffDays(schedule.forecastEnd, project.dueDate);
    add("forecast", `Forecast finish is ${late} day${late === 1 ? "" : "s"} after the due date`, Math.min(30, 10 + late * 2), schedule.criticalIds);
  }
  if (schedule.conflictIds.length) {
    add("conflicts", `${schedule.conflictIds.length} dependency conflict${schedule.conflictIds.length === 1 ? "" : "s"}`, Math.min(15, schedule.conflictIds.length * 6), schedule.conflictIds);
  }

  const blocked = open.filter((t) =>
    t.blockedByIds.some((id) => state.tasks.find((b) => b.id === id && !b.completed))
  );
  if (blocked.length) add("blocked", `${blocked.length} task${blocked.length === 1 ? " is" : "s are"} waiting on blockers`, Math.min(12, blocked.length * 4), blocked.map((t) => t.id));

  const unassigned = open.filter((t) => !t.assigneeId);
  if (unassigned.length) add("unassigned", `${unassigned.length} open task${unassigned.length === 1 ? " has" : "s have"} no owner`, Math.min(10, unassigned.length * 3), unassigned.map((t) => t.id));

  const lastUpdate = state.statusUpdates
    .filter((u) => u.projectId === projectId)
    .map((u) => u.createdAt)
    .sort()
    .pop();
  const staleDays = lastUpdate ? diffDays(today, lastUpdate.slice(0, 10)) : null;
  if (open.length && (staleDays === null || staleDays > 14)) {
    add("stale", staleDays === null ? "No status update yet" : `No status update for ${staleDays} days`, 8);
  }
  if (project?.status.state === "off-track") add("status", "Owner marked the project off track", 15);
  else if (project?.status.state === "at-risk") add("status", "Owner marked the project at risk", 8);

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.weight, 0));
  factors.sort((a, b) => b.weight - a.weight);
  return {
    projectId,
    score,
    level: score >= 45 ? "high" : score >= 20 ? "medium" : "low",
    factors,
    forecastEnd: schedule.forecastEnd,
  };
}

/* ============================================================= workload */

export const DEFAULT_CAPACITY = 40;
export const capacityOf = (u: User) => u.capacityHours ?? DEFAULT_CAPACITY;

/** Planned hours for a task: explicit estimate, else effort points × 4, else 4. */
export function taskHours(task: Task): number {
  if (typeof task.estimateHours === "number" && task.estimateHours >= 0) return task.estimateHours;
  const points = Number(task.customFields?.["fld-effort"]);
  return Number.isFinite(points) && points > 0 ? points * 4 : 4;
}

export interface WeekLoad {
  weekStart: string;
  rows: { userId: ID; hours: number; capacity: number; taskIds: ID[] }[];
}

/** Hours of open work due in each of the next `weeks` weeks, per person. */
export function capacityByWeek(state: AppState, weeks = 4, projectIds?: ID[]): WeekLoad[] {
  const base = startOfWeek(todayISO(), 1);
  const humans = state.users.filter((u) => !u.isAgent);
  const out: WeekLoad[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(base, w * 7);
    const end = addDays(start, 6);
    const rows = humans.map((u) => {
      const tasks = state.tasks.filter(
        (t) =>
          t.assigneeId === u.id &&
          !t.completed &&
          !!t.dueDate &&
          t.dueDate >= start &&
          t.dueDate <= end &&
          (!projectIds || (t.projectId && projectIds.includes(t.projectId)))
      );
      return {
        userId: u.id,
        hours: tasks.reduce((sum, t) => sum + taskHours(t), 0),
        capacity: capacityOf(u),
        taskIds: tasks.map((t) => t.id),
      };
    });
    out.push({ weekStart: start, rows });
  }
  return out;
}

export interface RebalanceSuggestion {
  taskId: ID;
  fromId: ID;
  toId: ID;
  hours: number;
  reason: string;
}

/**
 * Suggest reassignments that bring overloaded people back under capacity.
 * Only proposes people who can edit the task's project and still have room;
 * never moves approvals, milestones or tasks of people under capacity.
 */
export function suggestRebalance(state: AppState, week: WeekLoad): RebalanceSuggestion[] {
  const load = new Map(week.rows.map((r) => [r.userId, r.hours]));
  const cap = new Map(week.rows.map((r) => [r.userId, r.capacity]));
  const out: RebalanceSuggestion[] = [];
  const overloaded = week.rows.filter((r) => r.hours > r.capacity).sort((a, b) => b.hours - b.capacity - (a.hours - a.capacity));
  for (const row of overloaded) {
    const movable = row.taskIds
      .map((id) => state.tasks.find((t) => t.id === id) as Task)
      .filter((t) => t && t.projectId && !t.approvalStatus && !t.milestone)
      .sort((a, b) => taskHours(b) - taskHours(a));
    for (const task of movable) {
      if ((load.get(row.userId) ?? 0) <= (cap.get(row.userId) ?? 0)) break;
      const hours = taskHours(task);
      const project = state.projects.find((p) => p.id === task.projectId);
      if (!project) continue;
      const candidates = week.rows
        .filter((r) => r.userId !== row.userId)
        .filter((r) => {
          const role = effectiveProjectRole(state, project, r.userId);
          return role === "editor" || role === "owner";
        })
        .map((r) => ({ id: r.userId, spare: (cap.get(r.userId) ?? 0) - (load.get(r.userId) ?? 0) }))
        .filter((c) => c.spare >= hours)
        .sort((a, b) => b.spare - a.spare);
      const pick = candidates[0];
      if (!pick) continue;
      load.set(row.userId, (load.get(row.userId) ?? 0) - hours);
      load.set(pick.id, (load.get(pick.id) ?? 0) + hours);
      const to = state.users.find((u) => u.id === pick.id);
      out.push({
        taskId: task.id,
        fromId: row.userId,
        toId: pick.id,
        hours,
        reason: `${to?.name.split(" ")[0] ?? "They"} has ${pick.spare}h free that week and can edit ${project.name}`,
      });
    }
  }
  return out;
}

/* ============================================================ NL search */

export type DueFilter = "overdue" | "today" | "tomorrow" | "this-week" | "next-week" | "no-date";

export interface NaturalQuery {
  assigneeId?: ID | null;
  priority?: Priority;
  due?: DueFilter;
  completed?: boolean;
  projectId?: ID;
  tagIds: ID[];
  text: string;
  chips: { key: string; label: string }[];
}

const STOP = new Set(
  "show me find list all the tasks task that are is in of with which what who to for please any my me mine i".split(" ")
);

/**
 * Turn "high priority tasks overdue for Priya in Atlas" into filters.
 * Recognised phrases are removed; whatever remains is free-text search.
 */
export function parseNaturalQuery(state: AppState, raw: string, meId: ID): NaturalQuery {
  let q = ` ${raw.toLowerCase().replace(/[?.!,]/g, " ")} `;
  const out: NaturalQuery = { tagIds: [], text: "", chips: [] };
  const take = (re: RegExp) => {
    const m = q.match(re);
    if (m) q = q.replace(re, " ");
    return m;
  };

  // people
  if (take(/\b(unassigned|no one|nobody|no assignee)\b/)) {
    out.assigneeId = null;
    out.chips.push({ key: "assignee", label: "Unassigned" });
  } else if (take(/\b(assigned to me|my tasks|mine|for me)\b/) || /\bmy\b/.test(q)) {
    out.assigneeId = meId;
    out.chips.push({ key: "assignee", label: "Assigned to me" });
  } else {
    for (const u of state.users) {
      const first = u.name.split(" ")[0].toLowerCase();
      const re = new RegExp(`\\b(?:assigned to |for |by |owned by )?(${first}(?: ${u.name.split(" ")[1]?.toLowerCase() ?? ""})?)('s)?\\b`);
      if (re.test(q)) {
        take(re);
        out.assigneeId = u.id;
        out.chips.push({ key: "assignee", label: `Assigned to ${u.name}` });
        break;
      }
    }
  }

  // priority
  const pr = take(/\b(urgent|high|medium|low)(?: priority| pri)?\b/);
  if (pr) {
    out.priority = (pr[1] === "urgent" ? "high" : pr[1]) as Priority;
    out.chips.push({ key: "priority", label: `${out.priority[0].toUpperCase()}${out.priority.slice(1)} priority` });
  }

  // due
  const dueMap: [RegExp, DueFilter, string][] = [
    [/\b(overdue|late|past due|behind)\b/, "overdue", "Overdue"],
    [/\b(no due date|without a due date|undated|no date)\b/, "no-date", "No due date"],
    [/\b(due )?today\b/, "today", "Due today"],
    [/\b(due )?tomorrow\b/, "tomorrow", "Due tomorrow"],
    [/\b(due )?next week\b/, "next-week", "Due next week"],
    [/\b(due )?this week\b/, "this-week", "Due this week"],
  ];
  for (const [re, due, label] of dueMap) {
    if (take(re)) {
      out.due = due;
      out.chips.push({ key: "due", label });
      break;
    }
  }

  // status
  if (take(/\b(completed|done|finished|closed)\b/)) {
    out.completed = true;
    out.chips.push({ key: "completed", label: "Completed" });
  } else if (take(/\b(open|incomplete|not done|unfinished|remaining|outstanding)\b/)) {
    out.completed = false;
    out.chips.push({ key: "completed", label: "Open" });
  }

  // project
  for (const p of state.projects) {
    const full = p.name.toLowerCase();
    const first = full.split(" ")[0];
    const re = new RegExp(`\\b(?:in |on |for )?(${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${first})( project)?\\b`);
    if (first.length > 2 && re.test(q)) {
      take(re);
      out.projectId = p.id;
      out.chips.push({ key: "project", label: `In ${p.name}` });
      break;
    }
  }

  // tags (#tag or tag name)
  for (const t of state.tags) {
    const re = new RegExp(`(?:#|\\btagged |\\b)${t.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(q)) {
      take(re);
      out.tagIds.push(t.id);
      out.chips.push({ key: `tag:${t.id}`, label: `#${t.name}` });
    }
  }

  take(/\b(due|priority|tagged|assigned|in|on|for|by)\b/g);
  out.text = q
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ")
    .trim();
  return out;
}

export function matchesNaturalQuery(task: Task, q: NaturalQuery): boolean {
  const today = todayISO();
  if (q.assigneeId !== undefined && task.assigneeId !== q.assigneeId) return false;
  if (q.priority && task.priority !== q.priority) return false;
  if (q.completed !== undefined && task.completed !== q.completed) return false;
  if (q.completed === undefined && q.due === "overdue" && task.completed) return false;
  if (q.projectId && task.projectId !== q.projectId) return false;
  if (q.tagIds.some((id) => !task.tagIds.includes(id))) return false;
  if (q.due) {
    const d = task.dueDate;
    const weekStart = startOfWeek(today, 1);
    switch (q.due) {
      case "overdue":
        if (!d || d >= today) return false;
        break;
      case "today":
        if (d !== today) return false;
        break;
      case "tomorrow":
        if (d !== addDays(today, 1)) return false;
        break;
      case "this-week":
        if (!d || d < weekStart || d > addDays(weekStart, 6)) return false;
        break;
      case "next-week":
        if (!d || d < addDays(weekStart, 7) || d > addDays(weekStart, 13)) return false;
        break;
      case "no-date":
        if (d) return false;
        break;
    }
  }
  if (q.text) {
    const hay = `${task.name} ${task.notes}`.toLowerCase();
    if (!q.text.split(" ").every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** True when the parser understood at least one structured filter. */
export const isStructured = (q: NaturalQuery) => q.chips.length > 0;
