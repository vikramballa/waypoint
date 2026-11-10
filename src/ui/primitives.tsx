import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { FieldDef, FieldValue, SwatchName, Task, User } from "../core/types";
import { useApp } from "../core/store";
import {
  SWATCHES,
  SWATCH_LABEL,
  addDays,
  clamp,
  formatFullDate,
  fromISO,
  monthName,
  startOfMonth,
  startOfWeek,
  toISO,
  todayISO,
} from "../core/utils";
import { Icon } from "./icons";

/* ------------------------------------------------------ task completion */

const APPROVAL_LABEL = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  "changes-requested": "Changes requested",
} as const;

export function ApprovalMark({ task, size = 16 }: { task: Task; size?: number }) {
  const status = task.approvalStatus ?? "pending";
  const icon =
    status === "approved" ? "check" : status === "rejected" ? "close" : status === "changes-requested" ? "refresh" : "approval";
  return (
    <span
      className={`approval-mark approval-${status}`}
      role="img"
      aria-label={APPROVAL_LABEL[status]}
      title={`${APPROVAL_LABEL[status]} — only the assignee can decide`}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={Math.round(size * 0.68)} strokeWidth={2.2} />
    </span>
  );
}

export const approvalLabel = (task: Task) => APPROVAL_LABEL[task.approvalStatus ?? "pending"];

/**
 * The completion control for a task, everywhere a task is listed: a
 * permission-aware checkbox, or the approval state for approval tasks (those
 * complete through a decision, never a tick).
 */
export function TaskCheckbox({ task, size = 16, undoToast }: { task: Task; size?: number; undoToast?: boolean }) {
  const { dispatch, canEdit, toast, undo } = useApp();
  if (task.approvalStatus) return <ApprovalMark task={task} size={size} />;
  return (
    <Checkbox
      checked={task.completed}
      size={size}
      disabled={!canEdit(task.id)}
      onChange={(next) => {
        dispatch({ type: "task/toggleComplete", id: task.id, value: next });
        if (next && undoToast) toast("Task completed", "Undo", undo);
      }}
    />
  );
}

/* --------------------------------------------------------------- avatar */
export function Avatar({
  user,
  size = 24,
  ring,
  title,
}: {
  user?: User | null;
  size?: number;
  ring?: boolean;
  title?: string;
}) {
  if (!user) {
    return (
      <span
        className={`avatar${ring ? " avatar-ring" : ""}`}
        title={title ?? "Unassigned"}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(9, Math.round(size * 0.4)),
          background: "var(--swatch-none-bg)",
          color: "var(--swatch-none-fg)",
        }}
      >
        <Icon name="person" size={Math.round(size * 0.55)} />
      </span>
    );
  }
  if (user.isAgent) {
    return (
      <span
        className={`avatar avatar-agent${ring ? " avatar-ring" : ""}`}
        title={title ?? `${user.name} · AI teammate`}
        style={{ width: size, height: size }}
      >
        <Icon name="sparkle" size={Math.max(10, Math.round(size * 0.58))} />
      </span>
    );
  }
  return (
    <span
      className={`avatar${ring ? " avatar-ring" : ""}`}
      title={title ?? user.name}
      style={{
        width: size,
        height: size,
        fontSize: size < 22 ? Math.max(8, Math.round(size * 0.4)) : Math.round(size * 0.4),
        letterSpacing: size < 22 ? "-0.04em" : undefined,
        background: `var(--swatch-${user.color}-bg)`,
        color: `var(--swatch-${user.color}-fg)`,
      }}
    >
      {user.initials}
    </span>
  );
}

export function AvatarStack({
  users,
  size = 24,
  max = 4,
}: {
  users: (User | undefined)[];
  size?: number;
  max?: number;
}) {
  const shown = users.filter(Boolean).slice(0, max) as User[];
  const extra = users.length - shown.length;
  return (
    <span
      className="avatar-stack"
      style={{ "--stack-overlap": `${-Math.max(2, Math.round(size * 0.14))}px` } as React.CSSProperties}
    >
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} ring />
      ))}
      {extra > 0 && (
        <span
          className="avatar avatar-ring"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.36),
            background: "var(--color-background-strong)",
            color: "var(--color-text-weak)",
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- checkbox */
export function Checkbox({
  checked,
  onChange,
  square,
  size = 16,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  square?: boolean;
  size?: number;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`checkbox${checked ? " checked" : ""}${square ? " square" : ""}`}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      aria-label={label ?? (checked ? "Mark incomplete" : "Mark complete")}
      style={{ width: size, height: size, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
    >
      <Icon name="check" size={Math.round(size * 0.7)} strokeWidth={2.5} />
    </button>
  );
}

/* -------------------------------------------------------------- popover */
export interface PopoverAnchor {
  rect: DOMRect;
}

export function usePopover() {
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const openAt = useCallback((target: EventTarget | Element | null) => {
    const el =
      target instanceof Element
        ? target
        : target instanceof Node
          ? (target as unknown as HTMLElement)
          : null;
    if (!el) return;
    setAnchor({ rect: el.getBoundingClientRect() });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, openAt, close, open: anchor !== null };
}

export function Popover({
  anchor,
  onClose,
  children,
  align = "start",
  width,
  offset = 4,
  placement = "bottom",
  className = "",
}: {
  anchor: PopoverAnchor;
  onClose: () => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  width?: number;
  offset?: number;
  placement?: "bottom" | "right" | "top";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: -9999,
    left: -9999,
  });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { rect } = anchor;
    const box = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + offset;
    let left =
      align === "end"
        ? rect.right - box.width
        : align === "center"
          ? rect.left + rect.width / 2 - box.width / 2
          : rect.left;
    if (placement === "right") {
      top = rect.top;
      left = rect.right + offset;
    }
    if (top + box.height > vh - 8 && rect.top - box.height - offset > 8) {
      top = rect.top - box.height - offset;
    }
    left = clamp(left, 8, Math.max(8, vw - box.width - 8));
    top = clamp(top, 8, Math.max(8, vh - box.height - 8));
    setPos({ top, left });
  }, [anchor, align, offset, placement]);

  useLayoutEffect(() => {
    measure();
  }, [measure, children]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
        return;
      }
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      role="dialog"
      style={{ top: pos.top, left: pos.left, width }}
    >
      {children}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------- menu bits */
export function MenuItem({
  icon,
  children,
  right,
  onClick,
  danger,
  checked,
  disabled,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`menu-item${danger ? " danger" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick?.();
      }}
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}
    >
      {checked !== undefined && (
        <span className="menu-check">
          {checked && <Icon name="check" size={13} strokeWidth={2.5} />}
        </span>
      )}
      {icon}
      <span>{children}</span>
      {right && <span className="right">{right}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="menu-label">{children}</div>;
}

/* ---------------------------------------------------------------- modal */
export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  wide,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal>
        <div className="modal-head">
          {icon}
          <div className="modal-title grow">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------- palette */
export function SwatchDot({ color, size = 12 }: { color?: SwatchName; size?: number }) {
  return (
    <span
      className="swatch dot"
      style={{
        width: size,
        height: size,
        background: `var(--swatch-${color ?? "none"}-bg)`,
      }}
    />
  );
}

export function ColorGrid({
  value,
  onChange,
}: {
  value: SwatchName;
  onChange: (c: SwatchName) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 24px)",
        gap: 6,
      }}
    >
      {SWATCHES.map((c) => (
        <button
          key={c}
          title={SWATCH_LABEL[c]}
          onClick={() => onChange(c)}
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            background: `var(--swatch-${c}-bg)`,
            border:
              value === c
                ? "2px solid var(--color-text)"
                : "1px solid var(--color-border)",
            display: "grid",
            placeItems: "center",
          }}
        >
          {value === c && <Icon name="check" size={12} />}
        </button>
      ))}
    </div>
  );
}

export function ColorPickerButton({
  value,
  onChange,
  label,
}: {
  value: SwatchName;
  onChange: (c: SwatchName) => void;
  label?: React.ReactNode;
}) {
  const pop = usePopover();
  return (
    <>
      <button
        className="field-hover"
        onClick={(e) => {
          e.stopPropagation();
          pop.openAt(e.currentTarget);
        }}
      >
        <SwatchDot color={value} />
        <span>{label ?? SWATCH_LABEL[value]}</span>
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220}>
          <div style={{ padding: 6 }}>
            <ColorGrid
              value={value}
              onChange={(c) => {
                onChange(c);
                pop.close();
              }}
            />
          </div>
        </Popover>
      )}
    </>
  );
}

/* ------------------------------------------------------------ date picker */
export function DatePicker({
  value,
  onChange,
  withTime,
  time,
  onTimeChange,
  allowRange,
  startValue,
  onStartChange,
  children,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  withTime?: boolean;
  time?: string | null;
  onTimeChange?: (t: string | null) => void;
  allowRange?: boolean;
  startValue?: string | null;
  onStartChange?: (iso: string | null) => void;
  children: (open: (el: Element) => void) => React.ReactNode;
}) {
  const pop = usePopover();
  const [month, setMonth] = useState(() => startOfMonth(value ?? todayISO()));
  const today = todayISO();

  useEffect(() => {
    if (value) setMonth(startOfMonth(value));
  }, [value]);

  const grid = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), 0);
    const cells: string[] = [];
    for (let i = 0; i < 42; i += 1) cells.push(addDays(first, i));
    return cells;
  }, [month]);

  const quick = [
    { label: "Today", iso: today },
    { label: "Tomorrow", iso: addDays(today, 1) },
    { label: "Next week", iso: addDays(today, 7) },
    {
      label: "Next Monday",
      iso: addDays(today, ((8 - fromISO(today).getDay()) % 7) || 7),
    },
  ];

  return (
    <>
      {children((el) => pop.openAt(el))}
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={272}>
          <div style={{ padding: 6 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <button
                className="icon-btn sm"
                onClick={() => setMonth(addDays(month, -30))}
                aria-label="Previous month"
              >
                <Icon name="chevron-left" size={14} />
              </button>
              <div style={{ flex: 1, textAlign: "center", fontWeight: 500 }}>
                {monthName(month, true)} {month.slice(0, 4)}
              </div>
              <button
                className="icon-btn sm"
                onClick={() => setMonth(addDays(month, 31))}
                aria-label="Next month"
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 2,
                fontSize: 11,
                color: "var(--color-text-weak)",
                textAlign: "center",
                marginBottom: 4,
              }}
            >
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {grid.map((iso) => {
                const inMonth = iso.slice(0, 7) === month.slice(0, 7);
                const selected = value === iso;
                const isToday = iso === today;
                return (
                  <button
                    key={iso}
                    onClick={() => {
                      onChange(iso);
                      if (allowRange && startValue) onStartChange?.(iso);
                      pop.close();
                    }}
                    style={{
                      height: 30,
                      borderRadius: 999,
                      fontSize: 12,
                      background: selected
                        ? "var(--color-primary-background-strong)"
                        : isToday
                          ? "var(--color-selected-background)"
                          : "transparent",
                      color: selected
                        ? "#fff"
                        : inMonth
                          ? "var(--color-text)"
                          : "var(--color-text-disabled)",
                      fontWeight: selected || isToday ? 500 : 400,
                    }}
                  >
                    {fromISO(iso).getDate()}
                  </button>
                );
              })}
            </div>
            <div className="menu-sep" />
            {quick.map((q) => (
              <button
                key={q.label}
                className="menu-item"
                onClick={() => {
                  onChange(q.iso);
                  pop.close();
                }}
              >
                <Icon name="calendar" size={13} />
                {q.label}
                <span className="right">{formatFullDate(q.iso).replace(/,.*/, "")}</span>
              </button>
            ))}
            {withTime && (
              <>
                <div className="menu-sep" />
                <div className="row" style={{ padding: "4px 6px" }}>
                  <Icon name="clock" size={13} />
                  <input
                    className="input"
                    style={{ height: 28 }}
                    type="time"
                    value={time ?? ""}
                    onChange={(e) => onTimeChange?.(e.target.value || null)}
                  />
                </div>
              </>
            )}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                onChange(null);
                pop.close();
              }}
            >
              <Icon name="close" size={13} />
              No due date
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/* ------------------------------------------------------------ user picker */
export function UserPicker({
  value,
  onChange,
  children,
  allowUnassigned = true,
  title = "Assign to",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  children: (open: (el: Element) => void) => React.ReactNode;
  allowUnassigned?: boolean;
  title?: string;
}) {
  const { state } = useApp();
  const pop = usePopover();
  const [q, setQ] = useState("");
  const results = state.users.filter((u) =>
    u.name.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <>
      {children((el) => pop.openAt(el))}
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={280}>
          <div style={{ padding: 4 }}>
            <div className="menu-label">{title}</div>
            <input
              className="input"
              autoFocus
              placeholder="Name or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ margin: "4px 4px 6px", width: "calc(100% - 8px)" }}
            />
            {results.map((u) => (
              <button
                key={u.id}
                className="menu-item"
                onClick={() => {
                  onChange(u.id);
                  pop.close();
                }}
              >
                <Avatar user={u} size={22} />
                <span className="grow truncate">{u.name}</span>
                {u.isAgent && <span className="ai-badge" style={{ height: 16, fontSize: 9 }}>AI</span>}
                {value === u.id && <Icon name="check" size={13} />}
              </button>
            ))}
            {allowUnassigned && (
              <>
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    onChange(null);
                    pop.close();
                  }}
                >
                  <Avatar user={null} size={22} />
                  Unassigned
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

/* ------------------------------------------------------------ field value */
export function FieldValueView({
  field,
  value,
  state,
}: {
  field: FieldDef;
  value: FieldValue;
  state: ReturnType<typeof useApp>["state"];
}) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="weak">—</span>;
  }
  switch (field.type) {
    case "select": {
      const opt = field.options.find((o) => o.id === value);
      if (!opt) return <span className="weak">—</span>;
      return (
        <span
          className="tag-pill"
          style={{
            background: `var(--swatch-${opt.color}-bg)`,
            color: `var(--swatch-${opt.color}-fg)`,
          }}
        >
          {opt.name}
        </span>
      );
    }
    case "multiSelect": {
      const ids = Array.isArray(value) ? value : [value as string];
      const opts = field.options.filter((o) => ids.includes(o.id));
      return (
        <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {opts.map((o) => (
            <span
              key={o.id}
              className="tag-pill"
              style={{
                background: `var(--swatch-${o.color}-bg)`,
                color: `var(--swatch-${o.color}-fg)`,
              }}
            >
              {o.name}
            </span>
          ))}
        </span>
      );
    }
    case "people": {
      const ids = Array.isArray(value) ? value : [value as string];
      const people = ids
        .map((id) => state.users.find((u) => u.id === id))
        .filter(Boolean) as User[];
      return (
        <span className="row" style={{ gap: 4 }}>
          {people.length > 1 ? (
            <AvatarStack users={people} size={20} />
          ) : (
            people.map((u) => (
              <span key={u.id} className="row" style={{ gap: 6 }}>
                <Avatar user={u} size={20} />
                <span>{u.name}</span>
              </span>
            ))
          )}
        </span>
      );
    }
    case "checkbox":
      return <span>{value ? "Yes" : "No"}</span>;
    case "number":
      return <span className="mono">{Number(value).toLocaleString()}</span>;
    case "date":
      return <span>{typeof value === "string" ? formatFullDate(value) : "—"}</span>;
    case "rating":
      return <span>{"★".repeat(Number(value) || 0)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

export function FieldEditor({
  field,
  value,
  onChange,
  children,
}: {
  field: FieldDef;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  children: (open: (el: Element) => void) => React.ReactNode;
}) {
  const { state } = useApp();
  const pop = usePopover();
  const close = pop.close;

  const body = () => {
    switch (field.type) {
      case "select":
      case "multiSelect":
        return (
          <div style={{ padding: 4 }}>
            {field.options.map((o) => {
              const selected =
                field.type === "multiSelect"
                  ? Array.isArray(value) && value.includes(o.id)
                  : value === o.id;
              return (
                <button
                  key={o.id}
                  className="menu-item"
                  onClick={() => {
                    if (field.type === "multiSelect") {
                      const arr = Array.isArray(value) ? [...value] : [];
                      onChange(
                        arr.includes(o.id)
                          ? arr.filter((x) => x !== o.id)
                          : [...arr, o.id]
                      );
                    } else {
                      onChange(selected ? null : o.id);
                      close();
                    }
                  }}
                >
                  <span className="menu-check">
                    {selected && <Icon name="check" size={13} />}
                  </span>
                  <span
                    className="swatch dot"
                    style={{ background: `var(--swatch-${o.color}-bg)` }}
                  />
                  {o.name}
                </button>
              );
            })}
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { onChange(null); close(); }}>
              Clear
            </button>
          </div>
        );
      case "checkbox":
        return (
          <div style={{ padding: 4 }}>
            <MenuItem checked={Boolean(value)} onClick={() => { onChange(!value); close(); }}>
              Checked
            </MenuItem>
          </div>
        );
      case "number":
      case "text":
      case "rating":
        return (
          <div style={{ padding: 8 }}>
            <input
              className="input"
              autoFocus
              type={field.type === "number" || field.type === "rating" ? "number" : "text"}
              defaultValue={value == null ? "" : String(value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const raw = (e.target as HTMLInputElement).value;
                  onChange(
                    field.type === "number" || field.type === "rating"
                      ? raw === ""
                        ? null
                        : Number(raw)
                      : raw
                  );
                  close();
                }
              }}
            />
            <div className="small weak" style={{ marginTop: 6 }}>
              Press Enter to save
            </div>
          </div>
        );
      case "date":
        return (
          <div style={{ padding: 6 }}>
            <input
              className="input"
              type="date"
              defaultValue={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
        );
      case "people":
        return (
          <div style={{ padding: 4, maxHeight: 240, overflowY: "auto" }}>
            {state.users.map((u) => {
              const arr = Array.isArray(value) ? value : [];
              const selected = arr.includes(u.id);
              return (
                <button
                  key={u.id}
                  className="menu-item"
                  onClick={() =>
                    onChange(
                      selected ? arr.filter((x) => x !== u.id) : [...arr, u.id]
                    )
                  }
                >
                  <span className="menu-check">
                    {selected && <Icon name="check" size={13} />}
                  </span>
                  <Avatar user={u} size={20} />
                  {u.name}
                </button>
              );
            })}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {children((el) => pop.openAt(el))}
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={240}>
          {body()}
        </Popover>
      )}
    </>
  );
}

/* --------------------------------------------------------------- toasts */
export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.message}</span>
          {t.actionLabel && (
            <button
              onClick={() => {
                t.onAction?.();
                dismissToast(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------- empty */
export function EmptyState({
  icon = "list",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art">
        <Icon name={icon} size={40} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/* -------------------------------------------------------------- misc */
export function PriorityPill({ priority }: { priority: Task["priority"] }) {
  if (!priority) return null;
  const color =
    priority === "high" ? "red" : priority === "medium" ? "yellow" : "blue";
  return (
    <span
      className="tag-pill"
      style={{
        background: `var(--swatch-${color}-bg)`,
        color: `var(--swatch-${color}-fg)`,
      }}
    >
      {priority === "high" ? "High" : priority === "medium" ? "Medium" : "Low"}
    </span>
  );
}

export function TagPill({ name, color }: { name: string; color: SwatchName }) {
  return (
    <span className="tag-pill" style={{ background: `var(--swatch-${color}-bg)`, color: `var(--swatch-${color}-fg)` }}>
      {name}
    </span>
  );
}

export function ConfirmButton({
  label,
  confirmLabel = "Confirm",
  onConfirm,
  className = "menu-item danger",
  icon,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  icon?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      onClick={() => {
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

export function ProgressBar({ percent, color }: { percent: number; color?: string }) {
  return (
    <div className="bar-track">
      <div
        className="bar-fill"
        style={{ width: `${clamp(percent, 0, 100)}%`, background: color }}
      />
    </div>
  );
}

export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside, active]);
  return ref;
}

export function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  onKeyDown,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      rows={1}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function dayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  return formatFullDate(iso);
}

export { toISO };
