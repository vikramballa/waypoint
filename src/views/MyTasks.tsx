import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { ID, Task } from "../core/types";
import { myTasks } from "../core/selectors";
import { addDays, formatDue, todayISO } from "../core/utils";
import { Icon } from "../ui/icons";
import { TaskList } from "../ui/TaskList";
import { Avatar, Checkbox, EmptyState, TaskCheckbox } from "../ui/primitives";

type Tab = "list" | "board" | "calendar";

export function MyTasksView({ onOpenTask }: { onOpenTask: (id: ID) => void }) {
  const { state, dispatch, user } = useApp();
  const [tab, setTab] = useState<Tab>("list");
  const buckets = useMemo(() => myTasks(state), [state]);

  const moveToBucket = (ids: ID[], key: string) => {
    const today = todayISO();
    ids.forEach((id) => {
      if (key === "today") dispatch({ type: "task/setDue", id, dueDate: today });
      else if (key === "upcoming") dispatch({ type: "task/setDue", id, dueDate: addDays(today, 3) });
      else if (key === "later") dispatch({ type: "task/setDue", id, dueDate: null });
    });
  };

  const groups = [
    { key: "recent", name: "Recently assigned", tasks: buckets.recent, readOnlyName: true },
    { key: "today", name: "Today", tasks: buckets.today, color: "green" as const },
    { key: "upcoming", name: "Upcoming", tasks: buckets.upcoming, color: "yellow" as const },
    { key: "later", name: "Later", tasks: buckets.later, color: "cool-gray" as const },
  ].filter((g) => g.tasks.length > 0 || g.key !== "recent");

  const open = buckets.today.length + buckets.upcoming.length + buckets.later.length;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="check-circle" size={22} /> My tasks
          </h1>
          <div className="page-actions">
            <div className="segmented">
              {(["list", "board", "calendar"] as Tab[]).map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  <span className="row" style={{ gap: 4 }}>
                    <Icon
                      name={t === "list" ? "list" : t === "board" ? "board" : "calendar"}
                      size={12}
                    />
                    {t[0].toUpperCase() + t.slice(1)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="page-subtitle">
          {open} open task{open === 1 ? "" : "s"} assigned to {user.name}
        </p>
      </div>

      {tab === "list" && (
        <TaskList
          groups={groups}
          onOpenTask={onOpenTask}
          projectId={null}
          onMoveToGroup={moveToBucket}
          newTaskDefaults={{ assigneeId: state.currentUserId }}
          allowAdd
          emptyTitle="You're all caught up"
          emptyDescription="Tasks assigned to you appear here. Drag them between Today, Upcoming and Later to plan your week."
        />
      )}

      {tab === "board" && (
        <div className="board-wrap">
          {groups.map((group) => (
            <div
              className="board-col"
              key={group.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/task-id");
                if (id) moveToBucket([id], group.key);
              }}
            >
              <div className="board-col-head">
                <span
                  className="swatch"
                  style={{ background: `var(--swatch-${group.color ?? "none"}-bg)` }}
                />
                <span>{group.name}</span>
                <span className="count">{group.tasks.length}</span>
              </div>
              <div className="board-col-body">
                {group.tasks.map((task) => (
                  <MyBoardCard key={task.id} task={task} onOpenTask={onOpenTask} />
                ))}
                {group.tasks.length === 0 && (
                  <div className="small weak" style={{ padding: "8px 6px" }}>
                    Nothing here
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "calendar" && (
        <div className="page-scroll" style={{ padding: 24 }}>
          <WeekAgenda tasks={[...buckets.today, ...buckets.upcoming, ...buckets.later]} onOpenTask={onOpenTask} />
        </div>
      )}
    </div>
  );
}

function MyBoardCard({ task, onOpenTask }: { task: Task; onOpenTask: (id: string) => void }) {
  const { state, dispatch, userById } = useApp();
  return (
    <div
      className={`card${task.completed ? " done" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpenTask(task.id);
      }}
    >
      <div className="card-top">
        <TaskCheckbox task={task} />
        <button className="card-title" onClick={() => onOpenTask(task.id)}>
          {task.name}
        </button>
      </div>
      <div className="card-meta">
        <Avatar user={userById(task.assigneeId)} size={20} />
        {task.dueDate && (
          <span className="due">
            <Icon name="calendar" size={11} /> {formatDue(task.dueDate)}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {state.projects.find((p) => p.id === task.projectId) && (
          <span
            className="swatch"
            style={{
              background: `var(--swatch-${
                state.projects.find((p) => p.id === task.projectId)?.color ?? "none"
              }-bg)`,
            }}
            title={state.projects.find((p) => p.id === task.projectId)?.name}
          />
        )}
      </div>
    </div>
  );
}

function WeekAgenda({ tasks, onOpenTask }: { tasks: Task[]; onOpenTask: (id: string) => void }) {
  const { dispatch, userById } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), i));
  if (tasks.length === 0)
    return (
      <EmptyState
        icon="calendar"
        title="Nothing scheduled"
        description="Tasks with due dates in the next week show up here."
      />
    );
  return (
    <div className="col" style={{ gap: 16 }}>
      {days.map((day) => {
        const list = tasks.filter((t) => t.dueDate === day);
        return (
          <div key={day}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 500 }}>{formatDue(day)}</span>
              <span className="small weak">{list.length} tasks</span>
            </div>
            {list.map((task) => (
              <div className="task-row" key={task.id} onClick={() => onOpenTask(task.id)}>
                <TaskCheckbox task={task} />
                <span className="grow">{task.name}</span>
                <Avatar user={userById(task.assigneeId)} size={22} />
              </div>
            ))}
            {list.length === 0 && <div className="small weak">No tasks</div>}
          </div>
        );
      })}
    </div>
  );
}
