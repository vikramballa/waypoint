/**
 * Automation engine v2.
 *
 *  - Rules may carry conditions (all must hold for the task).
 *  - Rule actions emit follow-on events, so rules can trigger rules. Chains are
 *    capped at depth 8 and each (rule, task) pair fires at most once per chain,
 *    which makes runaway loops impossible.
 *  - `schedule` triggers run on a clock (`runScheduledRules`) against every
 *    task in the project that matches the conditions.
 *  - `simulateRule` replays the last N days of activity ("dry run") and
 *    `detectRuleLoops` finds cycles statically before they bite.
 */
import type {
  Activity,
  ActivityType,
  AppState,
  Comment,
  ID,
  Rule,
  RuleAction,
  RuleActionType,
  RuleCondition,
  RuleTriggerType,
  Task,
} from "./types";
import { addDays, diffDays, todayISO, uid } from "./utils";

export const RULE_CHAIN_DEPTH = 8;

export interface TriggerEvent {
  type: RuleTriggerType;
  projectId: ID | null;
  taskId: ID;
  value?: string;
}

export function nowStamp() {
  return new Date().toISOString();
}

export function pushActivity(
  activities: Activity[],
  taskId: ID,
  actorId: ID,
  type: ActivityType,
  extra: Partial<Activity> = {}
): Activity[] {
  return [{ id: uid("act"), taskId, actorId, type, createdAt: nowStamp(), ...extra }, ...activities];
}

/* ------------------------------------------------------------ conditions */

export function conditionHolds(state: AppState, task: Task, c: RuleCondition): boolean {
  const today = todayISO();
  switch (c.field) {
    case "priority":
      if (c.op === "is-empty") return !task.priority;
      if (c.op === "is-set") return !!task.priority;
      return c.op === "is" ? task.priority === c.value : task.priority !== c.value;
    case "assignee":
      if (c.op === "is-empty") return !task.assigneeId;
      if (c.op === "is-set") return !!task.assigneeId;
      return c.op === "is" ? task.assigneeId === c.value : task.assigneeId !== c.value;
    case "section":
      return c.op === "is-not" ? task.sectionId !== c.value : task.sectionId === c.value;
    case "tag": {
      const has = !!c.value && task.tagIds.includes(c.value);
      if (c.op === "is-empty") return task.tagIds.length === 0;
      if (c.op === "is-set") return task.tagIds.length > 0;
      return c.op === "is-not" ? !has : has;
    }
    case "due":
      if (c.op === "is-empty") return !task.dueDate;
      if (c.op === "is-set") return !!task.dueDate;
      if (c.op === "overdue") return !!task.dueDate && task.dueDate < today && !task.completed;
      if (c.op === "within-days") {
        const n = Number(c.value ?? 0);
        return !!task.dueDate && diffDays(task.dueDate, today) >= 0 && diffDays(task.dueDate, today) <= n;
      }
      return true;
    case "completed":
      return String(task.completed) === (c.value ?? "true");
    default:
      return true;
  }
}

export function conditionsHold(state: AppState, task: Task, conditions: RuleCondition[] | undefined) {
  return (conditions ?? []).every((c) => conditionHolds(state, task, c));
}

/* ---------------------------------------------------------------- engine */

/** Which event a rule action produces when it changes a task. */
const EMITS: Partial<Record<RuleActionType, RuleTriggerType>> = {
  assign: "assignee-changed",
  "set-priority": "priority-changed",
  "move-section": "task-moved-section",
  "set-due": "due-date-set",
  complete: "task-completed",
  "set-field": "field-changed",
};

function triggerMatches(rule: Rule, event: TriggerEvent): boolean {
  if (!rule.enabled || rule.projectId !== event.projectId || rule.trigger.type !== event.type) return false;
  if (event.type === "task-moved-section") return rule.trigger.value === event.value;
  if (event.type === "field-changed" && rule.trigger.value) return rule.trigger.value === event.value;
  return true;
}

function applyRuleActions(state: AppState, rule: Rule, taskId: ID): { state: AppState; events: TriggerEvent[] } {
  let next = state;
  const events: TriggerEvent[] = [];
  const stamp = nowStamp();
  const before = state.tasks.find((t) => t.id === taskId);
  if (!before) return { state, events };

  const patchTask = (fn: (t: Task) => Task) => {
    next = { ...next, tasks: next.tasks.map((t) => (t.id === taskId ? { ...fn(t), modifiedAt: stamp } : t)) };
  };
  const emit = (action: RuleAction, value?: string) => {
    const type = EMITS[action.type];
    if (type) events.push({ type, projectId: before.projectId, taskId, value });
  };
  const comment = (text: string) => {
    const c: Comment = { id: uid("c"), taskId, authorId: rule.createdBy, text, createdAt: stamp, likeUserIds: [] };
    next = { ...next, comments: [...next.comments, c] };
  };

  for (const action of rule.actions) {
    const current = next.tasks.find((t) => t.id === taskId) as Task;
    switch (action.type) {
      case "assign":
        if (current.assigneeId === action.value) break;
        patchTask((t) => ({
          ...t,
          assigneeId: action.value,
          followerIds: Array.from(new Set([...t.followerIds, action.value])),
        }));
        emit(action);
        break;
      case "set-due": {
        const due = addDays(todayISO(), Number(action.value) || 0);
        if (current.dueDate === due) break;
        patchTask((t) => ({ ...t, dueDate: due }));
        emit(action);
        break;
      }
      case "set-priority":
        if (current.priority === action.value) break;
        patchTask((t) => ({ ...t, priority: action.value as Task["priority"] }));
        emit(action);
        break;
      case "move-section":
        if (current.sectionId === action.value) break;
        patchTask((t) => ({ ...t, sectionId: action.value }));
        emit(action, action.value);
        break;
      case "add-tag":
        patchTask((t) => ({ ...t, tagIds: Array.from(new Set([...t.tagIds, action.value])) }));
        break;
      case "complete":
        if (current.completed || current.approvalStatus) break; // approvals complete by decision only
        patchTask((t) => ({ ...t, completed: true, completedAt: stamp }));
        emit(action);
        break;
      case "add-follower":
        patchTask((t) => ({ ...t, followerIds: Array.from(new Set([...t.followerIds, action.value])) }));
        break;
      case "add-comment":
      case "ai-comment":
        comment(action.value);
        break;
      case "set-field":
        if (action.fieldId) {
          patchTask((t) => ({ ...t, customFields: { ...t.customFields, [action.fieldId as ID]: action.value } }));
          emit(action, action.fieldId);
        }
        break;
    }
  }

  next = {
    ...next,
    activities: pushActivity(next.activities, taskId, rule.createdBy, "rule", { detail: `Rule "${rule.name}" ran` }),
    rules: next.rules.map((r) => (r.id === rule.id ? { ...r, runCount: r.runCount + 1, lastRunAt: stamp } : r)),
  };
  return { state: next, events };
}

/**
 * Run every rule matching `event`, then whatever those rules trigger, up to
 * RULE_CHAIN_DEPTH. `fired` dedupes (rule, task) across the whole chain.
 */
export function applyRules(
  state: AppState,
  event: TriggerEvent,
  depth = 0,
  fired: Set<string> = new Set()
): AppState {
  if (!event.projectId) return state;
  let next = state;
  for (const rule of state.rules) {
    if (!triggerMatches(rule, event)) continue;
    const key = `${rule.id}:${event.taskId}`;
    if (fired.has(key)) continue;
    const task = next.tasks.find((t) => t.id === event.taskId);
    if (!task || !conditionsHold(next, task, rule.conditions)) continue;
    fired.add(key);
    const result = applyRuleActions(next, rule, event.taskId);
    next = result.state;
    for (const e of result.events) {
      if (depth + 1 >= RULE_CHAIN_DEPTH) {
        next = {
          ...next,
          activities: pushActivity(next.activities, event.taskId, rule.createdBy, "rule", {
            detail: `Rule chain stopped after ${RULE_CHAIN_DEPTH} steps to prevent a loop`,
          }),
        };
        break;
      }
      next = applyRules(next, e, depth + 1, fired);
    }
  }
  return next;
}

/* -------------------------------------------------------------- schedule */

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Most recent scheduled occurrence at or before `now`, or null. */
export function lastOccurrence(rule: Rule, now: Date): Date | null {
  const s = rule.schedule;
  if (!s) return null;
  const at = minutesOf(s.at);
  for (let back = 0; back < 8; back++) {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    d.setHours(Math.floor(at / 60), at % 60, 0, 0);
    if (d > now) continue;
    const dow = d.getDay();
    if (s.every === "weekday" && (dow === 0 || dow === 6)) continue;
    if (s.every === "week" && dow !== (s.dayOfWeek ?? 1)) continue;
    return d;
  }
  return null;
}

export function scheduleIsDue(rule: Rule, now: Date): boolean {
  if (!rule.enabled || rule.trigger.type !== "schedule") return false;
  const occ = lastOccurrence(rule, now);
  if (!occ) return false;
  return !rule.lastRunAt || new Date(rule.lastRunAt) < occ;
}

/** Run every due scheduled rule against its matching tasks. */
export function runScheduledRules(state: AppState, nowIso: string): AppState {
  const now = new Date(nowIso);
  let next = state;
  for (const rule of state.rules) {
    if (!scheduleIsDue(rule, now)) continue;
    const targets = next.tasks
      .filter((t) => t.projectId === rule.projectId && !t.parentId && conditionsHold(next, t, rule.conditions))
      .slice(0, 200);
    const fired = new Set<string>();
    for (const t of targets) {
      fired.add(`${rule.id}:${t.id}`);
      const result = applyRuleActions(next, rule, t.id);
      next = result.state;
      for (const e of result.events) next = applyRules(next, e, 1, fired);
    }
    // mark as run even when nothing matched, so it doesn't retry every minute
    next = { ...next, rules: next.rules.map((r) => (r.id === rule.id ? { ...r, lastRunAt: nowIso } : r)) };
  }
  return next;
}

/* --------------------------------------------------------------- dry run */

const ACTIVITY_TRIGGER: Partial<Record<ActivityType, RuleTriggerType>> = {
  created: "task-added",
  completed: "task-completed",
  section: "task-moved-section",
  assigned: "assignee-changed",
  "due-date": "due-date-set",
  priority: "priority-changed",
  field: "field-changed",
};

export interface SimulationResult {
  /** times the rule would have fired */
  runs: number;
  taskIds: ID[];
  /** individual action applications */
  actions: number;
  days: number;
  note: string;
}

/**
 * Replay the last `days` of project activity against `rule` using today's task
 * state for conditions. Read-only: nothing is changed.
 */
export function simulateRule(state: AppState, rule: Rule, days = 30): SimulationResult {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const tasks = new Map(state.tasks.filter((t) => t.projectId === rule.projectId).map((t) => [t.id, t]));
  const hits = new Set<ID>();
  let runs = 0;

  if (rule.trigger.type === "schedule") {
    let occurrences = 0;
    for (let d = 0; d < days; d++) {
      const day = new Date(Date.now() - d * 86_400_000);
      const dow = day.getDay();
      const s = rule.schedule;
      if (!s) break;
      if (s.every === "weekday" && (dow === 0 || dow === 6)) continue;
      if (s.every === "week" && dow !== (s.dayOfWeek ?? 1)) continue;
      occurrences++;
    }
    const matching = [...tasks.values()].filter((t) => !t.parentId && conditionsHold(state, t, rule.conditions));
    matching.forEach((t) => hits.add(t.id));
    runs = occurrences * matching.length;
    return {
      runs,
      taskIds: [...hits],
      actions: runs * rule.actions.length,
      days,
      note: `${occurrences} scheduled run${occurrences === 1 ? "" : "s"} × ${matching.length} matching task${matching.length === 1 ? "" : "s"} today`,
    };
  }

  const sectionName = state.sections.find((s) => s.id === rule.trigger.value)?.name;
  for (const a of state.activities) {
    if (a.createdAt < since) continue;
    if (ACTIVITY_TRIGGER[a.type] !== rule.trigger.type) continue;
    const task = tasks.get(a.taskId);
    if (!task) continue;
    if (rule.trigger.type === "task-moved-section" && a.to !== sectionName) continue;
    if (!conditionsHold(state, task, rule.conditions)) continue;
    runs++;
    hits.add(task.id);
  }
  return {
    runs,
    taskIds: [...hits],
    actions: runs * rule.actions.length,
    days,
    note: "Based on recorded activity, checking conditions against each task as it is today",
  };
}

/* ------------------------------------------------------- loop detection */

/** Cycles among a project's enabled rules (each cycle as a list of rule ids). */
export function detectRuleLoops(state: AppState, projectId: ID, extra?: Rule): ID[][] {
  const rules = state.rules
    .filter((r) => r.projectId === projectId && r.enabled && r.id !== extra?.id)
    .concat(extra && extra.enabled ? [extra] : []);
  const edges = new Map<ID, ID[]>();
  for (const a of rules) {
    const out: ID[] = [];
    for (const action of a.actions) {
      const type = EMITS[action.type];
      if (!type) continue;
      for (const b of rules) {
        if (b.trigger.type !== type) continue;
        if (type === "task-moved-section" && b.trigger.value !== action.value) continue;
        if (type === "field-changed" && b.trigger.value && b.trigger.value !== action.fieldId) continue;
        out.push(b.id);
      }
    }
    edges.set(a.id, out);
  }
  const cycles: ID[][] = [];
  const seen = new Set<string>();
  const walk = (start: ID, node: ID, path: ID[]) => {
    for (const nextId of edges.get(node) ?? []) {
      if (nextId === start) {
        const key = [...path].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...path]);
        }
      } else if (!path.includes(nextId) && path.length < 8) {
        walk(start, nextId, [...path, nextId]);
      }
    }
  };
  rules.forEach((r) => walk(r.id, r.id, [r.id]));
  return cycles;
}
