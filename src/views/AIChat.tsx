import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../core/store";
import type { ChatAction, ChatMessage, ID } from "../core/types";
import { navigate } from "../core/router";
import { draftStatusUpdate } from "../core/ai";
import { relativeTime } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, MenuItem, Popover, usePopover } from "../ui/primitives";

function dedupeCitations<T extends { kind: string; id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function RichText({ text }: { text: string }) {
  const blocks = text.split("\n");
  return (
    <>
      {blocks.map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <div key={i} style={{ minHeight: line ? undefined : 8 }}>
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <b key={j}>{part.slice(2, -2)}</b>
              ) : (
                <span key={j}>{part}</span>
              )
            )}
          </div>
        );
      })}
    </>
  );
}

function useChatActions(onOpenTask?: (id: ID) => void) {
  const { state, dispatch, toast } = useApp();
  return (action: ChatAction) => {
    switch (action.kind) {
      case "create-task": {
        dispatch({
          type: "task/create",
          patch: {
            name: action.text ?? "New task",
            projectId: action.projectId ?? null,
            dueDate: action.dueDate ?? null,
            assigneeId: state.currentUserId,
          },
        });
        toast("Task created from AI chat");
        break;
      }
      case "create-project":
        dispatch({ type: "project/create", project: { name: action.text ?? "New project" } });
        toast("Project created");
        break;
      case "open-project":
        if (action.projectId) navigate(`/project/${action.projectId}/list`);
        else if (action.id === "mine") navigate("/my-tasks");
        else if (action.id === "late") navigate("/my-tasks");
        else navigate("/reporting");
        break;
      case "open-task":
        if (action.taskId) {
          if (onOpenTask) onOpenTask(action.taskId);
          else navigate(`/task/${action.taskId}`);
        }
        break;
      case "complete-task":
        if (action.taskId) {
          dispatch({ type: "task/toggleComplete", id: action.taskId, value: true });
          toast("Task completed");
        }
        break;
      case "draft-status": {
        if (!action.projectId) break;
        const draft = draftStatusUpdate(state, action.projectId);
        dispatch({
          type: "status/create",
          projectId: action.projectId,
          title: draft.title,
          text: draft.text,
          state: draft.state,
        });
        toast("Status update posted");
        break;
      }
    }
  };
}

const SUGGESTIONS = [
  "How is the Atlas launch looking?",
  "What is overdue?",
  "What should I work on today?",
  "Who is overloaded?",
  "Draft a status update for Website Redesign",
  "Create a task to review the launch email by Friday in Atlas for Alex",
];

function MessageRow({
  message,
  onOpenTask,
}: {
  message: ChatMessage;
  onOpenTask?: (id: ID) => void;
}) {
  const { state, user } = useApp();
  const runAction = useChatActions(onOpenTask);
  const isUser = message.role === "user";
  return (
    <div className={`chat-msg${isUser ? " user" : ""}`}>
      {isUser ? (
        <Avatar user={user} size={28} />
      ) : (
        <span className="avatar avatar-agent" style={{ width: 28, height: 28 }}>
          <Icon name="sparkle" size={15} />
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="chat-bubble">
          <RichText text={message.text} />
        </div>
        {message.citations.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {dedupeCitations(message.citations).slice(0, 5).map((c) => (
              <button
                key={`${c.kind}-${c.id}`}
                className="citation"
                onClick={() => {
                  if (c.kind === "task") {
                    if (onOpenTask) onOpenTask(c.id);
                    else navigate(`/task/${c.id}`);
                  }
                  if (c.kind === "project") navigate(`/project/${c.id}/list`);
                  if (c.kind === "goal") navigate("/goals");
                }}
              >
                <Icon
                  name={c.kind === "task" ? "check-circle" : c.kind === "project" ? "board" : "target"}
                  size={10}
                />
                {c.label}
              </button>
            ))}
          </div>
        )}
        {message.actions.length > 0 && (
          <div className="chat-actions">
            {message.actions.map((action) => (
              <button
                key={action.id}
                className="btn btn-secondary btn-sm"
                onClick={() => runAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div className="small weak" style={{ marginTop: 4, fontSize: 11 }}>
          {isUser ? "" : "AI teammate · "}
          {relativeTime(message.createdAt)}
          {isUser ? "" : " · review before acting"}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- full page */
export function AIChatView({ onOpenTask }: { onOpenTask: (id: ID) => void }) {
  const { state, dispatch } = useApp();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const threadId = state.activeThreadId ?? state.chatThreads[0]?.id ?? null;
  const messages = useMemo(
    () => state.chatMessages.filter((m) => m.threadId === threadId),
    [state.chatMessages, threadId]
  );
  const threadPop = usePopover();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const send = (text?: string) => {
    const value = (text ?? draft).trim();
    if (!value) return;
    dispatch({ type: "chat/send", text: value });
    setDraft("");
  };

  return (
    <div className="page">
      <div className="chat-shell">
        <div className="chat-rail">
          <div className="row" style={{ padding: "8px 6px 10px" }}>
            <span className="row" style={{ gap: 6, fontWeight: 500 }}>
              <span className="avatar avatar-agent" style={{ width: 20, height: 20 }}>
                <Icon name="sparkle" size={11} />
              </span>
              AI chat
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="icon-btn sm"
              title="New chat"
              onClick={() => dispatch({ type: "chat/newThread" })}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          {state.chatThreads.map((thread) => (
            <button
              key={thread.id}
              className={`side-item${thread.id === threadId ? " active" : ""}`}
              onClick={() => dispatch({ type: "chat/selectThread", id: thread.id })}
            >
              <span className="side-icon">
                <Icon name="messages" size={14} />
              </span>
              <span className="side-label">{thread.title}</span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="side-item" onClick={() => navigate("/ai-teammates")}>
            <span className="side-icon">
              <Icon name="sparkle" size={14} />
            </span>
            <span className="side-label">AI teammates</span>
          </button>
        </div>

        <div className="chat-stream">
          <div className="viewbar" style={{ paddingLeft: 20 }}>
            <span className="row" style={{ gap: 8, fontWeight: 500 }}>
              {state.chatThreads.find((t) => t.id === threadId)?.title ?? "New chat"}
            </span>
            <span className="ai-badge">
              <Icon name="sparkle" size={10} /> grounded in this workspace
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="chip"
              onClick={(e) => threadPop.openAt(e.currentTarget)}
              title="What can it do?"
            >
              <Icon name="help" size={12} /> What can it do?
            </button>
          </div>

          <div className="chat-scroll">
            {messages.length === 0 && (
              <div className="empty" style={{ padding: 24 }}>
                <div className="empty-art" style={{ background: "linear-gradient(135deg,#efe9ff,#ffe9f1)" }}>
                  <Icon name="sparkle" size={36} />
                </div>
                <h3>Ask about your work</h3>
                <p>
                  Answers are computed from this workspace — projects, tasks,
                  dependencies, goals and meeting notes — and every answer cites its
                  sources.
                </p>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {SUGGESTIONS.slice(0, 3).map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} onOpenTask={onOpenTask} />
            ))}
            <div ref={endRef} />
          </div>

          <div className="chat-composer">
            <div className="input-wrap">
              <textarea
                placeholder="Ask about projects, tasks, risks, goals — or create work from a sentence…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                {SUGGESTIONS.slice(3).map((s) => (
                  <button key={s} className="chip" style={{ height: 22 }} onClick={() => send(s)}>
                    {s.length > 34 ? `${s.slice(0, 34)}…` : s}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="btn btn-primary"
              disabled={!draft.trim()}
              onClick={() => send()}
              style={{ height: 40 }}
            >
              <Icon name="paper-plane" size={14} /> Send
            </button>
          </div>
        </div>
      </div>

      {threadPop.open && threadPop.anchor && (
        <Popover anchor={threadPop.anchor} onClose={threadPop.close} width={300} align="end">
          {SUGGESTIONS.map((s) => (
            <MenuItem
              key={s}
              icon={<Icon name="sparkle" size={13} />}
              onClick={() => {
                send(s);
                threadPop.close();
              }}
            >
              {s}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */
export function AskAIDrawer({
  onClose,
  onOpenTask,
}: {
  onClose: () => void;
  onOpenTask: (id: ID) => void;
}) {
  const { state, dispatch } = useApp();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const threadId = state.activeThreadId;
  const messages = state.chatMessages.filter((m) => m.threadId === threadId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <aside className="pane" style={{ width: 420, minWidth: 380 }}>
      <div className="pane-header">
        <span className="avatar avatar-agent" style={{ width: 22, height: 22 }}>
          <Icon name="sparkle" size={12} />
        </span>
        <div className="crumbs" style={{ color: "var(--color-text)" }}>
          AI chat
        </div>
        <button className="icon-btn" title="Open full page" onClick={() => navigate("/chat")}>
          <Icon name="expand" size={14} />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close AI chat">
          <Icon name="close" />
        </button>
      </div>
      <div className="chat-scroll" style={{ padding: 16 }}>
        {messages.length === 0 && (
          <div className="col" style={{ gap: 10 }}>
            <span className="small weak">
              Ask about your work. Every answer cites the tasks and projects it used.
            </span>
            {SUGGESTIONS.slice(0, 4).map((s) => (
              <button
                key={s}
                className="chip"
                style={{ height: "auto", padding: "8px 10px", whiteSpace: "normal" }}
                onClick={() => dispatch({ type: "chat/send", text: s })}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} onOpenTask={onOpenTask} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-composer" style={{ padding: 12 }}>
        <div className="input-wrap">
          <textarea
            autoFocus
            placeholder="Ask Waypoint AI…"
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) {
                  dispatch({ type: "chat/send", text: draft.trim() });
                  setDraft("");
                }
              }
            }}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={!draft.trim()}
          onClick={() => {
            if (!draft.trim()) return;
            dispatch({ type: "chat/send", text: draft.trim() });
            setDraft("");
          }}
        >
          <Icon name="paper-plane" size={13} />
        </button>
      </div>
    </aside>
  );
}
