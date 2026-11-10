import type { ID, Task } from "./types";
import { addDays, diffDays } from "./utils";

/**
 * Dependency-aware scheduling (critical path method on real dates).
 *
 * Forward pass: a task's *forecast* start is its planned start, pushed later
 * if a blocker finishes on or after it (a "conflict"). Backward pass: the
 * latest a task may finish without delaying the forecast end of the project
 * is the earliest latest-start of anything it blocks. Slack is the gap between
 * that latest finish and the forecast finish; zero-slack open tasks form the
 * critical path — slipping any of them slips the whole project.
 */

export interface ScheduleInfo {
  /** Days this task can slip before it delays the project end. */
  slack: number;
  critical: boolean;
  /** A blocker is due on or after this task starts. */
  conflict: boolean;
  forecastStart: string;
  forecastDue: string;
}

export interface ScheduleAnalysis {
  byId: Map<ID, ScheduleInfo>;
  /** Forecast end date given dependencies, or null with nothing scheduled. */
  forecastEnd: string | null;
  criticalIds: ID[];
  conflictIds: ID[];
}

const startOf = (t: Task) => t.startDate ?? t.dueDate;
const dueOf = (t: Task) => t.dueDate ?? t.startDate;
const duration = (t: Task) => {
  const s = startOf(t);
  const d = dueOf(t);
  return s && d ? Math.max(1, diffDays(d, s) + 1) : 1;
};

/** Predecessors / successors restricted to `tasks`, merging both link directions. */
function links(tasks: Task[]) {
  const ids = new Set(tasks.map((t) => t.id));
  const preds = new Map<ID, Set<ID>>();
  const succs = new Map<ID, Set<ID>>();
  const add = (from: ID, to: ID) => {
    if (!ids.has(from) || !ids.has(to) || from === to) return;
    (succs.get(from) ?? succs.set(from, new Set()).get(from)!).add(to);
    (preds.get(to) ?? preds.set(to, new Set()).get(to)!).add(from);
  };
  for (const t of tasks) {
    t.blockedByIds.forEach((b) => add(b, t.id));
    t.blockingIds.forEach((b) => add(t.id, b));
  }
  return { preds, succs };
}

export function analyzeSchedule(all: Task[]): ScheduleAnalysis {
  const tasks = all.filter((t) => startOf(t));
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const { preds, succs } = links(tasks);

  /* forward pass: forecast dates (cycle-safe) */
  const forecast = new Map<ID, { start: string; due: string; conflict: boolean }>();
  const visiting = new Set<ID>();
  const forward = (id: ID): { start: string; due: string; conflict: boolean } => {
    const hit = forecast.get(id);
    if (hit) return hit;
    const t = byTask.get(id)!;
    const planned = startOf(t) as string;
    let start = planned;
    let conflict = false;
    if (!visiting.has(id)) {
      visiting.add(id);
      for (const p of preds.get(id) ?? []) {
        const pt = byTask.get(p)!;
        if (pt.completed) continue; // finished work never pushes anything
        const pf = forward(p);
        if (diffDays(pf.due, start) >= 0) {
          start = addDays(pf.due, 1);
        }
        if (diffDays(dueOf(pt) as string, planned) >= 0) conflict = true;
      }
      visiting.delete(id);
    }
    const result = { start, due: addDays(start, duration(t) - 1), conflict };
    forecast.set(id, result);
    return result;
  };
  tasks.forEach((t) => forward(t.id));

  const open = tasks.filter((t) => !t.completed);
  const forecastEnd = open.length
    ? open.map((t) => forecast.get(t.id)!.due).reduce((a, b) => (a > b ? a : b))
    : null;

  /* backward pass: latest finish without delaying forecastEnd */
  const latest = new Map<ID, string>();
  const back = new Set<ID>();
  const latestFinish = (id: ID): string => {
    const hit = latest.get(id);
    if (hit) return hit;
    let lf = forecastEnd ?? (forecast.get(id)!.due);
    if (!back.has(id)) {
      back.add(id);
      for (const s of succs.get(id) ?? []) {
        const st = byTask.get(s)!;
        if (st.completed) continue;
        const ls = addDays(latestFinish(s), -(duration(st) - 1));
        const candidate = addDays(ls, -1);
        if (candidate < lf) lf = candidate;
      }
      back.delete(id);
    }
    latest.set(id, lf);
    return lf;
  };

  const byId = new Map<ID, ScheduleInfo>();
  for (const t of tasks) {
    const f = forecast.get(t.id)!;
    const slack = t.completed ? Infinity : diffDays(latestFinish(t.id), f.due);
    byId.set(t.id, {
      slack,
      critical: !t.completed && slack <= 0,
      conflict: !t.completed && f.conflict,
      forecastStart: f.start,
      forecastDue: f.due,
    });
  }
  return {
    byId,
    forecastEnd,
    criticalIds: tasks.filter((t) => byId.get(t.id)!.critical).map((t) => t.id),
    conflictIds: tasks.filter((t) => byId.get(t.id)!.conflict).map((t) => t.id),
  };
}

/**
 * Dates to apply when `movedId` now finishes on `newDue`: every dependent that
 * would start on or before its blocker's finish is pushed later, keeping its
 * duration, transitively. Dependents only ever move later, never earlier.
 * `canShift` lets the caller skip tasks the actor may not edit (and stops the
 * cascade there).
 */
export function dependentShifts(
  tasks: Task[],
  movedId: ID,
  newDue: string,
  canShift: (t: Task) => boolean,
  opts?: { mode: "buffer"; previousDue: string }
): Map<ID, { startDate: string; dueDate: string; days: number }> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const { succs } = links(tasks);
  const out = new Map<ID, { startDate: string; dueDate: string; days: number }>();
  if (opts?.mode === "buffer") {
    // keep every gap: the whole downstream chain moves by the same delta, either way
    const delta = diffDays(newDue, opts.previousDue);
    if (!delta) return out;
    const queue = [...(succs.get(movedId) ?? [])];
    const seen = new Set<ID>([movedId]);
    while (queue.length) {
      const id = queue.shift() as ID;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = byId.get(id);
      if (!t || t.completed || !canShift(t) || !startOf(t)) continue;
      out.set(id, { startDate: addDays(startOf(t) as string, delta), dueDate: addDays(dueOf(t) as string, delta), days: delta });
      queue.push(...(succs.get(id) ?? []));
    }
    return out;
  }
  const finish = new Map<ID, string>([[movedId, newDue]]);
  const queue: ID[] = [movedId];
  let guard = 0;
  while (queue.length && guard++ < 10_000) {
    const id = queue.shift() as ID;
    const due = finish.get(id) as string;
    for (const s of succs.get(id) ?? []) {
      const t = byId.get(s);
      if (!t || t.completed || !canShift(t)) continue;
      const current = out.get(s);
      const start = current?.startDate ?? startOf(t);
      if (!start || diffDays(due, start) < 0) continue; // already starts after
      const days = diffDays(addDays(due, 1), startOf(t) as string);
      const nextStart = addDays(startOf(t) as string, days);
      const nextDue = addDays(dueOf(t) as string, days);
      if (current && current.startDate >= nextStart) continue;
      out.set(s, { startDate: nextStart, dueDate: nextDue, days });
      finish.set(s, nextDue);
      queue.push(s);
    }
  }
  out.delete(movedId);
  return out;
}
