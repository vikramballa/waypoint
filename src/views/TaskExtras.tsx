import React, { useRef, useState } from "react";
import { useApp } from "../core/store";
import { approversOf } from "../core/reducer";
import { taskHours } from "../core/insights";
import { relativeTime } from "../core/utils";
import type { Attachment, ID, Recurrence, Task } from "../core/types";
import { Icon } from "../ui/icons";
import { ApprovalMark, approvalLabel, Avatar, AvatarStack, Popover, usePopover } from "../ui/primitives";

/* ================================================================ presence */
export function PresenceAvatars({ taskId, projectId }: { taskId?: ID; projectId?: ID }) {
  const { presence, userById, user } = useApp();
  const here = Array.from(
    new Set(
      presence
        .filter((p) => (taskId ? p.taskId === taskId : projectId ? p.projectId === projectId : false))
        .map((p) => p.userId)
        .filter((id) => id !== user.id)
    )
  )
    .map((id) => userById(id))
    .filter(Boolean);
  if (!here.length) return null;
  return (
    <span className="presence-row" aria-live="polite" title={here.map((u) => u!.name).join(", ") + (taskId ? " also viewing" : " in this project")}>
      <AvatarStack users={here} size={20} />
      {here.length === 1 ? `${here[0]!.name.split(" ")[0]} is here` : `${here.length} people here`}
    </span>
  );
}

/* ============================================================== recurrence */
const RECUR_LABEL: Record<Recurrence["every"], string> = {
  day: "Every day",
  weekday: "Every weekday",
  week: "Every week",
  month: "Every month",
};

export function RecurrenceField({ task, editable }: { task: Task; editable: boolean }) {
  const { dispatch, toast } = useApp();
  const pop = usePopover();
  const r = task.recurrence;
  const set = (rec: Recurrence | undefined) => {
    dispatch({ type: "task/update", id: task.id, patch: { recurrence: rec } });
    toast(rec ? `${RECUR_LABEL[rec.every]} — the next one is created when this is completed` : "No longer repeats");
    pop.close();
  };
  return (
    <>
      <button className="field-hover" disabled={!editable} onClick={(e) => pop.openAt(e.currentTarget)}>
        {r ? (
          <>
            <Icon name="refresh" size={13} /> {r.interval > 1 ? `Every ${r.interval} ${r.every}s` : RECUR_LABEL[r.every]}
          </>
        ) : (
          <span className="weak">Doesn't repeat</span>
        )}
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220}>
          {(Object.keys(RECUR_LABEL) as Recurrence["every"][]).map((every) => (
            <button key={every} className="menu-item" onClick={() => set({ every, interval: 1 })}>
              {RECUR_LABEL[every]}
            </button>
          ))}
          <button className="menu-item" onClick={() => set({ every: "week", interval: 2 })}>
            Every 2 weeks
          </button>
          {r && (
            <button className="menu-item danger" onClick={() => set(undefined)}>
              Stop repeating
            </button>
          )}
        </Popover>
      )}
    </>
  );
}

export function EstimateField({ task, editable }: { task: Task; editable: boolean }) {
  const { dispatch } = useApp();
  const [value, setValue] = useState(task.estimateHours?.toString() ?? "");
  const fallback = taskHours({ ...task, estimateHours: undefined });
  return (
    <input
      className="field-input"
      type="number"
      min={0}
      max={400}
      step={0.5}
      inputMode="decimal"
      disabled={!editable}
      aria-label="Estimate in hours"
      placeholder={`${fallback}h (from effort)`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const n = value === "" ? undefined : Math.max(0, Math.min(400, Number(value)));
        if (n === task.estimateHours || (n !== undefined && Number.isNaN(n))) return;
        dispatch({ type: "task/update", id: task.id, patch: { estimateHours: n } });
      }}
    />
  );
}

/* ============================================================== approvals */
export function ApprovalPanel({ taskId }: { taskId: ID }) {
  const { state, dispatch, user, userById, toast, can } = useApp();
  const [note, setNote] = useState("");
  const pick = usePopover();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task?.approvalStatus) return null;
  const approvers = approversOf(task);
  const votes = task.approvals ?? [];
  const required = Math.min(Math.max(1, task.approvalsRequired ?? approvers.length), Math.max(1, approvers.length));
  const approvedCount = votes.filter((v) => v.decision === "approved").length;
  const status = task.approvalStatus;
  const canDecide = status === "pending" && approvers.includes(user.id) && !votes.some((v) => v.userId === user.id);
  const editable = can("task:edit", task.projectId);
  const project = state.projects.find((p) => p.id === task.projectId);
  const people = state.users.filter((u) => !u.isAgent && (!project || project.memberIds.includes(u.id) || u.workspaceRole === "owner" || u.workspaceRole === "admin"));

  const decide = (decision: "approved" | "rejected" | "changes-requested") => {
    dispatch({ type: "task/decide", id: task.id, decision, note: note.trim() || undefined });
    setNote("");
    toast(decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Changes requested");
  };
  const setApprovers = (ids: ID[]) =>
    dispatch({
      type: "task/update",
      id: task.id,
      patch: { approverIds: ids, approvalsRequired: Math.min(task.approvalsRequired ?? ids.length, Math.max(1, ids.length)) },
    });

  return (
    <section className={`approval-panel approval-${status}`} aria-label="Approval">
      <div className="approval-head">
        <ApprovalMark task={task} size={20} />
        <div className="col" style={{ minWidth: 0, flex: 1 }}>
          <strong>{approvalLabel(task)}</strong>
          <span className="small weak">
            {approvers.length === 0
              ? "Add an approver to request sign-off"
              : status === "pending"
                ? `${approvedCount} of ${required} approval${required === 1 ? "" : "s"} needed`
                : `Decided ${relativeTime(votes[votes.length - 1]?.at ?? task.modifiedAt)}`}
          </span>
        </div>
        {editable && status === "pending" && (
          <button className="btn btn-ghost btn-sm" onClick={(e) => pick.openAt(e.currentTarget)}>
            Approvers
          </button>
        )}
        {editable && status === "changes-requested" && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              dispatch({ type: "task/update", id: task.id, patch: { approvalStatus: "pending" } });
              toast("Sent back for approval");
            }}
          >
            Request again
          </button>
        )}
      </div>

      <ul className="approver-list">
        {approvers.map((id) => {
          const u = userById(id);
          const vote = votes.find((v) => v.userId === id);
          return (
            <li key={id}>
              <Avatar user={u} size={20} />
              <span className="grow truncate">{u?.name ?? "Unknown"}</span>
              <span className={`vote vote-${vote?.decision ?? "waiting"}`}>
                {vote ? (vote.decision === "approved" ? "Approved" : vote.decision === "rejected" ? "Rejected" : "Changes requested") : "Waiting"}
              </span>
              {vote?.note && <span className="small weak vote-note">“{vote.note}”</span>}
            </li>
          );
        })}
      </ul>

      {canDecide && (
        <>
          <textarea
            className="approval-note"
            placeholder="Add a note (optional)"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" onClick={() => decide("approved")}>
              <Icon name="check" size={13} /> Approve
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => decide("changes-requested")}>
              <Icon name="refresh" size={13} /> Request changes
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => decide("rejected")}>
              <Icon name="close" size={13} /> Reject
            </button>
          </div>
        </>
      )}

      {pick.open && pick.anchor && (
        <Popover anchor={pick.anchor} onClose={pick.close} width={260}>
          <div className="small weak" style={{ padding: "4px 8px" }}>
            Who needs to sign off
          </div>
          {people.map((u) => {
            const on = approvers.includes(u.id);
            return (
              <button
                key={u.id}
                className="menu-item"
                aria-pressed={on}
                onClick={() => setApprovers(on ? approvers.filter((x) => x !== u.id) : [...approvers, u.id])}
              >
                <Avatar user={u} size={18} /> {u.name}
                {on && <Icon name="check" size={13} style={{ marginLeft: "auto" }} />}
              </button>
            );
          })}
          {approvers.length > 1 && (
            <div className="row small" style={{ gap: 6, padding: "6px 8px" }}>
              Needs
              <select
                className="input"
                aria-label="Approvals required"
                value={required}
                onChange={(e) => dispatch({ type: "task/update", id: task.id, patch: { approvalsRequired: Number(e.target.value) } })}
              >
                {approvers.map((_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
              of {approvers.length}
            </div>
          )}
        </Popover>
      )}
    </section>
  );
}

/* ============================================================ attachments */
const LOCAL_MAX = 5 * 1024 * 1024;

/** Local-mode file storage: IndexedDB (binary-safe, outside the localStorage quota). */
function filesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("waypoint-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putLocalFile(id: string, blob: Blob) {
  const db = await filesDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getLocalFile(id: string): Promise<Blob | undefined> {
  const db = await filesDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("files").objectStore("files").get(id);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}
const LOCAL_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|text\/csv|text\/markdown)$/;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsSection({ task }: { task: Task }) {
  const { mode, dispatch, toast, canEdit, state } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const editable = canEdit(task.id);

  const upload = async (file: File) => {
    if (mode === "server") {
      setBusy(true);
      try {
        const res = await fetch(`/api/files?taskId=${encodeURIComponent(task.id)}&name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          body: file,
          credentials: "same-origin",
          headers: { "x-requested-with": "waypoint" },
        });
        const data = await res.json().catch(() => ({}));
        toast(res.status === 201 ? `Attached ${file.name}` : data.message ?? "Upload failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    // local mode: small files kept in this browser
    if (file.size > LOCAL_MAX) return toast("In local mode files must be under 5 MB — run the server for larger uploads");
    if (!LOCAL_TYPES.test(file.type)) return toast("Only images, PDFs and text files can be attached");
    const id = `att-${Date.now().toString(36)}`;
    try {
      await putLocalFile(id, file);
    } catch {
      return toast("This browser couldn't store the file");
    }
    const att: Attachment = {
      id,
      name: file.name.slice(0, 180),
      kind: file.type.startsWith("image/") ? "image" : "file",
      meta: `${file.type.split("/")[1]?.toUpperCase() ?? "FILE"} · ${formatBytes(file.size)}`,
      addedById: state.currentUserId,
      createdAt: new Date().toISOString(),
      size: file.size,
      mime: file.type,
      fileId: `local:${id}`,
    };
    dispatch({ type: "task/update", id: task.id, patch: { attachments: [...task.attachments, att] } });
    toast(`Attached ${file.name}`);
  };

  const download = async (att: Attachment) => {
    if (att.fileId?.startsWith("local:")) {
      const blob = await getLocalFile(att.fileId.slice(6)).catch(() => undefined);
      if (!blob) return toast("That file isn't stored in this browser");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = att.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    if (att.fileId && mode === "server") {
      const res = await fetch(`/api/files/${att.fileId}/url`, { credentials: "same-origin" });
      if (!res.ok) return toast("You can't download this file");
      const { url } = await res.json();
      window.open(url, "_blank", "noopener");
      return;
    }
    toast("This is sample data — there's no file behind it");
  };

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <div className="pane-section-title">
          <Icon name="paperclip" size={14} /> Attachments
        </div>
        <div style={{ flex: 1 }} />
        {editable && (
          <>
            <button className="chip" disabled={busy} onClick={() => input.current?.click()}>
              <Icon name="plus" size={11} /> {busy ? "Uploading…" : "Add file"}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,.md,.docx,.xlsx,.pptx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
      {task.attachments.length === 0 && <span className="small weak">No files yet.</span>}
      {task.attachments.map((att) => (
        <div className="row attachment-row" key={att.id}>
          <span className="attachment-icon">
            <Icon name={att.kind === "image" ? "image" : "files"} size={14} />
          </span>
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="truncate">{att.name}</span>
            <span className="small weak">
              {att.meta} · {relativeTime(att.createdAt)}
            </span>
          </div>
          <button className="icon-btn sm" title="Download" aria-label={`Download ${att.name}`} onClick={() => download(att)}>
            <Icon name="download" size={13} />
          </button>
          {editable && (
            <button
              className="icon-btn sm"
              title="Remove"
              aria-label={`Remove ${att.name}`}
              onClick={() => dispatch({ type: "task/update", id: task.id, patch: { attachments: task.attachments.filter((a) => a.id !== att.id) } })}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ======================================================= AI run review */
export function AgentRunReview({ taskId }: { taskId: ID }) {
  const { state, dispatch, userById, canEdit, toast } = useApp();
  const runs = state.agentRuns.filter((r) => r.taskId === taskId && (r.status === "review" || (r.status === "done" && (r.changes?.length ?? 0) > 0)));
  const run = runs[0];
  if (!run) return null;
  const agent = userById(run.teammateId);
  const editable = canEdit(taskId);
  const flaggedBefore = !!run.flagged && run.cursor === 0;
  return (
    <section className={`run-review ${run.status}`} aria-label="AI teammate changes">
      <div className="row" style={{ gap: 8 }}>
        <Avatar user={agent} size={22} />
        <div className="col grow" style={{ minWidth: 0 }}>
          <b className="small">
            {flaggedBefore
              ? `${agent?.name} paused before starting`
              : run.status === "review"
                ? `${agent?.name} finished — review ${run.changes?.length ?? 0} change${run.changes?.length === 1 ? "" : "s"}`
                : `${agent?.name} changed ${run.changes?.length} thing${run.changes?.length === 1 ? "" : "s"}`}
          </b>
          {run.flagged && <span className="small run-flag">{run.flagged}</span>}
        </div>
      </div>
      {!flaggedBefore && (
        <ul className="run-changes">
          {(run.changes ?? []).map((c, i) => (
            <li key={i}>
              <Icon name={c.kind === "comment" ? "comment" : c.kind === "subtask" ? "subtask" : c.kind === "complete" ? "check" : "settings"} size={12} />
              {c.summary}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="row" style={{ gap: 8 }}>
          {run.status === "review" && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                dispatch({ type: "agent/runApprove", runId: run.id });
                toast(flaggedBefore ? `${agent?.name} will continue` : "Changes accepted");
              }}
            >
              <Icon name="check" size={13} /> {flaggedBefore ? "Let it continue" : "Accept changes"}
            </button>
          )}
          {!flaggedBefore && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                dispatch({ type: "agent/runRevert", runId: run.id });
                toast("Reverted everything the AI teammate did");
              }}
            >
              <Icon name="refresh" size={13} /> Revert all
            </button>
          )}
          {flaggedBefore && (
            <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "agent/runCancel", runId: run.id })}>
              Cancel run
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ========================================================= templates */
export function TemplatesChip({ projectId }: { projectId: ID }) {
  const { state, dispatch, can, toast } = useApp();
  const pop = usePopover();
  const templates = state.taskTemplates.filter((t) => t.projectId === projectId);
  if (!can("task:create", projectId)) return null;
  return (
    <>
      <button className="chip" onClick={(e) => pop.openAt(e.currentTarget)}>
        <Icon name="copy" size={12} /> Templates
        {templates.length > 0 && <span className="small weak">{templates.length}</span>}
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={300} align="end">
          <div className="small weak" style={{ padding: "4px 8px" }}>
            New task from a template
          </div>
          {templates.length === 0 && (
            <div className="small weak" style={{ padding: "6px 8px" }}>
              No templates yet — open a task and choose “Save as template”.
            </div>
          )}
          {templates.map((t) => (
            <div key={t.id} className="row" style={{ gap: 4 }}>
              <button
                className="menu-item grow"
                onClick={() => {
                  dispatch({ type: "task/fromTemplate", templateId: t.id });
                  toast(`Created “${t.taskName || t.name}” with ${t.subtasks.length} subtask${t.subtasks.length === 1 ? "" : "s"}`);
                  pop.close();
                }}
              >
                <Icon name="copy" size={13} />
                <span className="col" style={{ alignItems: "flex-start" }}>
                  <span>{t.name}</span>
                  <span className="small weak">{t.subtasks.length} subtasks{t.priority ? ` · ${t.priority}` : ""}</span>
                </span>
              </button>
              {can("task:edit", projectId) && (
                <button className="icon-btn sm" aria-label={`Delete template ${t.name}`} onClick={() => dispatch({ type: "taskTemplate/delete", id: t.id })}>
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}
