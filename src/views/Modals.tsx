import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { FieldType, ID, RuleActionType, RuleTriggerType, SwatchName } from "../core/types";
import { navigate } from "../core/router";
import { addDays, todayISO, uid } from "../core/utils";
import { Icon } from "../ui/icons";
import { ConditionsEditor, RuleInsights, ScheduleEditor } from "./RuleExtras";
import {
  Avatar,
  ColorGrid,
  DatePicker,
  MenuItem,
  Modal,
  Popover,
  usePopover,
} from "../ui/primitives";

/* ------------------------------------------------------- create project */
export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, toast } = useApp();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState(state.teams[0].id);
  const [color, setColor] = useState<SwatchName>("blue");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [template, setTemplate] = useState<"blank" | "list" | "board" | "timeline">("list");
  const teamPop = usePopover();

  const submit = () => {
    if (!name.trim()) return;
    const id = uid("p");
    dispatch({
      type: "project/create",
      project: { id, name: name.trim(), teamId, color, privacy },
    });
    onClose();
    toast("Project created");
    navigate(`/project/${id}/${template === "blank" ? "overview" : template}`);
  };

  return (
    <Modal
      title="Create project"
      icon={<Icon name="board" size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            Create project
          </button>
        </>
      }
    >
      <label className="small weak">Project name</label>
      <input
        className="input"
        autoFocus
        placeholder="e.g. Q1 product launch"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <div className="row" style={{ gap: 12 }}>
        <div className="col grow">
          <label className="small weak">Team</label>
          <button className="input row" style={{ justifyContent: "space-between" }} onClick={(e) => teamPop.openAt(e.currentTarget)}>
            <span>{state.teams.find((t) => t.id === teamId)?.name}</span>
            <Icon name="chevron-down" size={13} />
          </button>
        </div>
        <div className="col">
          <label className="small weak">Privacy</label>
          <div className="segmented">
            <button className={privacy === "public" ? "active" : ""} onClick={() => setPrivacy("public")}>
              Public
            </button>
            <button className={privacy === "private" ? "active" : ""} onClick={() => setPrivacy("private")}>
              Private
            </button>
          </div>
        </div>
      </div>
      <div className="col">
        <label className="small weak">Color</label>
        <ColorGrid value={color} onChange={setColor} />
      </div>
      <div className="col">
        <label className="small weak">Default layout</label>
        <div className="row" style={{ gap: 8 }}>
          {(["blank", "list", "board", "timeline"] as const).map((t) => (
            <button
              key={t}
              className={`chip${template === t ? " active" : ""}`}
              onClick={() => setTemplate(t)}
            >
              <Icon
                name={t === "blank" ? "plus" : t === "board" ? "board" : t === "timeline" ? "timeline" : "list"}
                size={12}
              />
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {teamPop.open && teamPop.anchor && (
        <Popover anchor={teamPop.anchor} onClose={teamPop.close} width={240}>
          {state.teams.map((t) => (
            <MenuItem
              key={t.id}
              checked={teamId === t.id}
              onClick={() => {
                setTeamId(t.id);
                teamPop.close();
              }}
            >
              <span className="swatch dot" style={{ background: `var(--swatch-${t.color}-bg)` }} />
              {t.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------- create task */
export function CreateTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: ID) => void;
}) {
  const { state, dispatch, toast } = useApp();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<ID | "">(state.projects[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState<ID | null>(state.currentUserId);
  const [dueDate, setDueDate] = useState<string | null>(todayISO());
  const [notes, setNotes] = useState("");
  const projPop = usePopover();
  const userPop = usePopover();

  const sections = state.sections.filter((s) => s.projectId === projectId);

  const submit = () => {
    if (!name.trim()) return;
    const id = uid("tk");
    dispatch({
      type: "task/create",
      patch: {
        id,
        name: name.trim(),
        projectId: projectId || null,
        sectionId: sections[0]?.id ?? null,
        assigneeId,
        dueDate,
        notes,
      },
    });
    onClose();
    toast("Task created");
    onCreated(id);
  };

  return (
    <Modal
      title="Create task"
      icon={<Icon name="plus" size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            Create task
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        placeholder="Task name"
        style={{ fontSize: 16, height: 40 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <div className="pane-grid" style={{ gridTemplateColumns: "84px 1fr" }}>
        <div className="k">Project</div>
        <div className="v">
          <button className="field-hover" onClick={(e) => projPop.openAt(e.currentTarget)}>
            {state.projects.find((p) => p.id === projectId)?.name ?? "No project"}
          </button>
        </div>
        <div className="k">Assignee</div>
        <div className="v">
          <button className="field-hover" onClick={(e) => userPop.openAt(e.currentTarget)}>
            {state.users.find((u) => u.id === assigneeId) ? (
              <span className="row" style={{ gap: 6 }}>
                <Avatar user={state.users.find((u) => u.id === assigneeId)} size={20} />
                {state.users.find((u) => u.id === assigneeId)?.name}
              </span>
            ) : (
              <span className="weak">Unassigned</span>
            )}
          </button>
        </div>
        <div className="k">Due date</div>
        <div className="v">
          <DatePicker value={dueDate} onChange={setDueDate}>
            {(open) => (
              <button className="field-hover" onClick={(e) => open(e.currentTarget)}>
                <Icon name="calendar" size={13} />
                {dueDate ? dueDate : <span className="weak">Set date</span>}
              </button>
            )}
          </DatePicker>
        </div>
      </div>
      <textarea
        className="textarea"
        placeholder="Description (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {projPop.open && projPop.anchor && (
        <Popover anchor={projPop.anchor} onClose={projPop.close} width={260}>
          {state.projects.map((p) => (
            <MenuItem
              key={p.id}
              checked={projectId === p.id}
              onClick={() => {
                setProjectId(p.id);
                projPop.close();
              }}
            >
              <span className="swatch" style={{ background: `var(--swatch-${p.color}-bg)` }} />
              {p.name}
            </MenuItem>
          ))}
          <MenuItem
            checked={projectId === ""}
            onClick={() => {
              setProjectId("");
              projPop.close();
            }}
          >
            No project
          </MenuItem>
        </Popover>
      )}
      {userPop.open && userPop.anchor && (
        <Popover anchor={userPop.anchor} onClose={userPop.close} width={260}>
          {state.users.map((u) => (
            <MenuItem
              key={u.id}
              checked={assigneeId === u.id}
              onClick={() => {
                setAssigneeId(u.id);
                userPop.close();
              }}
            >
              <Avatar user={u} size={20} /> {u.name}
            </MenuItem>
          ))}
          <MenuItem checked={assigneeId === null} onClick={() => setAssigneeId(null)}>
            Unassigned
          </MenuItem>
        </Popover>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------- invite */
export function InviteModal({ onClose }: { onClose: () => void }) {
  const { state, toast } = useApp();
  const [email, setEmail] = useState("");
  const [invited, setInvited] = useState<string[]>([]);

  return (
    <Modal
      title="Invite teammates"
      icon={<Icon name="users" size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const next = email
                .split(/[,\s]+/)
                .map((e) => e.trim())
                .filter(Boolean);
              if (!next.length) return;
              setInvited((v) => [...v, ...next]);
              setEmail("");
              toast(`${next.length} invitation${next.length === 1 ? "" : "s"} sent`);
            }}
          >
            Send invites
          </button>
        </>
      }
    >
      <label className="small weak">Email addresses</label>
      <textarea
        className="textarea"
        placeholder="name@company.com, teammate@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ minHeight: 60 }}
      />
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(`${location.origin}/#/home`);
            toast("Invite link copied");
          }}
        >
          <Icon name="link" size={12} /> Copy invite link
        </button>
        <span className="small weak">Anyone with the link can request access.</span>
      </div>
      {invited.length > 0 && (
        <>
          <div className="divider" />
          <label className="small weak">Pending invitations</label>
          {invited.map((e) => (
            <div key={e} className="row small" style={{ gap: 8, padding: "3px 0" }}>
              <Icon name="paper-plane" size={12} /> {e}
            </div>
          ))}
        </>
      )}
      <div className="divider" />
      <label className="small weak">Workspace members</label>
      {state.users.map((u) => (
        <div className="row" key={u.id} style={{ gap: 10, padding: "4px 0" }}>
          <Avatar user={u} size={26} />
          <span className="grow">{u.name}</span>
          <span className="small weak">{u.role}</span>
        </div>
      ))}
    </Modal>
  );
}

/* ---------------------------------------------------------- field library */
export function FieldLibraryModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, toast } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");

  return (
    <Modal
      title="Custom fields"
      icon={<Icon name="grid" size={16} />}
      onClose={onClose}
      wide
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="Field name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="input" style={{ width: 170 }} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="select">Dropdown</option>
          <option value="multiSelect">Multi-select</option>
          <option value="date">Date</option>
          <option value="people">People</option>
          <option value="checkbox">Checkbox</option>
          <option value="rating">Rating</option>
        </select>
        <button
          className="btn btn-primary"
          onClick={() => {
            if (!name.trim()) return;
            dispatch({
              type: "field/create",
              field: { name: name.trim(), type, options: [] },
            });
            setName("");
            toast("Field created");
          }}
        >
          Add field
        </button>
      </div>
      <div className="divider" />
      {state.fields.map((f) => (
        <div className="field-row" key={f.id}>
          <div className="row" style={{ gap: 8 }}>
            <Icon
              name={
                f.type === "number"
                  ? "chart"
                  : f.type === "date"
                    ? "calendar"
                    : f.type === "people"
                      ? "person"
                      : f.type === "checkbox"
                        ? "check"
                        : "list"
              }
              size={14}
            />
            <span>{f.name}</span>
          </div>
          <span className="small weak">{f.type}</span>
          <button
            className="icon-btn sm"
            title="Delete field"
            onClick={() => dispatch({ type: "field/delete", id: f.id })}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
    </Modal>
  );
}

/* ------------------------------------------------------------ rule builder */
const TRIGGERS: { key: RuleTriggerType; label: string }[] = [
  { key: "task-added", label: "Task is added to this project" },
  { key: "task-moved-section", label: "Task is moved to a section" },
  { key: "task-completed", label: "Task is completed" },
  { key: "assignee-changed", label: "Task assignee changes" },
  { key: "due-date-set", label: "Due date is set" },
  { key: "priority-changed", label: "Priority changes" },
  { key: "schedule", label: "On a schedule" },
];

const ACTIONS: { key: RuleActionType; label: string }[] = [
  { key: "assign", label: "Assign to" },
  { key: "set-due", label: "Set due date in N days" },
  { key: "set-priority", label: "Set priority" },
  { key: "move-section", label: "Move to section" },
  { key: "add-tag", label: "Add tag" },
  { key: "add-comment", label: "Comment" },
  { key: "add-follower", label: "Add collaborator" },
  { key: "complete", label: "Mark complete" },
  { key: "ai-comment", label: "AI comment (drafted)" },
];

export function RuleBuilderModal({
  projectId,
  onClose,
}: {
  projectId: ID;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const rules = state.rules.filter((r) => r.projectId === projectId);
  const project = state.projects.find((p) => p.id === projectId);
  const [selected, setSelected] = useState<ID | null>(rules[0]?.id ?? null);
  const rule = rules.find((r) => r.id === selected) ?? null;
  const sections = state.sections.filter((s) => s.projectId === projectId);

  return (
    <Modal
      title="Automations"
      icon={<Icon name="zap" size={16} />}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            className="btn btn-secondary"
            onClick={() => {
              dispatch({ type: "rule/create", projectId, name: "New automation" });
            }}
          >
            <Icon name="plus" size={13} /> New rule
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 240 }} className="col">
          <div className="small weak" style={{ marginBottom: 6 }}>
            {project?.name}
          </div>
          {rules.map((r) => (
            <button
              key={r.id}
              className={`side-item${selected === r.id ? " active" : ""}`}
              onClick={() => setSelected(r.id)}
            >
              <span className="side-icon">
                <Icon name="zap" size={14} />
              </span>
              <span className="side-label">{r.name}</span>
              <span className={`switch${r.enabled ? " on" : ""}`} style={{ width: 28, height: 16 }} />
            </button>
          ))}
          {rules.length === 0 && <span className="small weak">No automations yet.</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {!rule && <span className="small weak">Select a rule to edit.</span>}
          {rule && (
            <div className="col" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input"
                  value={rule.name}
                  onChange={(e) => dispatch({ type: "rule/update", id: rule.id, patch: { name: e.target.value } })}
                />
                <button
                  className={`switch${rule.enabled ? " on" : ""}`}
                  onClick={() => dispatch({ type: "rule/toggle", id: rule.id })}
                  title={rule.enabled ? "Disable" : "Enable"}
                />
              </div>
              <b className="row">
                <Icon name="zap" size={13} /> When
              </b>
              <select
                className="input"
                value={rule.trigger.type}
                onChange={(e) =>
                  dispatch({
                    type: "rule/update",
                    id: rule.id,
                    patch: { trigger: { ...rule.trigger, type: e.target.value as RuleTriggerType } },
                  })
                }
              >
                {TRIGGERS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              {rule.trigger.type === "task-moved-section" && (
                <select
                  className="input"
                  value={rule.trigger.value}
                  onChange={(e) =>
                    dispatch({
                      type: "rule/update",
                      id: rule.id,
                      patch: { trigger: { ...rule.trigger, value: e.target.value } },
                    })
                  }
                >
                  <option value="">Any section</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              {rule.trigger.type === "schedule" && <ScheduleEditor rule={rule} />}
              <ConditionsEditor rule={rule} sections={sections} />
              <b className="row">
                <Icon name="arrow-right" size={13} /> Then
              </b>
              {rule.actions.map((a) => (
                <div className="row" key={a.id} style={{ gap: 8 }}>
                  <select
                    className="input"
                    style={{ width: 200 }}
                    value={a.type}
                    onChange={(e) =>
                      dispatch({
                        type: "rule/actionSet",
                        ruleId: rule.id,
                        action: { ...a, type: e.target.value as RuleActionType },
                      })
                    }
                  >
                    {ACTIONS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  {a.type === "assign" || a.type === "add-follower" ? (
                    <select
                      className="input"
                      value={a.value}
                      onChange={(e) =>
                        dispatch({
                          type: "rule/actionSet",
                          ruleId: rule.id,
                          action: { ...a, value: e.target.value },
                        })
                      }
                    >
                      <option value="">Choose person</option>
                      {state.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  ) : a.type === "move-section" ? (
                    <select
                      className="input"
                      value={a.value}
                      onChange={(e) =>
                        dispatch({
                          type: "rule/actionSet",
                          ruleId: rule.id,
                          action: { ...a, value: e.target.value },
                        })
                      }
                    >
                      <option value="">Choose section</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : a.type === "set-priority" ? (
                    <select
                      className="input"
                      value={a.value}
                      onChange={(e) =>
                        dispatch({
                          type: "rule/actionSet",
                          ruleId: rule.id,
                          action: { ...a, value: e.target.value },
                        })
                      }
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  ) : a.type === "add-tag" ? (
                    <select
                      className="input"
                      value={a.value}
                      onChange={(e) =>
                        dispatch({
                          type: "rule/actionSet",
                          ruleId: rule.id,
                          action: { ...a, value: e.target.value },
                        })
                      }
                    >
                      <option value="">Choose tag</option>
                      {state.tags.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : a.type === "set-due" ? (
                    <input
                      className="input"
                      type="number"
                      value={a.value}
                      onChange={(e) =>
                        dispatch({
                          type: "rule/actionSet",
                          ruleId: rule.id,
                          action: { ...a, value: e.target.value },
                        })
                      }
                    />
                  ) : (
                    <input
                      className="input"
                      placeholder="Value"
                      value={a.value}
                      onChange={(e) =>
                        dispatch({
                          type: "rule/actionSet",
                          ruleId: rule.id,
                          action: { ...a, value: e.target.value },
                        })
                      }
                    />
                  )}
                  <button
                    className="icon-btn sm"
                    onClick={() =>
                      dispatch({ type: "rule/actionRemove", ruleId: rule.id, actionId: a.id })
                    }
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const type: RuleActionType = "assign";
                    dispatch({
                      type: "rule/actionSet",
                      ruleId: rule.id,
                      action: {
                        id: `${rule.id}-a-${Date.now()}`,
                        type,
                        value: state.currentUserId,
                      },
                    });
                  }}
                >
                  <Icon name="plus" size={12} /> Add action
                </button>
                <span className="small weak">Ran {rule.runCount} times</span>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    dispatch({ type: "rule/delete", id: rule.id });
                    setSelected(null);
                  }}
                >
                  <Icon name="trash" size={12} /> Delete rule
                </button>
              </div>
              <RuleInsights rule={rule} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ simple ones */
export function SimpleNameModal({
  title,
  icon,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  icon: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal
      title={title}
      icon={<Icon name={icon} size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              onSubmit(name.trim());
              onClose();
            }}
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            onSubmit(name.trim());
            onClose();
          }
        }}
      />
    </Modal>
  );
}

export function CreateGoalModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, toast } = useApp();
  const [name, setName] = useState("");
  const [target, setTarget] = useState(100);
  const [unit, setUnit] = useState("%");
  const [ownerId, setOwnerId] = useState<ID>(state.currentUserId);
  const [dueDate, setDueDate] = useState<string | null>(addDays(todayISO(), 90));

  return (
    <Modal
      title="Create goal"
      icon={<Icon name="target" size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              dispatch({
                type: "goal/create",
                name: name.trim(),
                patch: {
                  targetValue: target,
                  unit,
                  ownerId,
                  dueDate,
                },
              });
              toast("Goal created");
              onClose();
            }}
          >
            Create goal
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        placeholder="Goal name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="row" style={{ gap: 12 }}>
        <div className="col grow">
          <label className="small weak">Target value</label>
          <input
            className="input"
            type="number"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
        </div>
        <div className="col">
          <label className="small weak">Unit</label>
          <input className="input" style={{ width: 100 }} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="col grow">
          <label className="small weak">Owner</label>
          <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col">
          <label className="small weak">Due date</label>
          <DatePicker value={dueDate} onChange={setDueDate}>
            {(open) => (
              <button className="input row" onClick={(e) => open(e.currentTarget)}>
                {dueDate ?? "No date"}
              </button>
            )}
          </DatePicker>
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- shortcuts */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Global",
      rows: [
        ["⌘ K", "Open search / command palette"],
        ["⌘ /", "Focus search"],
        ["Tab then Q", "Quick add task"],
        ["G then H", "Go to Home"],
        ["G then M", "Go to My tasks"],
        ["G then I", "Go to Inbox"],
        ["⌘ Z", "Undo"],
        ["⌘ ⇧ Z", "Redo"],
        ["Esc", "Close pane or dialog"],
      ],
    },
    {
      title: "Tasks",
      rows: [
        ["Enter", "Open selected task"],
        ["⌘ ↵", "Complete selected task"],
        ["⌘ ↑ / ⌘ ↓", "Move task up or down"],
        ["Tab then A", "Assign to me"],
        ["Tab then D", "Set due date"],
        ["Backspace", "Delete selected task"],
      ],
    },
    {
      title: "Views",
      rows: [
        ["1", "List view"],
        ["2", "Board view"],
        ["3", "Timeline view"],
        ["4", "Calendar view"],
        ["5", "Dashboard"],
      ],
    },
  ];
  return (
    <Modal
      title="Keyboard shortcuts"
      icon={<Icon name="key" size={16} />}
      onClose={onClose}
      wide
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24 }}>
        {groups.map((g) => (
          <div key={g.title}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-weak)" }}>{g.title}</h4>
            {g.rows.map(([k, label]) => (
              <div className="row" key={k} style={{ padding: "4px 0", gap: 8 }}>
                <span className="kbd" style={{ minWidth: 44 }}>
                  {k}
                </span>
                <span className="small">{label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
