import React, { useState } from "react";
import { useApp } from "../core/store";
import type { ID, Section, Task } from "../core/types";
import { sectionTasks } from "../core/selectors";
import { dueState, formatDue, pct } from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  Checkbox,
  ConfirmButton,
  DatePicker,
  FieldEditor,
  FieldValueView,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  PriorityPill,
  TagPill,
  UserPicker,
  usePopover,
  TaskCheckbox,
} from "../ui/primitives";

function ColumnMenu({ section, onClose }: { section: Section; onClose: () => void }) {
  const { dispatch } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);
  return (
    <>
      {renaming ? (
        <div style={{ padding: 8 }}>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                dispatch({ type: "section/update", id: section.id, patch: { name } });
                onClose();
              }
            }}
          />
        </div>
      ) : (
        <MenuItem
          icon={<Icon name="align" size={14} />}
          onClick={() => setRenaming(true)}
        >
          Rename column
        </MenuItem>
      )}
      <MenuItem
        icon={<Icon name="plus" size={14} />}
        onClick={() => {
          dispatch({
            type: "task/create",
            patch: { name: "New task", projectId: section.projectId, sectionId: section.id },
          });
          onClose();
        }}
      >
        Add task
      </MenuItem>
      <MenuItem
        icon={<Icon name="arrow-left" size={14} />}
        onClick={() => {
          dispatch({ type: "section/move", id: section.id, beforeId: null });
          onClose();
        }}
      >
        Move to start
      </MenuItem>
      <MenuSeparator />
      <ConfirmButton
        label="Delete column"
        confirmLabel="Click again to delete"
        icon={<Icon name="trash" size={14} />}
        onConfirm={() => {
          dispatch({ type: "section/delete", id: section.id });
          onClose();
        }}
      />
    </>
  );
}

function BoardCard({
  task,
  onOpen,
  onDragStart,
  dragging,
  dropHint,
}: {
  task: Task;
  onOpen: (id: ID) => void;
  onDragStart: (e: React.DragEvent) => void;
  dragging: boolean;
  dropHint: "top" | "bottom" | null;
}) {
  const { state, dispatch, userById } = useApp();
  const assignee = userById(task.assigneeId);
  const due = dueState(task.dueDate, task.completed);
  const tagLabels = new Set(
    state.tags.filter((t) => task.tagIds.includes(t.id)).map((t) => t.name.toLowerCase())
  );
  const fields = state.fields.filter((f) => {
    if (f.type === "text" || task.customFields[f.id] == null) return false;
    if (f.id === "fld-priority" && task.priority) return false;
    const v = task.customFields[f.id];
    if (f.type === "select") {
      const opt = f.options.find((o) => o.id === v);
      if (opt && tagLabels.has(opt.name.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div
      className={`card${task.completed ? " done" : ""}${dragging ? " dragging" : ""}${
        dropHint === "top" ? " dragover-top" : dropHint === "bottom" ? " dragover-bottom" : ""
      }`}
      draggable
      onDragStart={onDragStart}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,input")) return;
        onOpen(task.id);
      }}
    >
      <div className="card-top">
        <TaskCheckbox task={task} />
        <button className="card-title" onClick={() => onOpen(task.id)}>
          {task.name}
        </button>
      </div>
      {task.coverGradient && (
        <div
          className="card-cover"
          style={{ background: task.coverGradient }}
          aria-hidden
        >
          <Icon name="image" size={24} />
        </div>
      )}
      <div className="card-fields">
        {task.priority && <PriorityPill priority={task.priority} />}
        {state.tags
          .filter((t) => task.tagIds.includes(t.id))
          .slice(0, 2)
          .map((t) => (
            <TagPill key={t.id} name={t.name} color={t.color} />
          ))}
        {fields.slice(0, 3).map((f) => (
          <span key={f.id} className="card-field" title={f.name}>
            {f.type !== "select" && f.type !== "multiSelect" && f.type !== "people" && (
              <span className="card-field-label">{f.name.replace(/\s*\(.*\)$/, "")}</span>
            )}
            <FieldValueView field={f} value={task.customFields[f.id]} state={state} />
          </span>
        ))}
      </div>
      <div className="card-meta">
        {assignee ? <Avatar user={assignee} size={20} /> : null}
        {task.dueDate && (
          <span className={`due ${due}`}>
            <Icon name="calendar" size={11} />
            {formatDue(task.dueDate)}
          </span>
        )}
        {task.attachments.length > 0 && (
          <span className="row" style={{ gap: 2 }}>
            <Icon name="paperclip" size={11} />
            {task.attachments.length}
          </span>
        )}
        {state.comments.filter((c) => c.taskId === task.id).length > 0 && (
          <span className="row" style={{ gap: 2 }}>
            <Icon name="comment" size={11} />
            {state.comments.filter((c) => c.taskId === task.id).length}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {task.milestone && <Icon name="milestone" size={12} />}
        {task.blockedByIds.some((id) => !state.tasks.find((t) => t.id === id)?.completed) && (
          <span title="Blocked">
            <Icon name="lock" size={12} />
          </span>
        )}
      </div>
    </div>
  );
}

function AddCard({ sectionId, projectId }: { sectionId: ID; projectId: ID }) {
  const { dispatch, can } = useApp();
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  if (!can("task:create", projectId)) return null;
  if (!active) {
    return (
      <button className="add-card" onClick={() => setActive(true)}>
        <Icon name="plus" size={13} /> Add task
      </button>
    );
  }
  const commit = () => {
    const name = value.trim();
    if (!name) {
      setActive(false);
      return;
    }
    dispatch({
      type: "task/create",
      patch: { name, projectId, sectionId },
    });
    setValue("");
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <textarea
        className="textarea"
        autoFocus
        style={{ minHeight: 56, fontSize: 14 }}
        placeholder="Task name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setActive(false);
        }}
      />
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={commit}>
          Add task
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setActive(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function BoardView({
  projectId,
  sections,
  onOpenTask,
}: {
  projectId: ID;
  sections: Section[];
  onOpenTask: (id: ID) => void;
}) {
  const { state, dispatch, can } = useApp();
  const canCreate = can("task:create", projectId);
  const [dragging, setDragging] = useState<ID[] | null>(null);
  const [overColumn, setOverColumn] = useState<ID | null>(null);
  const [overCard, setOverCard] = useState<{ id: ID; pos: "top" | "bottom" } | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumn, setNewColumn] = useState("");

  const handleDrop = (sectionId: ID) => {
    if (!dragging?.length) return;
    const list = sectionTasks(state, sectionId);
    const overIdx = overCard ? list.findIndex((t) => t.id === overCard.id) : -1;
    const beforeId = overCard
      ? overCard.pos === "top"
        ? overCard.id
        : overIdx >= 0
          ? list[overIdx + 1]?.id ?? null
          : null
      : null;
    dragging.forEach((id) => {
      dispatch({ type: "task/move", id, sectionId, beforeId });
    });
    setDragging(null);
    setOverCard(null);
    setOverColumn(null);
  };

  return (
    <div className="board-wrap">
      {sections.map((section) => {
        const tasks = sectionTasks(state, section.id);
        const done = tasks.filter((t) => t.completed).length;
        return (
          <div
            className={`board-col${overColumn === section.id ? " drag-over" : ""}`}
            key={section.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(section.id);
            }}
            onDragLeave={() => setOverColumn((c) => (c === section.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(section.id);
            }}
          >
            <BoardColumnHeader
              section={section}
              count={tasks.length}
              done={done}
              projectId={projectId}
            />
            <div className="board-col-body">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pos = e.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
                    setOverCard({ id: task.id, pos });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDrop(section.id);
                  }}
                >
                  <BoardCard
                    task={task}
                    onOpen={onOpenTask}
                    dragging={Boolean(dragging?.includes(task.id))}
                    dropHint={overCard?.id === task.id ? overCard.pos : null}
                    onDragStart={(e) => {
                      const ids =
                        dragging && dragging.includes(task.id) ? dragging : [task.id];
                      setDragging(ids);
                      e.dataTransfer.setData("text/task-id", task.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  />
                </div>
              ))}
              <AddCard sectionId={section.id} projectId={projectId} />
            </div>
          </div>
        );
      })}

      {canCreate && (
      <div className="add-column">
        {addingColumn ? (
          <div className="col" style={{ gap: 6 }}>
            <input
              className="input"
              autoFocus
              placeholder="Column name"
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  dispatch({
                    type: "section/create",
                    projectId,
                    name: newColumn.trim() || "New column",
                  });
                  setNewColumn("");
                  setAddingColumn(false);
                }
                if (e.key === "Escape") setAddingColumn(false);
              }}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                dispatch({
                  type: "section/create",
                  projectId,
                  name: newColumn.trim() || "New column",
                });
                setNewColumn("");
                setAddingColumn(false);
              }}
            >
              Add column
            </button>
          </div>
        ) : (
          <button onClick={() => setAddingColumn(true)}>
            <Icon name="plus" size={14} /> Add column
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function BoardColumnHeader({
  section,
  count,
  done,
  projectId,
}: {
  section: Section;
  count: number;
  done: number;
  projectId: ID;
}) {
  const pop = usePopover();
  return (
    <div className="board-col-head">
      {section.color && (
        <span
          className="swatch"
          style={{ background: `var(--swatch-${section.color}-bg)` }}
        />
      )}
      <span>{section.name}</span>
      <span className="count">{count}</span>
      {done > 0 && (
        <span
          className="small weak mono"
          title={`${pct(done, count)}% complete`}
        >
          {pct(done, count)}%
        </span>
      )}
      <button
        className="icon-btn sm"
        title="Column actions"
        onClick={(e) => pop.openAt(e.currentTarget)}
      >
        <Icon name="dots" size={14} />
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={230} align="end">
          <ColumnMenu section={section} onClose={pop.close} />
        </Popover>
      )}
    </div>
  );
}
