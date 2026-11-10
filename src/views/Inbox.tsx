import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { ID } from "../core/types";
import { inboxItems, unreadCount } from "../core/selectors";
import { relativeTime } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, EmptyState, MenuItem, Popover, usePopover, dayLabel } from "../ui/primitives";

export function InboxView({ onOpenTask }: { onOpenTask: (id: ID) => void }) {
  const { state, dispatch, userById } = useApp();
  const [tab, setTab] = useState<"inbox" | "archive">("inbox");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [filter, setFilter] = useState<"all" | "assigned" | "mentions" | "comments">("all");
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const filterPop = usePopover();

  const items = useMemo(() => {
    let list = inboxItems(state);
    if (onlyUnread) list = list.filter((i) => !i.read);
    if (filter === "assigned") list = list.filter((i) => i.type === "assigned");
    if (filter === "mentions") list = list.filter((i) => i.type === "mention");
    if (filter === "comments") list = list.filter((i) => i.type === "comment");
    return list;
  }, [state, onlyUnread, filter]);

  const visible = tab === "inbox" ? items.filter((i) => !archived.has(i.id)) : items.filter((i) => archived.has(i.id));

  const grouped = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const item of visible) {
      const day = item.createdAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [visible]);

  const unread = unreadCount(state);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="inbox" size={22} /> Inbox
            {unread > 0 && (
              <span className="side-badge" style={{ marginLeft: 4 }}>
                {unread}
              </span>
            )}
          </h1>
          <div className="page-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => dispatch({ type: "notification/readAll" })}
            >
              <Icon name="check" size={13} /> Mark all read
            </button>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ padding: "8px 24px 0" }}>
        <button
          className={`tab${tab === "inbox" ? " active" : ""}`}
          onClick={() => setTab("inbox")}
        >
          Inbox
        </button>
        <button
          className={`tab${tab === "archive" ? " active" : ""}`}
          onClick={() => setTab("archive")}
        >
          Archive
        </button>
      </div>

      <div className="inbox-toolbar">
        <button
          className={`chip${onlyUnread ? " active" : ""}`}
          onClick={() => setOnlyUnread((v) => !v)}
        >
          <Icon name="eye" size={12} /> Only unread
        </button>
        <button className="chip" onClick={(e) => filterPop.openAt(e.currentTarget)}>
          <Icon name="filter" size={12} />
          {filter === "all"
            ? "All activity"
            : filter === "assigned"
              ? "Assigned to me"
              : filter === "mentions"
                ? "Mentions"
                : "Comments"}
        </button>
        <div style={{ flex: 1 }} />
        <span className="small weak">{visible.length} notifications</span>
      </div>

      <div className="page-scroll">
        {grouped.length === 0 && (
          <EmptyState
            icon="inbox"
            title={tab === "inbox" ? "You're all caught up" : "Nothing archived yet"}
            description="Notifications about tasks you follow will appear here."
          />
        )}
        {grouped.map(([day, list]) => (
          <div key={day}>
            <div
              className="row"
              style={{
                padding: "10px 24px 6px",
                position: "sticky",
                top: 0,
                background: "var(--color-background-weak)",
                zIndex: 2,
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 500, fontSize: 13 }}>{dayLabel(day)}</span>
              <span className="small weak">{list.length}</span>
            </div>
            {list.map((item) => {
              const actor = userById(item.actorId);
              const task = item.taskId ? state.tasks.find((t) => t.id === item.taskId) : null;
              return (
                <div
                  className={`inbox-row${!item.read ? " unread" : ""}`}
                  key={item.id}
                  onClick={() => {
                    if (item.kind === "notification") dispatch({ type: "notification/read", id: item.id });
                    if (task) onOpenTask(task.id);
                  }}
                >
                  <Avatar user={actor} size={32} />
                  <div className="inbox-text">
                    <div>
                      <b>{actor?.name ?? "Someone"}</b> {item.text}
                    </div>
                    {task && (
                      <div className="inbox-meta">
                        <span className="row" style={{ gap: 6 }}>
                          <Icon name="check-circle" size={11} />
                          {task.name}
                          {task.dueDate && (
                            <>
                              <span>·</span>
                              <Icon name="calendar" size={11} />
                              {task.dueDate}
                            </>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="small weak" style={{ whiteSpace: "nowrap" }}>
                    {relativeTime(item.createdAt)}
                  </span>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      className="icon-btn sm"
                      title="Archive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchived((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                    >
                      <Icon name="archive" size={13} />
                    </button>
                    <button
                      className="icon-btn sm"
                      title="Mark read"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.kind === "notification")
                          dispatch({ type: "notification/read", id: item.id });
                      }}
                    >
                      <Icon name="check" size={13} />
                    </button>
                  </div>
                  {!item.read && <span className="unread-dot" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {filterPop.open && filterPop.anchor && (
        <Popover anchor={filterPop.anchor} onClose={filterPop.close} width={220}>
          {(
            [
              ["all", "All activity"],
              ["assigned", "Assigned to me"],
              ["mentions", "Mentions"],
              ["comments", "Comments"],
            ] as const
          ).map(([key, label]) => (
            <MenuItem
              key={key}
              checked={filter === key}
              onClick={() => {
                setFilter(key);
                filterPop.close();
              }}
            >
              {label}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}
