import React, { useState } from "react";
import { useApp } from "../core/store";
import type { ID, RuleActionType, RuleTriggerType } from "../core/types";
import { navigate } from "../core/router";
import { relativeTime, swatchBg } from "../core/utils";
import { Icon } from "../ui/icons";
import { EmptyState, MenuItem, Popover, usePopover } from "../ui/primitives";

const TRIGGER_LABEL: Record<RuleTriggerType, string> = {
  "task-added": "Task is added to the project",
  "task-moved-section": "Task moves to a section",
  "task-completed": "Task is completed",
  "assignee-changed": "Assignee changes",
  "due-date-set": "Due date is set",
  "field-changed": "A custom field changes",
  "priority-changed": "Priority changes",
  schedule: "On a schedule",
};

const ACTION_LABEL: Record<RuleActionType, string> = {
  assign: "Assign",
  "set-due": "Set due date",
  "set-priority": "Set priority",
  "move-section": "Move to section",
  "add-tag": "Add tag",
  "add-comment": "Comment",
  "add-follower": "Add collaborator",
  complete: "Mark complete",
  "set-field": "Set field",
  "ai-comment": "AI comment",
};

export function AutomationsView({ onEdit }: { onEdit: (projectId: ID) => void }) {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState<ID | "all">("all");
  const filterPop = usePopover();
  const rules = state.rules.filter((r) => filter === "all" || r.projectId === filter);
  const aiActions = state.rules.reduce(
    (n, r) => n + r.actions.filter((a) => a.type === "ai-comment").length,
    0
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="zap" size={22} /> Automations
          </h1>
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={(e) => filterPop.openAt(e.currentTarget)}>
              <Icon name="filter" size={13} />
              {filter === "all"
                ? "All projects"
                : state.projects.find((p) => p.id === filter)?.name}
            </button>
            <button className="btn btn-primary" onClick={() => onEdit(state.projects[0].id)}>
              <Icon name="plus" size={14} /> New automation
            </button>
          </div>
        </div>
        <p className="page-subtitle">
          {state.rules.length} rules · {state.rules.filter((r) => r.enabled).length} enabled ·{" "}
          {aiActions} AI action{aiActions === 1 ? "" : "s"} ·{" "}
          {state.rules.reduce((n, r) => n + r.runCount, 0)} total runs
        </p>
      </div>

      <div className="page-scroll">
        <div style={{ padding: "8px 24px 48px", maxWidth: 1000 }}>
          {rules.length === 0 && (
            <EmptyState
              icon="zap"
              title="No automations"
              description="Automations react to changes in a project — assign owners, move work, comment, or ask an AI teammate to write."
              action={
                <button className="btn btn-primary" onClick={() => onEdit(state.projects[0].id)}>
                  Create automation
                </button>
              }
            />
          )}
          {rules.map((rule) => {
            const project = state.projects.find((p) => p.id === rule.projectId);
            return (
              <div
                key={rule.id}
                className="row"
                style={{
                  gap: 12,
                  padding: "12px 10px",
                  borderBottom: "1px solid var(--color-border)",
                  alignItems: "flex-start",
                }}
              >
                <span
                  className="side-icon"
                  style={{ marginTop: 2, color: rule.enabled ? "var(--color-primary-icon)" : "var(--color-icon-disabled)" }}
                >
                  <Icon name="zap" size={16} />
                </span>
                <div className="col grow" style={{ minWidth: 0, gap: 4 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      style={{ fontWeight: 500, textAlign: "left" }}
                      onClick={() => onEdit(rule.projectId)}
                    >
                      {rule.name}
                    </button>
                    <button
                      className="chip"
                      style={{ height: 20 }}
                      onClick={() => navigate(`/project/${rule.projectId}/list`)}
                    >
                      <span className="swatch" style={{ background: swatchBg(project?.color) }} />
                      {project?.name}
                    </button>
                    {rule.actions.some((a) => a.type === "ai-comment") && (
                      <span className="ai-badge">
                        <Icon name="sparkle" size={10} /> AI action
                      </span>
                    )}
                  </div>
                  <div className="row small weak" style={{ gap: 6, flexWrap: "wrap" }}>
                    <span className="rule-tag">When</span>
                    {TRIGGER_LABEL[rule.trigger.type]}
                    {rule.trigger.type === "task-moved-section" && rule.trigger.value && (
                      <span>
                        → {state.sections.find((s) => s.id === rule.trigger.value)?.name}
                      </span>
                    )}
                    <Icon name="arrow-right" size={11} />
                    <span className="rule-tag">Then</span>
                    {rule.actions.map((a) => ACTION_LABEL[a.type]).join(", ") || "no actions"}
                  </div>
                  <div className="small weak">
                    Ran {rule.runCount} time{rule.runCount === 1 ? "" : "s"}
                    {rule.createdBy &&
                      ` · created by ${state.users.find((u) => u.id === rule.createdBy)?.name ?? "someone"}`}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className={`switch${rule.enabled ? " on" : ""}`}
                    onClick={() => dispatch({ type: "rule/toggle", id: rule.id })}
                    title={rule.enabled ? "Disable" : "Enable"}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={() => onEdit(rule.projectId)}>
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filterPop.open && filterPop.anchor && (
        <Popover anchor={filterPop.anchor} onClose={filterPop.close} width={260} align="end">
          <MenuItem checked={filter === "all"} onClick={() => { setFilter("all"); filterPop.close(); }}>
            All projects
          </MenuItem>
          {state.projects.map((p) => (
            <MenuItem
              key={p.id}
              checked={filter === p.id}
              onClick={() => {
                setFilter(p.id);
                filterPop.close();
              }}
            >
              <span className="swatch" style={{ background: swatchBg(p.color) }} />
              {p.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

export function TemplatesView() {
  const { state, dispatch, toast } = useApp();
  const [useId, setUseId] = useState<ID | null>(null);
  const [name, setName] = useState("");
  const template = state.templates.find((t) => t.id === useId);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="grid" size={22} /> Project templates
          </h1>
        </div>
        <p className="page-subtitle">
          Start from a repeatable structure — sections, tasks and milestones are created
          for you.
        </p>
      </div>
      <div className="page-scroll">
        <div style={{ padding: "8px 24px 48px", maxWidth: 1200 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {state.templates.map((t) => (
              <div key={t.id} className="agent-card">
                <div className="row" style={{ gap: 10 }}>
                  <span
                    className="mini-project-icon"
                    style={{ background: swatchBg(t.color), width: 28, height: 28, fontSize: 13 }}
                  >
                    <Icon name={t.icon} size={15} />
                  </span>
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                </div>
                <span className="small weak" style={{ lineHeight: "18px" }}>
                  {t.description}
                </span>
                <div className="col" style={{ gap: 3 }}>
                  {t.sections.map((s) => (
                    <div className="row small weak" key={s.name} style={{ gap: 6 }}>
                      <Icon name="list" size={11} />
                      {s.name}
                      <span style={{ marginLeft: "auto" }}>{s.tasks.length}</span>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setUseId(t.id);
                    setName(t.name);
                  }}
                >
                  Use template
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {template && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUseId(null)}>
          <div className="modal">
            <div className="modal-head">
              <Icon name={template.icon} size={16} />
              <div className="modal-title grow">Use “{template.name}”</div>
              <button className="icon-btn" onClick={() => setUseId(null)}>
                <Icon name="close" />
              </button>
            </div>
            <div className="modal-body">
              <label className="small weak">Project name</label>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              <div className="small weak">
                {template.sections.length} sections ·{" "}
                {template.sections.reduce((n, s) => n + s.tasks.length, 0)} tasks
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setUseId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const projectId = `p-${Date.now().toString(36)}`;
                  dispatch({
                    type: "template/instantiate",
                    templateId: template.id,
                    name: name.trim() || template.name,
                    projectId,
                  });
                  setUseId(null);
                  toast("Project created from template");
                  navigate(`/project/${projectId}/board`);
                }}
              >
                Create project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { relativeTime };
