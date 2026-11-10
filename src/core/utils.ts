import type { AppState, SwatchName, Task } from "./types";

/* ------------------------------------------------------------------ ids */
let counter = 0;
let seeded: { seed: string; n: number } | null = null;

function randomToken(len: number): string {
  const bytes = new Uint8Array(len);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export function uid(prefix = "id"): string {
  if (seeded) {
    seeded.n += 1;
    return `${prefix}-${seeded.seed}${seeded.n.toString(36)}`;
  }
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${randomToken(4)}`;
}

/** A fresh, unguessable seed for one action's ids. */
export const newIdSeed = () => randomToken(14);
export const ID_SEED_PATTERN = /^[a-z0-9]{10,24}$/;

/**
 * Run `fn` with deterministic ids: every `uid()` inside returns
 * `${prefix}-${seed}${n}`. The client stamps each action with a seed so the
 * optimistic local result and the server's authoritative result agree on ids.
 */
export function withIdSeed<T>(seed: string | undefined, fn: () => T): T {
  if (!seed) return fn();
  const prev = seeded;
  seeded = { seed, n: 0 };
  try {
    return fn();
  } finally {
    seeded = prev;
  }
}

/* --------------------------------------------------------------- dates */
export const DAY_MS = 86_400_000;

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso: string, n: number): string {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const max = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, max));
  return toISO(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / DAY_MS);
}

export function startOfWeek(iso: string, weekStartsOn = 0): string {
  const d = fromISO(iso);
  const delta = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - delta);
  return toISO(d);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const d = fromISO(startOfMonth(iso));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toISO(d);
}

export function isWeekend(iso: string): boolean {
  const day = fromISO(iso).getDay();
  return day === 0 || day === 6;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthName(iso: string, long = false): string {
  const m = fromISO(iso).getMonth();
  return long ? MONTHS_LONG[m] : MONTHS[m];
}

export function dowName(iso: string): string {
  return DOW[fromISO(iso).getDay()];
}

/** Compact due date: "Today", "Tomorrow", "Yesterday", "Mon", "Jan 5". */
export function formatDue(iso: string | null, reference = todayISO()): string {
  if (!iso) return "";
  const delta = diffDays(iso, reference);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  const sameYear = iso.slice(0, 4) === reference.slice(0, 4);
  if (delta > 1 && delta < 7) return dowName(iso);
  if (delta < -1 && delta > -7) return dowName(iso);
  return sameYear
    ? `${monthName(iso)} ${fromISO(iso).getDate()}`
    : `${monthName(iso)} ${fromISO(iso).getDate()}, ${iso.slice(0, 4)}`;
}

export function formatFullDate(iso: string): string {
  const d = fromISO(iso);
  return `${dowName(iso)}, ${monthName(iso, true)} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatDateTime(isoStamp: string): string {
  const d = new Date(isoStamp);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return time;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

export function relativeTime(isoStamp: string): string {
  const diff = Date.now() - new Date(isoStamp).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

export function dueState(
  iso: string | null,
  completed: boolean,
  reference = todayISO()
): "none" | "overdue" | "today" | "soon" | "later" {
  if (!iso || completed) return "none";
  const delta = diffDays(iso, reference);
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta <= 3) return "soon";
  return "later";
}

/** Working-day aware duration used by the timeline scheduler. */
export function spanDays(startISO: string, endISO: string): number {
  return Math.max(1, diffDays(endISO, startISO) + 1);
}

/* ------------------------------------------------------ ordering math */
/**
 * Fractional indexing for task/section ordering:
 * a new position is the midpoint of its neighbours, and the list is
 * periodically re-balanced when floats lose precision.
 */
export function orderBetween(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return 1000;
  if (prev == null) return (next as number) - 1000;
  if (next == null) return prev + 1000;
  if (next - prev > 0.0001) return (prev + next) / 2;
  return prev + 0.0001;
}

export function needsRebalance(orders: number[]): boolean {
  const sorted = [...orders].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (Math.abs(sorted[i] - sorted[i - 1]) < 0.000001) return true;
  }
  return false;
}

export function rebalance<T extends { order: number }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, i) => ({ ...item, order: (i + 1) * 1000 }));
}

/* --------------------------------------------------------------- misc */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

export function formatMoney(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

export function groupBy<T, K extends string | number>(
  items: T[],
  key: (item: T) => K
): Record<K, T[]> {
  return items.reduce((acc, item) => {
    const k = key(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}

export function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/* --------------------------------------------------------------- swatch */
export const SWATCHES: SwatchName[] = [
  "none",
  "aqua",
  "blue",
  "blue-green",
  "cool-gray",
  "green",
  "hot-pink",
  "indigo",
  "magenta",
  "orange",
  "pink",
  "purple",
  "red",
  "yellow",
  "yellow-green",
  "yellow-orange",
];

export const SWATCH_LABEL: Record<SwatchName, string> = {
  none: "No color",
  aqua: "Aqua",
  blue: "Blue",
  "blue-green": "Blue-green",
  "cool-gray": "Cool gray",
  green: "Green",
  "hot-pink": "Hot pink",
  indigo: "Indigo",
  magenta: "Magenta",
  orange: "Orange",
  pink: "Pink",
  purple: "Purple",
  red: "Red",
  yellow: "Yellow",
  "yellow-green": "Yellow-green",
  "yellow-orange": "Yellow-orange",
};

export function swatchBg(name: SwatchName | undefined): string {
  return `var(--swatch-${name ?? "none"}-bg)`;
}
export function swatchFg(name: SwatchName | undefined): string {
  return `var(--swatch-${name ?? "none"}-fg)`;
}

/* -------------------------------------------------------- task grouping */
export function subtasksOf(state: AppState, taskId: string): Task[] {
  return sortByOrder(state.tasks.filter((t) => t.parentId === taskId));
}

export function isBlocked(state: AppState, task: Task): boolean {
  return task.blockedByIds.some((id) => {
    const dep = state.tasks.find((t) => t.id === id);
    return dep ? !dep.completed : false;
  });
}

export function projectProgress(state: AppState, projectId: string) {
  const tasks = state.tasks.filter(
    (t) => t.projectId === projectId && !t.parentId
  );
  const done = tasks.filter((t) => t.completed).length;
  return { done, total: tasks.length, percent: pct(done, tasks.length) };
}

/* ----------------------------------------------------- search language */
export interface ParsedQuery {
  text: string;
  assignee?: string;
  due?: string;
  priority?: string;
  tag?: string;
  project?: string;
  completed?: "yes" | "no";
}

/**
 * Supports a small inline operator syntax in the search bar,
 * e.g. `launch due:today assignee:me priority:high`.
 */
export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: "" };
  const words: string[] = [];
  for (const token of raw.split(/\s+/).filter(Boolean)) {
    const m = /^(\w+):(.+)$/.exec(token);
    if (!m) {
      words.push(token);
      continue;
    }
    const [, key, value] = m;
    switch (key.toLowerCase()) {
      case "assignee":
        out.assignee = value.toLowerCase();
        break;
      case "due":
        out.due = value.toLowerCase();
        break;
      case "priority":
        out.priority = value.toLowerCase();
        break;
      case "tag":
        out.tag = value.toLowerCase();
        break;
      case "project":
        out.project = value.toLowerCase();
        break;
      case "completed":
        out.completed = value.toLowerCase() === "yes" ? "yes" : "no";
        break;
      default:
        words.push(token);
    }
  }
  out.text = words.join(" ").trim().toLowerCase();
  return out;
}

export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function matches(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

/** Cheap subsequence + prefix scorer for the command palette. */
export function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length;
  if (t.includes(q)) return 60 - t.length * 0.1;
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return -1;
    score += idx === ti ? 3 : 1;
    ti = idx + 1;
  }
  return score;
}

export function downloadFile(name: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
