import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { ID } from "../core/types";
import {
  addDays,
  addMonths,
  diffDays,
  fromISO,
  monthName,
  startOfMonth,
  startOfWeek,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";

export function CalendarView({
  projectId,
  onOpenTask,
}: {
  projectId: ID;
  onOpenTask: (id: ID) => void;
}) {
  const { state, dispatch } = useApp();
  const [cursor, setCursor] = useState(() => startOfMonth(todayISO()));
  const [mode, setMode] = useState<"month" | "week">("month");
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days = useMemo(() => {
    if (mode === "week") {
      const start = startOfWeek(cursor, 0);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = startOfWeek(startOfMonth(cursor), 0);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [cursor, mode]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, typeof state.tasks>();
    for (const t of state.tasks) {
      if (t.projectId !== projectId || !t.dueDate || t.parentId) continue;
      const list = map.get(t.dueDate) ?? [];
      list.push(t);
      map.set(t.dueDate, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
        if (a.dueTime) return -1;
        if (b.dueTime) return 1;
        return a.order - b.order;
      });
    }
    return map;
  }, [state.tasks, projectId]);

  const weeks = mode === "week" ? 1 : 6;
  const today = todayISO();

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button className="icon-btn" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Previous month">
          <Icon name="chevron-left" />
        </button>
        <div className="calendar-month-label">
          {monthName(cursor, true)} {cursor.slice(0, 4)}
        </div>
        <button className="icon-btn" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
          <Icon name="chevron-right" />
        </button>
        <button className="chip" onClick={() => setCursor(startOfMonth(todayISO()))}>
          Today
        </button>
        <div style={{ flex: 1 }} />
        <div className="segmented">
          <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>
            Month
          </button>
          <button className={mode === "week" ? "active" : ""} onClick={() => { setMode("week"); setCursor(todayISO()); }}>
            Week
          </button>
        </div>
      </div>

      <div className="calendar-grid" style={{ ["--weeks" as string]: weeks }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div className="calendar-dow" key={d}>
            {d}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === cursor.slice(0, 7) || mode === "week";
          const list = tasksByDay.get(day) ?? [];
          return (
            <div
              key={day}
              className={`calendar-cell${inMonth ? "" : " dim"}${
                dragOver === day ? " drop" : ""
              }`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("text/task-id")) {
                  e.preventDefault();
                  setDragOver(day);
                }
              }}
              onDragLeave={() => setDragOver((d) => (d === day ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/task-id");
                if (id) dispatch({ type: "task/setDue", id, dueDate: day });
              }}
              onDoubleClick={() =>
                dispatch({
                  type: "task/create",
                  patch: { name: "New task", projectId, dueDate: day },
                })
              }
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span
                  className={`calendar-date${day === today ? " today" : ""}`}
                  title={day}
                >
                  {mode === "week" ? `${fromISO(day).getDate()}` : fromISO(day).getDate()}
                </span>
                {day === today && mode === "week" && (
                  <span className="small weak">{diffDays(day, todayISO()) === 0 ? "Today" : ""}</span>
                )}
              </div>
              <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", gap: 2 }}>
                {list.slice(0, mode === "week" ? 30 : 4).map((task) => {
                  const project = state.projects.find((p) => p.id === task.projectId);
                  return (
                    <button
                      key={task.id}
                      className={`calendar-chip${task.completed ? " done" : ""}`}
                      style={{
                        ["--calendar-chip-bg" as string]: `var(--swatch-${project?.color ?? "blue"}-bg)`,
                        ["--calendar-chip-fg" as string]: `var(--swatch-${project?.color ?? "blue"}-fg)`,
                        ["--calendar-chip-border" as string]: `var(--swatch-${project?.color ?? "blue"}-solid)`,
                      }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/task-id", task.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTask(task.id);
                      }}
                      title={`${task.name}${task.dueTime ? ` · ${task.dueTime}` : ""}`}
                    >
                      {task.dueTime && <span className="weak">{task.dueTime}</span>}
                      {task.name}
                    </button>
                  );
                })}
                {list.length > 4 && mode === "month" && (
                  <button
                    className="small weak"
                    style={{ textAlign: "left", paddingLeft: 4 }}
                    onClick={() => {
                      setMode("week");
                      setCursor(day);
                    }}
                  >
                    +{list.length - 4} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
