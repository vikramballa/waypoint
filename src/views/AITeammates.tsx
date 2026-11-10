import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { AgentSkill, ID, User } from "../core/types";
import { navigate } from "../core/router";
import { AGENT_AUTH_SCOPES, agentProjects, agentSkills, isAgent } from "../core/ai";
import { relativeTime, swatchBg } from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  ConfirmButton,
  MenuItem,
  Modal,
  Popover,
  usePopover,
} from "../ui/primitives";
import { projectFacts } from "../core/ai";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
};

function StatusPill({ status }: { status?: string }) {
  const cls =
    status === "active"
      ? "status-on-track"
      : status === "paused"
        ? "status-on-hold"
        : "status-at-risk";
  return <span className={`status-pill ${cls}`}>{STATUS_LABEL[status ?? "draft"]}</span>;
}

function SkillChips({ skills, max = 3 }: { skills: AgentSkill[]; max?: number }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      {skills.slice(0, max).map((s) => (
        <span className="chip" key={s.id} style={{ height: 22 }}>
          <Icon name={s.icon} size={11} />
          {s.name}
        </span>
      ))}
      {skills.length > max && (
        <span className="chip" style={{ height: 22 }}>
          +{skills.length - max}
        </span>
      )}
    </div>
  );
}

function SkillPreview({ skill, onClose }: { skill: AgentSkill; onClose: () => void }) {
  return (
    <Modal
      title={skill.name}
      icon={<Icon name={skill.icon} size={16} />}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <span className="ai-badge">
          <Icon name="sparkle" size={10} /> Skill · {skill.category}
        </span>
      </div>
      <p style={{ margin: 0, lineHeight: "22px" }}>{skill.description}</p>
      <label className="small weak">Example instruction</label>
      <div className="chip" style={{ height: "auto", padding: "8px 10px", whiteSpace: "normal" }}>
        {skill.example}
      </div>
      <div className="divider" />
      <div className="small weak">
        Skills are what an AI teammate is allowed to do. Grant only the skills the
        teammate needs — each one maps to actions on tasks and projects.
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- creation */
export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, toast } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("AI teammate");
  const [instructions, setInstructions] = useState("");
  const [skillIds, setSkillIds] = useState<ID[]>(["sk-triage"]);
  const [projectIds, setProjectIds] = useState<ID[]>([state.projects[0]?.id].filter(Boolean) as ID[]);
  const [scopes, setScopes] = useState<ID[]>(["scope-projects", "scope-comments"]);

  const toggle = (list: ID[], id: ID) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const create = () => {
    dispatch({
      type: "agent/create",
      patch: {
        name: name.trim() || "New AI teammate",
        role,
        instructions,
        skillIds,
        projectIds,
        authScopes: scopes,
      },
    });
    toast("AI teammate created", "Open AI teammates", () => navigate("/ai-teammates"));
    onClose();
  };

  return (
    <Modal
      title="Create AI teammate"
      icon={<Icon name="sparkle" size={16} />}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="small weak" style={{ marginRight: "auto" }}>
            Step {step + 1} of 3
          </span>
          <button className="btn btn-ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < 2 ? (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn btn-primary" onClick={create}>
              Create teammate
            </button>
          )}
        </>
      }
    >
      {step === 0 && (
        <>
          <label className="small weak">Name</label>
          <input
            className="input"
            autoFocus
            placeholder="e.g. Scout"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="small weak">Role</label>
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} />
          <label className="small weak">Instructions</label>
          <textarea
            className="textarea"
            rows={5}
            placeholder="Describe how this teammate should behave, what it should always do, and what it must never do."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <div className="small weak">
            Instructions are applied on every run. Be specific about scope and tone.
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <label className="small weak">Skills ({skillIds.length} selected)</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {state.skills.map((skill) => (
              <button
                key={skill.id}
                className={`skill-card${skillIds.includes(skill.id) ? " selected" : ""}`}
                onClick={() => setSkillIds(toggle(skillIds, skill.id))}
              >
                <div className="row" style={{ gap: 6 }}>
                  <Icon name={skill.icon} size={14} />
                  <span style={{ fontWeight: 500 }}>{skill.name}</span>
                  {skillIds.includes(skill.id) && (
                    <span style={{ marginLeft: "auto" }}>
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </div>
                <span className="small weak">{skill.description}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <label className="small weak">Projects this teammate can work in</label>
          <div className="col" style={{ gap: 2 }}>
            {state.projects.map((p) => (
              <button
                key={p.id}
                className="menu-item"
                onClick={() => setProjectIds(toggle(projectIds, p.id))}
              >
                <span className="menu-check">
                  {projectIds.includes(p.id) && <Icon name="check" size={13} />}
                </span>
                <span className="swatch" style={{ background: swatchBg(p.color) }} />
                {p.name}
              </button>
            ))}
          </div>
          <div className="divider" />
          <label className="small weak">Permissions</label>
          <div className="col" style={{ gap: 2 }}>
            {AGENT_AUTH_SCOPES.map((scope) => (
              <button
                key={scope.id}
                className="menu-item"
                onClick={() => {
                  if (scope.required) return;
                  setScopes(toggle(scopes, scope.id));
                }}
              >
                <span className="menu-check">
                  {(scope.required || scopes.includes(scope.id)) && (
                    <Icon name="check" size={13} />
                  )}
                </span>
                {scope.label}
                {scope.required && <span className="right small">Required</span>}
              </button>
            ))}
          </div>
          <div className="small weak">
            Granting a skill does not grant the permission — both are required for
            the teammate to act.
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ index */
export function AITeammatesView({ onCreate }: { onCreate: () => void }) {
  const { state, dispatch, userById } = useApp();
  const [preview, setPreview] = useState<AgentSkill | null>(null);
  const agents = state.users.filter((u) => isAgent(u));
  const runs = state.agentRuns;
  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "queued");

  return (
    <div className="page">
      <div className="page-scroll">
        <div style={{ padding: "24px 24px 64px", maxWidth: 1200 }}>
          <div className="row" style={{ gap: 10, marginBottom: 6 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              <span
                className="avatar avatar-agent"
                style={{ width: 28, height: 28, borderRadius: 8 }}
              >
                <Icon name="sparkle" size={16} />
              </span>
              AI teammates
            </h1>
            <span className="ai-badge">
              <Icon name="sparkle" size={10} /> Beta
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={() => navigate("/chat")}>
              <Icon name="messages" size={13} /> AI chat
            </button>
            <button className="btn btn-primary" onClick={onCreate}>
              <Icon name="plus" size={14} /> New teammate
            </button>
          </div>
          <p className="page-subtitle" style={{ marginBottom: 18 }}>
            Teammates that pick up work, triage requests and write updates inside the
            projects you grant them. {agents.length} teammates · {activeRuns.length} run
            {activeRuns.length === 1 ? "" : "s"} in flight.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {agents.map((agent) => {
              const skills = agentSkills(state, agent);
              const projects = agentProjects(state, agent);
              const agentRunList = runs.filter((r) => r.teammateId === agent.id);
              return (
                <button
                  key={agent.id}
                  className="agent-card"
                  onClick={() => navigate(`/ai-teammate/${agent.id}`)}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar user={agent} size={38} />
                    <div className="col" style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{agent.name}</span>
                      <span className="small weak truncate">{agent.role}</span>
                    </div>
                    <div style={{ marginLeft: "auto" }}>
                      <StatusPill status={agent.agentStatus} />
                    </div>
                  </div>
                  <div className="small weak" style={{ lineHeight: "18px" }}>
                    {(agent.instructions ?? "").slice(0, 130)}
                    {(agent.instructions ?? "").length > 130 ? "…" : ""}
                  </div>
                  <SkillChips skills={skills} />
                  <div className="row small weak" style={{ gap: 6 }}>
                    <Icon name="board" size={11} />
                    {projects.length} project{projects.length === 1 ? "" : "s"}
                    <span>·</span>
                    <Icon name="check-circle" size={11} />
                    {(agent.runCount ?? 0) + agentRunList.length} runs
                    {agent.agentStatus === "paused" && (
                      <>
                        <span>·</span>
                        <span>paused</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}

            <button
              className="agent-card"
              style={{ alignItems: "center", justifyContent: "center", minHeight: 190 }}
              onClick={onCreate}
            >
              <Icon name="plus-circle" size={24} />
              <span className="small">Create an AI teammate</span>
            </button>
          </div>

          <div className="row" style={{ margin: "28px 0 10px" }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Skill library</h2>
            <span className="small weak" style={{ marginLeft: 8 }}>
              {state.skills.length} skills
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {state.skills.map((skill) => (
              <button key={skill.id} className="skill-card" onClick={() => setPreview(skill)}>
                <div className="row" style={{ gap: 6 }}>
                  <Icon name={skill.icon} size={14} />
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{skill.name}</span>
                </div>
                <span className="small weak" style={{ lineHeight: "17px" }}>
                  {skill.description}
                </span>
              </button>
            ))}
          </div>

          <div className="row" style={{ margin: "28px 0 10px" }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Recent agent runs</h2>
            <span className="small weak" style={{ marginLeft: 8 }}>
              live + completed
            </span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {state.agentRuns.slice(0, 6).map((run) => {
              const agent = userById(run.teammateId);
              const task = run.taskId ? state.tasks.find((t) => t.id === run.taskId) : null;
              const project = run.projectId
                ? state.projects.find((p) => p.id === run.projectId)
                : null;
              const done = run.steps.filter((s) => s.at).length;
              return (
                <div
                  className="row"
                  key={run.id}
                  style={{
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                  }}
                >
                  <Avatar user={agent} size={24} />
                  <span className="small" style={{ width: 90 }}>
                    {agent?.name}
                  </span>
                  <span className="grow truncate small">
                    {task ? task.name : `${project?.name ?? "Project"} status`}
                  </span>
                  <span className={`status-pill ${run.status === "done" ? "status-on-track" : run.status === "cancelled" ? "status-off-track" : "status-on-hold"}`}>
                    {run.status}
                  </span>
                  <span className="small weak mono" style={{ width: 54, textAlign: "right" }}>
                    {done}/{run.steps.length}
                  </span>
                  <span className="small weak" style={{ width: 80, textAlign: "right" }}>
                    {relativeTime(run.startedAt)}
                  </span>
                  {run.status === "running" && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: "agent/runCancel", runId: run.id });
                      }}
                    >
                      Stop
                    </button>
                  )}
                </div>
              );
            })}
            {state.agentRuns.length === 0 && (
              <span className="small weak">No runs yet. Assign a task to a teammate.</span>
            )}
          </div>
        </div>
      </div>

      {preview && <SkillPreview skill={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ----------------------------------------------------------------- detail */
export function AITeammateView({ id }: { id: ID }) {
  const { state, dispatch, userById, toast } = useApp();
  const agent = state.users.find((u) => u.id === id && u.isAgent);
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const scopePop = usePopover();
  const runs = useMemo(
    () => state.agentRuns.filter((r) => r.teammateId === id),
    [state.agentRuns, id]
  );

  if (!agent) {
    return (
      <div className="page">
        <div className="empty">
          <h3>AI teammate not found</h3>
          <button className="btn btn-secondary" onClick={() => navigate("/ai-teammates")}>
            Back to AI teammates
          </button>
        </div>
      </div>
    );
  }

  const skillIds = agent.skillIds ?? [];
  const projectIds = agent.projectIds ?? [];
  const scopes = agent.authScopes ?? [];
  const toggle = (list: ID[], value: ID) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div className="page">
      <div className="page-scroll">
        <div style={{ padding: "24px 24px 64px", maxWidth: 1100 }}>
          <div className="row small weak" style={{ gap: 6, marginBottom: 12 }}>
            <button onClick={() => navigate("/ai-teammates")} style={{ color: "inherit" }}>
              AI teammates
            </button>
            <Icon name="chevron-right" size={11} />
            <span>{agent.name}</span>
          </div>

          <div className="agent-hero">
            <Avatar user={agent} size={56} />
            <div className="col" style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{agent.name}</h1>
                <span className="ai-badge">
                  <Icon name="sparkle" size={10} /> AI teammate
                </span>
                <StatusPill status={agent.agentStatus} />
              </div>
              <span className="small weak">
                {agent.role} · {agent.modelLabel} · {(agent.runCount ?? 0) + runs.length} runs
              </span>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => dispatch({ type: "agent/toggle", id: agent.id })}
                >
                  <Icon name={agent.agentStatus === "paused" ? "check-circle" : "clock"} size={13} />
                  {agent.agentStatus === "paused" ? "Resume teammate" : "Pause teammate"}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate("/chat")}>
                  <Icon name="messages" size={13} /> Ask it something
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => scopePop.openAt(e.currentTarget)}
                >
                  <Icon name="key" size={13} /> {scopes.length} permissions
                </button>
                <div style={{ flex: 1 }} />
                <ConfirmButton
                  className="btn btn-ghost btn-sm"
                  label="Delete teammate"
                  confirmLabel="Click again to delete"
                  icon={<Icon name="trash" size={13} />}
                  onConfirm={() => {
                    dispatch({
                      type: "agent/update",
                      id: agent.id,
                      patch: { agentStatus: "draft", projectIds: [] },
                    });
                    toast("AI teammate archived");
                    navigate("/ai-teammates");
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 16 }}>
            <div className="col" style={{ gap: 16 }}>
              <div className="stat-card">
                <h4>Instructions</h4>
                <textarea
                  className="textarea"
                  rows={6}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  onBlur={() =>
                    dispatch({
                      type: "agent/update",
                      id: agent.id,
                      patch: { instructions },
                    })
                  }
                />
                <span className="small weak">
                  Applied to every run. Changes take effect on the next task.
                </span>
              </div>

              <div className="stat-card">
                <h4>Skills</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {state.skills.map((skill) => {
                    const on = skillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        className={`skill-card${on ? " selected" : ""}`}
                        onClick={() =>
                          dispatch({
                            type: "agent/update",
                            id: agent.id,
                            patch: { skillIds: toggle(skillIds, skill.id) },
                          })
                        }
                      >
                        <div className="row" style={{ gap: 6 }}>
                          <Icon name={skill.icon} size={13} />
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{skill.name}</span>
                          {on && (
                            <span style={{ marginLeft: "auto" }}>
                              <Icon name="check" size={12} />
                            </span>
                          )}
                        </div>
                        <span className="small weak">{skill.description.slice(0, 70)}…</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="stat-card">
                <h4>Run history</h4>
                {runs.length === 0 && (
                  <span className="small weak">
                    No runs yet. Assign a task to {agent.name} to start one.
                  </span>
                )}
                {runs.map((run) => {
                  const task = run.taskId ? state.tasks.find((t) => t.id === run.taskId) : null;
                  return (
                    <div key={run.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border)" }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="grow truncate small">
                          {task ? task.name : `${state.projects.find((p) => p.id === run.projectId)?.name} status`}
                        </span>
                        <span className={`status-pill ${run.status === "done" ? "status-on-track" : run.status === "cancelled" ? "status-off-track" : "status-on-hold"}`}>
                          {run.status}
                        </span>
                        <span className="small weak">{relativeTime(run.startedAt)}</span>
                      </div>
                      <div className="col" style={{ gap: 0, marginTop: 4 }}>
                        {run.steps.map((step, i) => {
                          const applied = Boolean(step.at);
                          const activeStep = !applied && i === run.cursor && run.status === "running";
                          return (
                            <div className="run-step" key={step.id}>
                              <span className={`run-dot${applied ? " done" : activeStep ? " active" : ""}`}>
                                {applied ? <Icon name="check" size={10} /> : i + 1}
                              </span>
                              <span style={applied ? undefined : { color: "var(--color-text-weak)" }}>
                                {step.label}
                                {step.detail && (
                                  <span className="small weak"> — {step.detail}</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="col" style={{ gap: 16 }}>
              <div className="stat-card">
                <h4>Project access</h4>
                {state.projects.map((p) => {
                  const on = projectIds.includes(p.id);
                  const facts = on ? projectFacts(state, p.id) : null;
                  return (
                    <button
                      key={p.id}
                      className="row"
                      style={{ gap: 8, padding: "5px 0", textAlign: "left" }}
                      onClick={() =>
                        dispatch({
                          type: "agent/update",
                          id: agent.id,
                          patch: { projectIds: toggle(projectIds, p.id) },
                        })
                      }
                    >
                      <span className="menu-check">
                        {on && <Icon name="check" size={13} />}
                      </span>
                      <span className="swatch" style={{ background: swatchBg(p.color) }} />
                      <span className="grow truncate small">{p.name}</span>
                      {facts && <span className="small weak">{facts.open} open</span>}
                    </button>
                  );
                })}
              </div>

              <AgentGuardrails agentId={agent.id} />

              <div className="stat-card">
                <h4>Permissions</h4>
                {AGENT_AUTH_SCOPES.map((scope) => {
                  const on = scope.required || scopes.includes(scope.id);
                  return (
                    <div className="row small" key={scope.id} style={{ gap: 8, padding: "4px 0" }}>
                      <Icon
                        name={on ? "check-circle" : "lock"}
                        size={13}
                        style={{ color: on ? "var(--color-success-text)" : "var(--color-text-disabled)" }}
                      />
                      <span className={on ? undefined : "weak"}>{scope.label}</span>
                      {scope.required && <span className="small weak" style={{ marginLeft: "auto" }}>required</span>}
                    </div>
                  );
                })}
                <span className="small weak">
                  Granting a permission never grants a skill; both are required.
                </span>
              </div>

              <div className="stat-card">
                <h4>Assigned work</h4>
                {state.tasks.filter((t) => t.assigneeId === agent.id && !t.completed).length === 0 && (
                  <span className="small weak">Nothing assigned right now.</span>
                )}
                {state.tasks
                  .filter((t) => t.assigneeId === agent.id && !t.completed)
                  .slice(0, 6)
                  .map((t) => (
                    <button
                      key={t.id}
                      className="row small"
                      style={{ gap: 8, padding: "4px 0", textAlign: "left" }}
                      onClick={() => navigate(`/task/${t.id}`)}
                    >
                      <Icon name="check-circle" size={12} />
                      <span className="grow truncate">{t.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {scopePop.open && scopePop.anchor && (
        <Popover anchor={scopePop.anchor} onClose={scopePop.close} width={280} align="end">
          {AGENT_AUTH_SCOPES.map((scope) => (
            <MenuItem
              key={scope.id}
              checked={scope.required || scopes.includes(scope.id)}
              disabled={scope.required}
              onClick={() =>
                dispatch({
                  type: "agent/update",
                  id: agent.id,
                  patch: { authScopes: toggle(scopes, scope.id) },
                })
              }
            >
              {scope.label}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

export { isAgent };

/* ----------------------------------------------------------- guardrails */
function AgentGuardrails({ agentId }: { agentId: ID }) {
  const { state, dispatch, can, toast } = useApp();
  const agent = state.users.find((u) => u.id === agentId);
  const [budget, setBudget] = useState(String(agent?.runBudget ?? ""));
  if (!agent) return null;
  const month = new Date().toISOString().slice(0, 7);
  const used = agent.usage?.month === month ? agent.usage.runs : 0;
  const editable = can("agent:manage");
  const pending = state.agentRuns.filter((r) => r.teammateId === agentId && r.status === "review").length;
  return (
    <div className="stat-card">
      <h4>Guardrails</h4>
      <div className="setting-row">
        <div className="col">
          <span style={{ fontWeight: 550 }}>Require review</span>
          <span className="small weak">Finished runs wait for a person to accept or revert them.{pending ? ` ${pending} waiting now.` : ""}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Require review"
          aria-checked={!!agent.requireReview}
          disabled={!editable}
          className={`switch${agent.requireReview ? " on" : ""}`}
          onClick={() => dispatch({ type: "agent/update", id: agentId, patch: { requireReview: !agent.requireReview } })}
        />
      </div>
      <div className="setting-row">
        <div className="col">
          <span style={{ fontWeight: 550 }}>Monthly run budget</span>
          <span className="small weak">
            {used} run{used === 1 ? "" : "s"} used in {month}
            {agent.runBudget ? ` of ${agent.runBudget}` : " · unlimited"}
          </span>
          {agent.runBudget ? (
            <div className="bar-track" style={{ maxWidth: 200, marginTop: 4 }}>
              <div className="bar-fill" style={{ width: `${Math.min(100, (used / agent.runBudget) * 100)}%` }} />
            </div>
          ) : null}
        </div>
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = budget.trim() === "" ? 0 : Math.max(0, Math.min(10000, Math.round(Number(budget))));
            if (Number.isNaN(n)) return;
            dispatch({ type: "agent/update", id: agentId, patch: { runBudget: n || undefined } });
            toast(n ? `Budget set to ${n} runs a month` : "Budget removed");
          }}
        >
          <input
            className="input mono"
            style={{ width: 80 }}
            type="number"
            min={0}
            placeholder="∞"
            aria-label="Runs per month"
            disabled={!editable}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
          <button className="btn btn-secondary btn-sm" type="submit" disabled={!editable}>
            Save
          </button>
        </form>
      </div>
      <span className="small weak">
        Every task is screened for prompt-injection before the agent reads it; flagged runs pause for a person. Agents can only create subtasks, comment, estimate and complete their own subtasks — never delete, share or change roles.
      </span>
    </div>
  );
}
