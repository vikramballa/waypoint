import React, { useMemo, useRef, useState } from "react";
import { useApp } from "../core/store";
import type { ID, Task } from "../core/types";
import { rootTasksOf } from "../core/selectors";
import { analyzeSchedule, dependentShifts, type ScheduleInfo } from "../core/schedule";
import {
  addDays,
  diffDays,
  formatDue,
  fromISO,
  isWeekend,
  monthName,
  startOfWeek,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, Popover, usePopover } from "../ui/primitives";

type Zoom = "weeks" | "months" | "quarters";

const ZOOM_DAY_WIDTH: Record<Zoom, number> = {
  weeks: 26,
  months: 11,
  quarters: 4.5,
};

export function TimelineView({
  projectId,
  onOpenTask,
}: {
  projectId: ID;
  onOpenTask: (id: ID) => void;
}) {
  const { state, dispatch, userById, can, canEdit, toast } = useApp();
  const [zoom, setZoom] = useState<Zoom>("weeks");
  const [showCritical, setShowCritical] = useState(true);
  const project = state.projects.find((p) => p.id === projectId);
  const canConfigure = can("project:update", projectId);
  const dayWidth = ZOOM_DAY_WIDTH[zoom];

  const byStart = (a: Task, b: Task) => (a.startDate ?? a.dueDate ?? "").localeCompare(b.startDate ?? b.dueDate ?? "");
  const { tasks, externalIds } = useMemo(() => {
    const own = rootTasksOf(state, projectId).filter((t) => t.startDate || t.dueDate).sort(byStart);
    const ownIds = new Set(own.map((t) => t.id));
    // dependencies that cross into other projects you can see
    const linked = new Set<ID>();
    for (const t of own) [...t.blockedByIds, ...t.blockingIds].forEach((id) => !ownIds.has(id) && linked.add(id));
    for (const t of state.tasks) {
      if (!ownIds.has(t.id) && [...t.blockedByIds, ...t.blockingIds].some((id) => ownIds.has(id))) linked.add(t.id);
    }
    const external = state.tasks.filter((t) => linked.has(t.id) && (t.startDate || t.dueDate)).sort(byStart);
    return { tasks: [...own, ...external], externalIds: new Set(external.map((t) => t.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tasks, projectId, state]);

  const range = useMemo(() => {
    const today = todayISO();
    const starts = tasks.map((t) => t.startDate ?? t.dueDate ?? today);
    const ends = tasks.map((t) => t.dueDate ?? t.startDate ?? today);
    const min = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : addDays(today, -7);
    const max = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : addDays(today, 21);
    const start = startOfWeek(addDays(min, -7), 0);
    const end = addDays(max, 21);
    const days: string[] = [];
    let cursor = start;
    while (diffDays(cursor, end) <= 0) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return { start, end, days };
  }, [tasks]);

  const months = useMemo(() => {
    const groups: { label: string; days: string[] }[] = [];
    for (const day of range.days) {
      const label = `${monthName(day, true)} ${day.slice(0, 4)}`;
      const last = groups[groups.length - 1];
      if (!last || last.label !== label) groups.push({ label, days: [day] });
      else last.days.push(day);
    }
    return groups;
  }, [range.days]);

  const todayOffset = diffDays(todayISO(), range.start) * dayWidth;

  const schedule = useMemo(() => analyzeSchedule(tasks), [tasks]);
  const rowOf = useMemo(() => new Map(tasks.map((t, i) => [t.id, i])), [tasks]);
  const ROW = 40;

  /* dependency connectors: blocker's finish → dependent's start */
  const edges = useMemo(() => {
    const out: { key: string; d: string; critical: boolean; conflict: boolean }[] = [];
    const x = (iso: string) => diffDays(iso, range.start) * dayWidth;
    for (const t of tasks) {
      const from = rowOf.get(t.id);
      if (from === undefined) continue;
      const due = t.dueDate ?? t.startDate;
      if (!due) continue;
      for (const depId of new Set([
        ...t.blockingIds,
        ...tasks.filter((o) => o.blockedByIds.includes(t.id)).map((o) => o.id),
      ])) {
        const to = rowOf.get(depId);
        const dep = tasks[to ?? -1];
        if (to === undefined || !dep) continue;
        const x1 = x(due) + dayWidth;
        const x2 = x(dep.startDate ?? dep.dueDate ?? due);
        const y1 = from * ROW + ROW / 2;
        const y2 = to * ROW + ROW / 2;
        const bend = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
        const d =
          x2 - 12 > x1
            ? `M${x1} ${y1} H${bend} V${y2} H${x2 - 2}`
            : `M${x1} ${y1} h10 V${(y1 + y2) / 2} H${x2 - 12} V${y2} H${x2 - 2}`;
        const crit = !!schedule.byId.get(t.id)?.critical && !!schedule.byId.get(depId)?.critical;
        out.push({ key: `${t.id}-${depId}`, d, critical: crit, conflict: !!schedule.byId.get(depId)?.conflict });
      }
    }
    return out;
  }, [tasks, rowOf, range.start, dayWidth, schedule]);

  const commitDates = (task: Task, start: string | null, due: string | null) => {
    const moved =
      project?.autoShiftDates && due && due !== task.dueDate
        ? dependentShifts(state.tasks, task.id, due, (t) => canEdit(t.id)).size
        : 0;
    dispatch({ type: "task/update", id: task.id, patch: { startDate: start, dueDate: due }, silent: true });
    if (moved) toast(`Shifted ${moved} dependent task${moved === 1 ? "" : "s"} to keep the schedule valid`);
  };

  return (
    <div className="timeline-wrap">
      <div className="timeline-toolbar">
        <span className="viewbar-title">
          {tasks.length} scheduled task{tasks.length === 1 ? "" : "s"}
        </span>
        {schedule.forecastEnd && (
          <span className="schedule-summary small">
            <span className="weak">Forecast finish</span> <b>{formatDue(schedule.forecastEnd)}</b>
            {project?.dueDate && schedule.forecastEnd > project.dueDate && (
              <span className="schedule-late">
                {diffDays(schedule.forecastEnd, project.dueDate)}d past the project due date
              </span>
            )}
            <span className="weak">·</span> {schedule.criticalIds.length} critical
            {schedule.conflictIds.length > 0 && (
              <>
                <span className="weak">·</span>{" "}
                <span className="schedule-late">
                  {schedule.conflictIds.length} dependency conflict{schedule.conflictIds.length === 1 ? "" : "s"}
                </span>
              </>
            )}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          className={`chip${showCritical ? " active" : ""}`}
          aria-pressed={showCritical}
          onClick={() => setShowCritical((v) => !v)}
          title="Highlight the chain of tasks that decides the finish date"
        >
          <Icon name="route" size={12} /> Critical path
        </button>
        <label
          className="row small"
          style={{ gap: 6, cursor: canConfigure ? "pointer" : "default", opacity: canConfigure ? 1 : 0.6 }}
          title={canConfigure ? "Push dependent tasks later when a blocker slips" : "Only project owners can change this"}
        >
          <button
            type="button"
            role="switch"
            aria-checked={!!project?.autoShiftDates}
            aria-label="Auto-shift dependents"
            disabled={!canConfigure}
            className={`switch${project?.autoShiftDates ? " on" : ""}`}
            style={{ width: 28, height: 16 }}
            onClick={() => {
              dispatch({ type: "project/update", id: projectId, patch: { autoShiftDates: !project?.autoShiftDates } });
              toast(project?.autoShiftDates ? "Auto-shift turned off" : "Dependents now shift automatically");
            }}
          />
          Auto-shift
        </label>
        {project?.autoShiftDates && (
          <select
            className="input"
            aria-label="Auto-shift mode"
            disabled={!canConfigure}
            value={project.autoShiftMode ?? "push"}
            onChange={(e) => dispatch({ type: "project/update", id: projectId, patch: { autoShiftMode: e.target.value as "push" | "buffer" } })}
            title="Push later: only move dependents when they'd overlap. Keep gaps: move the whole chain by the same amount, earlier or later."
          >
            <option value="push">Push later only</option>
            <option value="buffer">Keep gaps (both ways)</option>
          </select>
        )}
        <div className="segmented">
          {(["weeks", "months", "quarters"] as Zoom[]).map((z) => (
            <button
              key={z}
              className={zoom === z ? "active" : ""}
              onClick={() => setZoom(z)}
            >
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button
          className="chip"
          onClick={() =>
            document
              .querySelector(".timeline-scroll")
              ?.scrollTo({ left: todayOffset - 120, behavior: "smooth" })
          }
        >
          <Icon name="calendar" size={12} /> Today
        </button>
      </div>
      <div className="timeline-scroll">
        <div className="timeline" style={{ gridTemplateColumns: "260px 1fr" }}>
          <div className="timeline-left">
            <div className="timeline-left-head" style={{ padding: "8px 12px" }}>
              <div className="small weak" style={{ marginTop: 18 }}>
                Task
              </div>
            </div>
            {tasks.map((task, i) => (
              <div className={`timeline-label${externalIds.has(task.id) ? " external" : ""}`} key={task.id}>
                {externalIds.has(task.id) && i === tasks.findIndex((t) => externalIds.has(t.id)) && (
                  <span className="timeline-external-head">Outside this project</span>
                )}
                <button
                  className="grow truncate"
                  style={{ textAlign: "left" }}
                  onClick={() => onOpenTask(task.id)}
                  title={task.name}
                >
                  {task.name}
                </button>
                {externalIds.has(task.id) && (
                  <span className="chip" style={{ height: 18 }} title="In another project">
                    {state.projects.find((p) => p.id === task.projectId)?.name.split(" ")[0] ?? "Other"}
                  </span>
                )}
                <Avatar user={userById(task.assigneeId)} size={20} />
              </div>
            ))}
          </div>
          <div style={{ position: "relative", minWidth: range.days.length * dayWidth }}>
            <div className="timeline-head" style={{ position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div className="row" style={{ height: 24 }}>
                  {months.map((m) => (
                    <div
                      key={m.label}
                      className="timeline-month-label"
                      style={{
                        width: m.days.length * dayWidth,
                        borderRight: "1px solid var(--color-border)",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {zoom === "quarters" ? m.label.split(" ")[0].slice(0, 3) : m.label}
                    </div>
                  ))}
                </div>
                <div className="timeline-days">
                  {range.days.map((day) => (
                    <div
                      key={day}
                      className={`timeline-day-label${isWeekend(day) ? " weekend" : ""}${
                        day === todayISO() ? " today" : ""
                      }`}
                      style={{ width: dayWidth, minWidth: dayWidth }}
                    >
                      {zoom === "quarters"
                        ? fromISO(day).getDate() % 7 === 0
                          ? fromISO(day).getDate()
                          : ""
                        : zoom === "months"
                          ? fromISO(day).getDate() === 1
                            ? monthName(day)
                            : fromISO(day).getDate() % 7 === 0
                              ? fromISO(day).getDate()
                              : ""
                          : fromISO(day).getDate()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="timeline-body">
              <div
                className="timeline-today-line"
                style={{ left: todayOffset }}
                title="Today"
              />
              {edges.length > 0 && (
                <svg
                  className="timeline-deps"
                  width={range.days.length * dayWidth}
                  height={tasks.length * ROW}
                  aria-hidden="true"
                >
                  <defs>
                    <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0 0 8 4 0 8Z" className="dep-arrowhead" />
                    </marker>
                  </defs>
                  {edges.map((e) => (
                    <path
                      key={e.key}
                      d={e.d}
                      markerEnd="url(#dep-arrow)"
                      className={`dep-edge${showCritical && e.critical ? " critical" : ""}${e.conflict ? " conflict" : ""}`}
                    />
                  ))}
                </svg>
              )}
              {tasks.map((task) => (
                <div className={`timeline-row${externalIds.has(task.id) ? " external" : ""}`} key={task.id}>
                  <TimelineBar
                    task={task}
                    info={schedule.byId.get(task.id)}
                    highlight={showCritical && schedule.criticalIds.length > 1}
                    ring={showCritical}
                    editable={canEdit(task.id)}
                    dayWidth={dayWidth}
                    rangeStart={range.start}
                    totalDays={range.days.length}
                    onOpen={() => onOpenTask(task.id)}
                    onChange={(start, due) => commitDates(task, start, due)}
                  />
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="empty" style={{ padding: 48 }}>
                  <h3>No scheduled work</h3>
                  <p>Give tasks a start and due date to see them on the timeline.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineBar({
  task,
  info,
  highlight,
  ring,
  editable,
  dayWidth,
  rangeStart,
  totalDays,
  onOpen,
  onChange,
}: {
  task: Task;
  info?: ScheduleInfo;
  /** dim everything off the critical chain */
  highlight: boolean;
  /** outline critical bars */
  ring: boolean;
  editable: boolean;
  dayWidth: number;
  rangeStart: string;
  totalDays: number;
  onOpen: () => void;
  onChange: (start: string | null, due: string | null) => void;
}) {
  const { state, userById } = useApp();
  const [preview, setPreview] = useState<{ start: string; due: string } | null>(null);
  const previewRef = useRef<{ start: string; due: string } | null>(null);
  const dragRef = useRef<{
    mode: "move" | "left" | "right";
    x: number;
    start: string;
    due: string;
  } | null>(null);

  const project = state.projects.find((p) => p.id === task.projectId);
  const rawStart = task.startDate ?? task.dueDate ?? todayISO();
  const rawDue = task.dueDate ?? task.startDate ?? todayISO();
  const start = preview?.start ?? rawStart;
  const due = preview?.due ?? rawDue;

  const left = diffDays(start, rangeStart) * dayWidth;
  const width = Math.max(dayWidth, (diffDays(due, start) + 1) * dayWidth);
  const color = `var(--swatch-${project?.color ?? "blue"}-solid)`;
  const foreground = "#fff";
  const isMilestone = task.milestone;

  const begin = (e: React.PointerEvent, mode: "move" | "left" | "right") => {
    e.stopPropagation();
    if (!editable) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, x: e.clientX, start: rawStart, due: rawDue };
    const onMove = (ev: PointerEvent) => {
      const info = dragRef.current;
      if (!info) return;
      const delta = Math.round((ev.clientX - info.x) / dayWidth);
      if (delta === 0) {
        previewRef.current = null;
        setPreview(null);
        return;
      }
      let next: { start: string; due: string } | null = null;
      if (info.mode === "move") {
        next = { start: addDays(info.start, delta), due: addDays(info.due, delta) };
      } else if (info.mode === "left") {
        const start = addDays(info.start, delta);
        next = {
          start: diffDays(start, info.due) > 0 ? info.start : start,
          due: info.due,
        };
      } else {
        const due = addDays(info.due, delta);
        next = {
          start: info.start,
          due: diffDays(due, info.start) < 0 ? info.due : due,
        };
      }
      previewRef.current = next;
      setPreview(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragRef.current = null;
      const committed = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      if (committed) onChange(committed.start, committed.due);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const pop = usePopover();

  return (
    <>
      <div
        data-task-id={task.id}
        className={`timeline-bar${isMilestone ? " milestone" : ""}${
          ring && info?.critical ? " critical" : ""
        }${highlight && info && !info.critical && !task.completed ? " dimmed" : ""}${
          info?.conflict ? " conflict" : ""
        }${editable ? "" : " readonly"}`}
        style={{
          left: isMilestone ? left + width / 2 - 8 : left,
          width: isMilestone ? 16 : width,
          background: color,
          color: foreground,
          opacity: task.completed ? 0.6 : 1,
        }}
        title={[
          task.name,
          `${formatDue(start)} → ${formatDue(due)}`,
          info && !task.completed
            ? info.critical
              ? "On the critical path — any slip delays the project"
              : `${info.slack} day${info.slack === 1 ? "" : "s"} of slack`
            : "",
          info?.conflict ? `Starts before its blocker finishes (forecast start ${formatDue(info.forecastStart)})` : "",
          editable ? "" : "Read-only",
        ]
          .filter(Boolean)
          .join("\n")}
        onPointerDown={(e) => begin(e, "move")}
        onDoubleClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          pop.openAt(e.currentTarget);
        }}
      >
        {!isMilestone && (
          <>
            <span
              className="handle left"
              onPointerDown={(e) => begin(e, "left")}
              title="Adjust start date"
            />
            <span style={{ marginLeft: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
              {dayWidth > 8 ? task.name : ""}
            </span>
            <span
              className="handle right"
              onPointerDown={(e) => begin(e, "right")}
              title="Adjust due date"
            />
          </>
        )}
      </div>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={240}>
          <button className="menu-item" onClick={() => { onOpen(); pop.close(); }}>
            <Icon name="arrow-up-right" size={14} /> Open task
          </button>
          {editable && <>
          <button
            className="menu-item"
            onClick={() => {
              onChange(addDays(start, -1), addDays(due, -1));
              pop.close();
            }}
          >
            <Icon name="arrow-left" size={14} /> Shift one day earlier
          </button>
          <button
            className="menu-item"
            onClick={() => {
              onChange(addDays(start, 1), addDays(due, 1));
              pop.close();
            }}
          >
            <Icon name="arrow-right" size={14} /> Shift one day later
          </button>
          <button
            className="menu-item"
            onClick={() => {
              onChange(todayISO(), addDays(todayISO(), Math.max(1, diffDays(due, start))));
              pop.close();
            }}
          >
            <Icon name="calendar" size={14} /> Start today
          </button>
          </>}
        </Popover>
      )}
    </>
  );
}
