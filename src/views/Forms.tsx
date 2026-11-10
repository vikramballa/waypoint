import React, { useState } from "react";
import { useApp } from "../core/store";
import type { ID, ProjectForm } from "../core/types";
import { navigate } from "../core/router";
import { formatDue, swatchBg, todayISO } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, EmptyState, UserPicker } from "../ui/primitives";

function FormRunner({ form }: { form: ProjectForm }) {
  const { state, dispatch, toast } = useApp();
  const [values, setValues] = useState<Record<string, string | string[] | boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const set = (id: ID, value: string | string[] | boolean) =>
    setValues((v) => ({ ...v, [id]: value }));

  const submit = () => {
    dispatch({ type: "form/submit", projectId: form.projectId, values });
    setSubmitted(true);
    toast("Response submitted — task created");
  };

  if (submitted) {
    return (
      <div className="empty">
        <div className="empty-art" style={{ background: "var(--color-success-background)", color: "var(--color-success-text)" }}>
          <Icon name="check" size={36} />
        </div>
        <h3>Response received</h3>
        <p>A task was created in the project and the requester was added as a collaborator.</p>
        <button className="btn btn-secondary" onClick={() => { setSubmitted(false); setValues({}); }}>
          Submit another response
        </button>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{form.title}</h2>
        <p className="small weak" style={{ marginTop: 6, lineHeight: "20px" }}>
          {form.description}
        </p>
      </div>
      {form.fields.map((field) => (
        <div className="col" key={field.id} style={{ gap: 6 }}>
          <label className="small" style={{ fontWeight: 500 }}>
            {field.label}
            {field.required && <span style={{ color: "var(--color-danger-text)" }}> *</span>}
          </label>
          {field.type === "text" && (
            <input
              className="input"
              value={String(values[field.id] ?? "")}
              onChange={(e) => set(field.id, e.target.value)}
            />
          )}
          {field.type === "textarea" && (
            <textarea
              className="textarea"
              rows={4}
              value={String(values[field.id] ?? "")}
              onChange={(e) => set(field.id, e.target.value)}
            />
          )}
          {field.type === "date" && (
            <input
              className="input"
              type="date"
              value={String(values[field.id] ?? "")}
              onChange={(e) => set(field.id, e.target.value)}
            />
          )}
          {field.type === "select" && (
            <select
              className="input"
              value={String(values[field.id] ?? "")}
              onChange={(e) => set(field.id, e.target.value)}
            >
              <option value="">Choose…</option>
              {(field.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {field.type === "people" && (
            <UserPicker
              value={(values[field.id] as string) ?? null}
              onChange={(id) => set(field.id, id ?? "")}
            >
              {(open) => (
                <button className="input row" style={{ justifyContent: "space-between" }} onClick={(e) => open(e.currentTarget)}>
                  <span className="row" style={{ gap: 6 }}>
                    {values[field.id] ? (
                      <>
                        <Avatar user={state.users.find((u) => u.id === values[field.id])} size={20} />
                        {state.users.find((u) => u.id === values[field.id])?.name}
                      </>
                    ) : (
                      <span className="weak">Select a person</span>
                    )}
                  </span>
                  <Icon name="chevron-down" size={13} />
                </button>
              )}
            </UserPicker>
          )}
          {field.type === "checkbox" && (
            <label className="row small" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(values[field.id])}
                onChange={(e) => set(field.id, e.target.checked)}
              />
              Yes
            </label>
          )}
        </div>
      ))}
      <div className="row">
        <button className="btn btn-primary" onClick={submit}>
          Submit
        </button>
        <span className="small weak">{form.submissions} responses so far</span>
      </div>
    </div>
  );
}

export function ProjectFormTab({ projectId }: { projectId: ID }) {
  const { state, dispatch, can, mode, toast } = useApp();
  const form = state.forms.find((f) => f.projectId === projectId);
  const project = state.projects.find((p) => p.id === projectId);
  const canManage = can("form:manage", projectId);

  if (!form) {
    return (
      <EmptyState
        icon="form"
        title="No form for this project"
        description="Forms turn intake into tasks without giving everyone edit access."
        action={
          <button
            className="btn btn-primary"
            onClick={() => {
              dispatch({ type: "form/create", projectId });
              toast("Form created");
            }}
            disabled={!canManage}
            title={canManage ? undefined : "Only project editors can create forms"}
          >
            Create form
          </button>
        }
      />
    );
  }

  return (
    <div className="page-scroll">
      <div style={{ padding: "16px 24px 64px", display: "flex", gap: 32, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: 620 }}>
          <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap", rowGap: 8 }}>
            <span className="chip">
              <span className="swatch" style={{ background: swatchBg(project?.color) }} />
              {project?.name} intake
            </span>
            <span className="chip">
              <Icon name="check-circle" size={11} /> {form.submissions} submissions
            </span>
            <div style={{ flex: 1 }} />
            {canManage && (
              <label
                className="row small"
                style={{ gap: 6 }}
                title={mode === "server" ? "Anyone with the link can submit, no account needed" : "Public links need the Waypoint server"}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!form.public}
                  aria-label="Accept public submissions"
                  disabled={mode !== "server"}
                  className={`switch${form.public ? " on" : ""}`}
                  style={{ width: 28, height: 16 }}
                  onClick={() => dispatch({ type: "form/update", id: form.id, patch: { public: !form.public } })}
                />
                Public link
              </label>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const url = form.public && mode === "server" ? `${location.origin}/#/f/${form.id}` : `${location.origin}/#/project/${projectId}/form`;
                navigator.clipboard?.writeText(url);
                toast(form.public && mode === "server" ? "Public link copied — protected by spam checks and rate limits" : "Link copied (workspace members only)");
              }}
            >
              <Icon name="link" size={12} /> Copy {form.public && mode === "server" ? "public" : "form"} link
            </button>
          </div>
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              padding: 24,
              background: "var(--color-background-weak)",
            }}
          >
            <FormRunner form={form} />
          </div>
        </div>
        <div style={{ width: 280 }}>
          <div className="stat-card">
            <h4>Form settings</h4>
            <label className="small weak">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) =>
                dispatch({ type: "form/update", id: form.id, patch: { title: e.target.value } })
              }
            />
            <label className="small weak">Description</label>
            <textarea
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) =>
                dispatch({
                  type: "form/update",
                  id: form.id,
                  patch: { description: e.target.value },
                })
              }
            />
            <div className="divider" />
            <h4>Fields</h4>
            {form.fields.map((f) => (
              <div className="row small" key={f.id} style={{ gap: 6, padding: "3px 0" }}>
                <Icon name="form" size={11} />
                <span className="grow truncate">{f.label}</span>
                <span className="weak">{f.type}</span>
              </div>
            ))}
            <div className="divider" />
            <div className="small weak">
              Submissions create tasks in the first section and notify followers.{" "}
              {formatDue(todayISO())} · auto-assigned to the requester when provided.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FormsView() {
  const { state } = useApp();
  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="form" size={22} /> Forms
          </h1>
        </div>
        <p className="page-subtitle">
          {state.forms.length} forms ·{" "}
          {state.forms.reduce((n, f) => n + f.submissions, 0)} responses
        </p>
      </div>
      <div className="page-scroll">
        <div style={{ padding: "8px 24px 48px", maxWidth: 900 }}>
          {state.forms.map((form) => {
            const project = state.projects.find((p) => p.id === form.projectId);
            return (
              <div
                key={form.id}
                className="row"
                style={{
                  gap: 12,
                  padding: "12px 10px",
                  borderBottom: "1px solid var(--color-border)",
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/project/${form.projectId}/form`)}
              >
                <Icon name="form" size={16} />
                <div className="col grow" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{form.title}</span>
                  <span className="small weak truncate">
                    {project?.name} · {form.fields.length} fields
                  </span>
                </div>
                <span className="chip">{form.submissions} responses</span>
                <Icon name="chevron-right" size={13} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
