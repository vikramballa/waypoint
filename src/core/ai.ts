/**
 * Waypoint AI — local engine.
 *
 * Backs `/ai-teammates`, `/ai-teammate/:id`, `/chat` and agent skills without
 * a hosted model or API key: a deterministic, workspace-grounded assistant.
 * Every answer is computed from real app state, cites the objects it used,
 * and never invents identifiers.
 */
import type {
  AgentRunStep,
  AgentSkill,
  AppState,
  ChatAction,
  Citation,
  Goal,
  ID,
  Meeting,
  Project,
  Task,
  User,
} from "./types";
import {
  addDays,
  diffDays,
  formatDue,
  pct,
  relativeTime,
  todayISO,
} from "./utils";

/* ============================================================== catalogue */
export const SKILL_CATALOG: AgentSkill[] = [
  {
    id: "sk-triage",
    name: "Request triage",
    description:
      "Reads incoming tasks, sets priority and owner, and asks for missing details.",
    category: "triage",
    icon: "filter",
    example: "Triage every task added to Product requests and assign an owner.",
  },
  {
    id: "sk-breakdown",
    name: "Work breakdown",
    description:
      "Splits a task into subtasks with sensible owners and a starting due date.",
    category: "planning",
    icon: "subtask",
    example: "Break any task labelled Launch into subtasks.",
  },
  {
    id: "sk-status",
    name: "Status writer",
    description:
      "Drafts project status updates from completed work, late tasks and blockers.",
    category: "writing",
    icon: "align",
    example: "Draft a weekly status update every Friday for Atlas.",
  },
  {
    id: "sk-risk",
    name: "Risk spotter",
    description:
      "Flags overdue tasks, unassigned work and dependency chains that will slip.",
    category: "analysis",
    icon: "warning",
    example: "Comment on any task that blocks more than two others.",
  },
  {
    id: "sk-summary",
    name: "Project summarizer",
    description:
      "Explains what a project contains, what is at risk and what is next.",
    category: "reporting",
    icon: "chart",
    example: "Summarize the Atlas launch for my stand-up.",
  },
  {
    id: "sk-meetings",
    name: "Meeting notes",
    description:
      "Turns meeting transcripts into a summary and proposed action items.",
    category: "reporting",
    icon: "messages",
    example: "Summarize the launch sync and create follow-up tasks.",
  },
  {
    id: "sk-estimate",
    name: "Effort estimation",
    description:
      "Suggests a point estimate and stage for a task from its description.",
    category: "analysis",
    icon: "chart",
    example: "Estimate effort for every new build task.",
  },
  {
    id: "sk-chase",
    name: "Follow-up chaser",
    description:
      "Nudges tasks that are stale: no movement in five days or due tomorrow.",
    category: "triage",
    icon: "paper-plane",
    example: "Remind owners the day before a task is due.",
  },
];

export const SKILL_BY_ID = new Map(SKILL_CATALOG.map((s) => [s.id, s]));

export const AGENT_AUTH_SCOPES = [
  { id: "scope-projects", label: "Read projects and tasks", required: true },
  { id: "scope-comments", label: "Comment on tasks", required: true },
  { id: "scope-create", label: "Create tasks and subtasks", required: false },
  { id: "scope-assign", label: "Change assignees and due dates", required: false },
  { id: "scope-status", label: "Post project status updates", required: false },
  { id: "scope-meetings", label: "Read meeting transcripts", required: false },
];

/* ================================================================ helpers */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick<T>(items: T[], key: string): T | undefined {
  if (!items.length) return undefined;
  return items[hash(key) % items.length];
}

export function isAgent(user?: User | null): boolean {
  return Boolean(user?.isAgent);
}

export function agentSkills(state: AppState, agent: User): AgentSkill[] {
  return (agent.skillIds ?? [])
    .map((id) => state.skills.find((s) => s.id === id) ?? SKILL_BY_ID.get(id))
    .filter(Boolean) as AgentSkill[];
}

export function agentProjects(state: AppState, agent: User): Project[] {
  return (agent.projectIds ?? [])
    .map((id) => state.projects.find((p) => p.id === id))
    .filter(Boolean) as Project[];
}

/* =========================================================== project facts */
export interface ProjectFacts {
  project: Project;
  total: number;
  done: number;
  open: number;
  overdue: Task[];
  unassigned: Task[];
  blocked: Task[];
  dueThisWeek: Task[];
  nextMilestone?: Task;
  lead?: User;
  percent: number;
}

export function projectFacts(state: AppState, projectId: ID): ProjectFacts | null {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const tasks = state.tasks.filter((t) => t.projectId === projectId && !t.parentId);
  const done = tasks.filter((t) => t.completed);
  const open = tasks.filter((t) => !t.completed);
  const today = todayISO();
  const blocked = open.filter((t) =>
    t.blockedByIds.some((id) => !state.tasks.find((x) => x.id === id)?.completed)
  );
  return {
    project,
    total: tasks.length,
    done: done.length,
    open: open.length,
    overdue: open.filter((t) => t.dueDate && t.dueDate < today),
    unassigned: open.filter((t) => !t.assigneeId),
    blocked,
    dueThisWeek: open.filter(
      (t) => t.dueDate && diffDays(t.dueDate, today) >= 0 && diffDays(t.dueDate, today) <= 7
    ),
    nextMilestone: open
      .filter((t) => t.milestone || (t.dueDate && diffDays(t.dueDate, today) >= 0))
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0],
    lead: state.users.find((u) => u.id === project.ownerId),
    percent: pct(done.length, tasks.length),
  };
}

export function dedupe(list: Citation[]): Citation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function projectSummary(state: AppState, projectId: ID): {
  text: string;
  citations: Citation[];
} {
  const f = projectFacts(state, projectId);
  if (!f) return { text: "I could not find that project.", citations: [] };
  const citations: Citation[] = [
    { kind: "project", id: f.project.id, label: f.project.name },
  ];
  const lines: string[] = [];
  lines.push(
    `**${f.project.name}** is ${f.percent}% complete — ${f.done} of ${f.total} tasks done, ${f.open} open.`
  );
  if (f.overdue.length) {
    const worst = [...f.overdue].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
    citations.push({ kind: "task", id: worst.id, label: worst.name });
    lines.push(
      `Risk: ${f.overdue.length} task${f.overdue.length === 1 ? " is" : "s are"} overdue, the oldest being “${worst.name}” (${formatDue(worst.dueDate)}).`
    );
  } else {
    lines.push("Nothing is overdue right now.");
  }
  if (f.blocked.length) {
    citations.push(...f.blocked.slice(0, 2).map((t) => ({ kind: "task" as const, id: t.id, label: t.name })));
    lines.push(
      `Blocked work: ${f.blocked.map((t) => `“${t.name}”`).slice(0, 3).join(", ")}.`
    );
  }
  if (f.unassigned.length) {
    lines.push(`${f.unassigned.length} open task${f.unassigned.length === 1 ? " has" : "s have"} no assignee.`);
  }
  if (f.nextMilestone) {
    citations.push({ kind: "task", id: f.nextMilestone.id, label: f.nextMilestone.name });
    lines.push(
      `Next up: “${f.nextMilestone.name}” — ${formatDue(f.nextMilestone.dueDate)}.`
    );
  }
  return { text: lines.join("\n"), citations: dedupe(citations) };
}

export function draftStatusUpdate(
  state: AppState,
  projectId: ID
): { title: string; text: string; state: Project["status"]["state"] } {
  const f = projectFacts(state, projectId);
  if (!f) return { title: "Status update", text: "", state: "on-track" };
  const shipped = state.tasks
    .filter((t) => t.projectId === projectId && t.completed)
    .slice(0, 3)
    .map((t) => t.name);
  const next = f.nextMilestone;
  const risk = f.overdue.length > 2 || f.blocked.length > 0;
  const title = risk
    ? `${f.overdue.length} overdue item${f.overdue.length === 1 ? "" : "s"} need a decision`
    : f.percent > 60
      ? "On track for delivery"
      : "Progress steady, scope holding";
  const text = [
    `We are ${f.percent}% through the plan (${f.done}/${f.total} tasks).`,
    shipped.length ? `Recently completed: ${shipped.join("; ")}.` : "",
    next ? `Next milestone: “${next.name}” due ${formatDue(next.dueDate)}.` : "",
    f.blocked.length
      ? `Blocked: ${f.blocked.slice(0, 3).map((t) => t.name).join(", ")} — needs unblocking.`
      : "",
    f.overdue.length
      ? `${f.overdue.length} task${f.overdue.length === 1 ? " is" : "s are"} past due.`
      : "No overdue work.",
  ]
    .filter(Boolean)
    .join(" ");
  return { title, text, state: risk ? "at-risk" : "on-track" };
}

/* ============================================================ NL parsing */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseWhen(text: string): { due: string | null; cleaned: string } {
  const today = todayISO();
  const patterns: [RegExp, () => string][] = [
    [/\btoday\b/i, () => today],
    [/\btomorrow\b/i, () => addDays(today, 1)],
    [/\bnext week\b/i, () => addDays(today, 7)],
    [/\bnext month\b/i, () => addDays(today, 30)],
    [/\bin (\d{1,2}) days?\b/i, () => addDays(today, Number(RegExp.$1) || 1)],
    [/\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, () => {
      const target = WEEKDAYS.indexOf(RegExp.$1.toLowerCase());
      const now = new Date();
      const delta = (target - now.getDay() + 7) % 7 || 7;
      return addDays(today, delta);
    }],
    [/\b(mon|tue|wed|thu|fri|sat|sun)\b/i, () => {
      const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const target = map[RegExp.$1.toLowerCase()];
      const now = new Date();
      return addDays(today, (target - now.getDay() + 7) % 7 || 7);
    }],
  ];
  for (const [re, make] of patterns) {
    if (re.test(text)) {
      re.lastIndex = 0;
      re.exec(text);
      const iso = make();
      return { due: iso, cleaned: text.replace(re, " ").replace(/\s+/g, " ").trim() };
    }
  }
  return { due: null, cleaned: text };
}

export interface ParsedTaskDraft {
  name: string;
  dueDate: string | null;
  assigneeId: ID | null;
  projectId: ID | null;
  priority: Task["priority"];
  tags: ID[];
  notes: string;
  milestone: boolean;
}

/** “Create a task to rewrite pricing copy by Friday in Atlas for Alex, high priority” */
export function parseTaskDraft(state: AppState, raw: string): ParsedTaskDraft {
  let text = raw
    .replace(/^(please\s+)?(create|add|make)\s+(a\s+)?task\s*(to|for|called|named)?\s*/i, "")
    .replace(/^(remind (me|us) to|i need to|todo:?)\s*/i, "")
    .trim();

  let projectId: ID | null = null;
  for (const project of state.projects) {
    const re = new RegExp(`\\b(in|for|on)\\s+${project.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      projectId = project.id;
      text = text.replace(re, " ").trim();
      break;
    }
    const first = project.name.split(" ")[0];
    if (new RegExp(`\\b(in|for|on)\\s+${first}\\b`, "i").test(text)) {
      projectId = project.id;
      text = text.replace(new RegExp(`\\b(in|for|on)\\s+${first}\\b`, "i"), " ").trim();
      break;
    }
  }

  let assigneeId: ID | null = null;
  for (const user of state.users.filter((u) => !u.isAgent)) {
    const first = user.name.split(" ")[0];
    const re = new RegExp(`(for|to|assign(ed)? to)\\s+${first}\\b`, "i");
    if (re.test(text)) {
      assigneeId = user.id;
      text = text.replace(re, " ").trim();
      break;
    }
  }
  if (/assign(ed)? to me|for me\b/i.test(text)) {
    assigneeId = state.currentUserId;
    text = text.replace(/assign(ed)? to me|for me\b/i, " ").trim();
  }

  let priority: Task["priority"] = null;
  if (/\b(high|urgent|asap|critical)\b/i.test(text)) priority = "high";
  else if (/\blow priority\b/i.test(text)) priority = "low";
  else if (/\bmedium\b/i.test(text)) priority = "medium";
  text = text.replace(/\b(high|low|medium) priority\b/gi, " ").replace(/\b(urgent|asap)\b/gi, " ");

  const tagIds: ID[] = [];
  for (const tag of state.tags) {
    if (new RegExp(`#${tag.name}\\b`, "i").test(raw)) tagIds.push(tag.id);
  }
  const milestone = /\bmilestone\b/i.test(raw);
  text = text.replace(/#\w+/g, " ").replace(/\bmilestone\b/gi, " ").replace(/[,.]+$/g, "");

  const { due, cleaned } = parseWhen(text);
  text = cleaned.replace(/\bby\b\s*$/i, "").trim();
  text = text.replace(/\s{2,}/g, " ");

  const name = text.charAt(0).toUpperCase() + text.slice(1);
  return {
    name: name || "New task",
    dueDate: due,
    assigneeId,
    projectId,
    priority,
    tags: tagIds,
    notes: `Created from: “${raw.trim()}”`,
    milestone,
  };
}

/* =========================================================== chat answers */
export interface ChatReply {
  text: string;
  citations: Citation[];
  actions: ChatAction[];
}

function citeTask(t: Task): Citation {
  return { kind: "task", id: t.id, label: t.name };
}

function myOpenTasks(state: AppState): Task[] {
  return state.tasks.filter(
    (t) => t.assigneeId === state.currentUserId && !t.completed && !t.parentId
  );
}

export function answerQuestion(state: AppState, raw: string): ChatReply {
  const q = raw.trim().toLowerCase();
  const today = todayISO();

  /* --- explicit task creation ---------------------------------------- */
  if (/^(create|add|make)\b.*\btask\b/.test(q) || /^(remind me|todo)\b/.test(q)) {
    const draft = parseTaskDraft(state, raw);
    const project = draft.projectId
      ? state.projects.find((p) => p.id === draft.projectId)
      : null;
    const assignee = draft.assigneeId
      ? state.users.find((u) => u.id === draft.assigneeId)
      : null;
    const bits = [
      project ? `in ${project.name}` : "with no project",
      assignee ? `assigned to ${assignee.name}` : "unassigned",
      draft.dueDate ? `due ${formatDue(draft.dueDate)}` : "no due date",
      draft.priority ? `${draft.priority} priority` : "",
    ].filter(Boolean);
    return {
      text: `Ready to create **“${draft.name}”** — ${bits.join(", ")}.`,
      citations: project ? [{ kind: "project", id: project.id, label: project.name }] : [],
      actions: [
        {
          id: "create",
          label: "Create task",
          kind: "create-task",
          text: draft.name,
          projectId: draft.projectId ?? undefined,
          dueDate: draft.dueDate ?? undefined,
        },
      ],
    };
  }

  /* --- project specific ---------------------------------------------- */
  const namedProject = state.projects.find((p) =>
    q.includes(p.name.toLowerCase()) || q.includes(p.name.split(" ")[0].toLowerCase())
  );
  const namedProjectId: ID | null = namedProject?.id ?? null;
  if (namedProject && /(status|update|summar|report|brief)/.test(q)) {
    const draft = draftStatusUpdate(state, namedProject.id);
    return {
      text: `Here is a draft status for **${namedProject.name}**:\n\n**${draft.title}**\n${draft.text}`,
      citations: [{ kind: "project", id: namedProject.id, label: namedProject.name }],
      actions: [
        { id: "post", label: "Post as status update", kind: "draft-status", projectId: namedProject.id },
      ],
    };
  }
  if (namedProject) {
    const summary = projectSummary(state, namedProject.id);
    return {
      text: summary.text,
      citations: summary.citations,
      actions: [
        { id: "open", label: `Open ${namedProject.name}`, kind: "open-project", projectId: namedProject.id },
      ],
    };
  }

  /* --- overdue -------------------------------------------------------- */
  if (/(overdue|late|slipping|behind)/.test(q)) {
    const late = state.tasks.filter(
      (t) => !t.completed && !t.parentId && t.dueDate && t.dueDate < today
    );
    const mine = late.filter((t) => t.assigneeId === state.currentUserId);
    if (!late.length) {
      return { text: "Nothing is overdue across the workspace right now.", citations: [], actions: [] };
    }
    const byProject = new Map<string, Task[]>();
    for (const t of late) {
      const key = t.projectId ?? "none";
      byProject.set(key, [...(byProject.get(key) ?? []), t]);
    }
    const lines = [...byProject.entries()].map(([pid, tasks]) => {
      const project = state.projects.find((p) => p.id === pid);
      return `• ${project?.name ?? "No project"} — ${tasks.length} late (oldest “${tasks[0].name}”, ${formatDue(tasks[0].dueDate)})`;
    });
    return {
      text: `${late.length} overdue task${late.length === 1 ? "" : "s"}${mine.length ? `, ${mine.length} of them yours` : ""}:\n\n${lines.join("\n")}`,
      citations: late.slice(0, 4).map(citeTask),
      actions: [
        { id: "mine", label: "Show my tasks", kind: "open-project" },
      ],
    };
  }

  /* --- workload ------------------------------------------------------- */
  if (/(overloaded|workload|capacity|too much|bandwidth)/.test(q)) {
    const counts = state.users
      .filter((u) => !u.isAgent)
      .map((u) => ({
        user: u,
        open: state.tasks.filter(
          (t) => t.assigneeId === u.id && !t.completed && !t.parentId
        ),
      }))
      .sort((a, b) => b.open.length - a.open.length);
    const worst = counts[0];
    return {
      text: counts
        .map(
          (c) =>
            `• ${c.user.name} — ${c.open.length} open${c.open.filter((t) => t.dueDate && diffDays(t.dueDate, today) <= 7).length} due this week`
        )
        .join("\n"),
      citations: worst
        ? [
            { kind: "user", id: worst.user.id, label: worst.user.name },
            ...worst.open.slice(0, 2).map(citeTask),
          ]
        : [],
      actions: [{ id: "report", label: "Open reporting", kind: "open-project" }],
    };
  }

  /* --- what should I do ---------------------------------------------- */
  if (/(what should i|priorit|today|focus|next)/.test(q)) {
    const mine = myOpenTasks(state).sort((a, b) => {
      const rank = (t: Task) =>
        (t.dueDate && t.dueDate < today ? 0 : t.dueDate === today ? 1 : t.priority === "high" ? 2 : 3);
      return rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    });
    if (!mine.length) {
      return { text: "You have no open tasks assigned to you.", citations: [], actions: [] };
    }
    const top = mine.slice(0, 5);
    return {
      text: `Start here — ${top.length} of your ${mine.length} open tasks, ordered by urgency:\n\n${top
        .map(
          (t, i) =>
            `${i + 1}. **${t.name}** — ${t.dueDate ? formatDue(t.dueDate) : "no due date"}${
              t.priority ? ` · ${t.priority} priority` : ""
            }${t.blockedByIds.length ? " · blocked" : ""}`
        )
        .join("\n")}`,
      citations: top.map(citeTask),
      actions: top.slice(0, 3).map((t) => ({
        id: `done-${t.id}`,
        label: `Complete “${t.name.slice(0, 28)}${t.name.length > 28 ? "…" : ""}”`,
        kind: "complete-task" as const,
        taskId: t.id,
      })),
    };
  }

  /* --- blocked / dependencies ---------------------------------------- */
  if (/(blocked|depend|waiting)/.test(q)) {
    const blocked = state.tasks.filter(
      (t) =>
        !t.completed &&
        t.blockedByIds.some((id) => !state.tasks.find((x) => x.id === id)?.completed)
    );
    if (!blocked.length) {
      return { text: "No task is currently blocked by an incomplete dependency.", citations: [], actions: [] };
    }
    return {
      text: `Blocked work:\n\n${blocked
        .slice(0, 6)
        .map((t) => {
          const blocker = state.tasks.find((x) => x.id === t.blockedByIds[0]);
          return `• **${t.name}** — waiting on “${blocker?.name ?? "unknown"}”`;
        })
        .join("\n")}`,
      citations: blocked.slice(0, 4).map(citeTask),
      actions: [],
    };
  }

  /* --- counts / totals ------------------------------------------------ */
  if (/(how many|count|total number)/.test(q)) {
    const f = namedProjectId ? projectFacts(state, namedProjectId) : null;
    return {
      text: f
        ? `**${f.project.name}** has ${f.total} tasks: ${f.done} complete, ${f.open} open, ${f.overdue.length} overdue.`
        : `The workspace has ${state.projects.length} projects, ${state.tasks.filter((t) => !t.parentId).length} tasks, ${state.goals.length} goals and ${state.rules.length} automations.`,
      citations: [],
      actions: [],
    };
  }

  /* --- goals ----------------------------------------------------------- */
  if (/(goal|okr|objective)/.test(q)) {
    const goals = state.goals.filter((g) => !g.parentId);
    return {
      text: `Goal progress:\n\n${goals
        .map((g) => {
          const span = g.targetValue - g.startValue || 1;
          const percent = Math.max(
            0,
            Math.min(100, Math.round(((g.currentValue - g.startValue) / span) * 100))
          );
          return `• **${g.name}** — ${percent}% (${g.status.replace("-", " ")})`;
        })
        .join("\n")}`,
      citations: goals.slice(0, 4).map((g) => ({ kind: "goal" as const, id: g.id, label: g.name })),
      actions: [],
    };
  }

  /* --- meetings -------------------------------------------------------- */
  if (/(meeting|transcript|notes)/.test(q)) {
    const meeting = state.meetings[0];
    if (!meeting) return { text: "No meetings have been recorded yet.", citations: [], actions: [] };
    return {
      text: `Latest meeting: **${meeting.title}** (${relativeTime(meeting.startedAt)})\n\n${meeting.summary}\n\n${meeting.actionItems.length} action item${meeting.actionItems.length === 1 ? "" : "s"} extracted.`,
      citations: [{ kind: "meeting", id: meeting.id, label: meeting.title }],
      actions: [],
    };
  }

  /* --- search fallback -------------------------------------------------- */
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const scored = state.tasks
    .filter((t) => !t.parentId)
    .map((t) => {
      const hay = `${t.name} ${t.notes}`.toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      return { task: t, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length) {
    return {
      text: `I found ${scored.length} matching task${scored.length === 1 ? "" : "s"}:\n\n${scored
        .map(
          (r) =>
            `• **${r.task.name}** — ${state.projects.find((p) => p.id === r.task.projectId)?.name ?? "no project"}, ${r.task.dueDate ? formatDue(r.task.dueDate) : "no date"}`
        )
        .join("\n")}`,
      citations: scored.map((r) => citeTask(r.task)),
      actions: scored.slice(0, 3).map((r) => ({
        id: r.task.id,
        label: `Open “${r.task.name.slice(0, 30)}”`,
        kind: "open-task" as const,
        taskId: r.task.id,
      })),
    };
  }

  return {
    text: `I can answer from this workspace: project health, overdue and blocked work, workload, goal progress, meeting notes — or create a task from a sentence (“Create a task to rewrite pricing copy by Friday in Atlas for Alex”).`,
    citations: [],
    actions: [
      { id: "mine", label: "What should I work on?", kind: "open-project" },
      { id: "late", label: "What is overdue?", kind: "open-project" },
    ],
  };
}

/* ======================================================== agent planning */
export function agentPlan(
  state: AppState,
  agent: User,
  task: Task
): AgentRunStep[] {
  const skills = agentSkills(state, agent);
  const steps: AgentRunStep[] = [
    {
      id: `st-${task.id}-1`,
      kind: "ack",
      label: `${agent.name} picked up the task`,
      detail: skills.length ? `Using ${skills.map((s) => s.name).join(", ")}` : "No skills configured",
    },
  ];

  if (skills.some((s) => s.id === "sk-breakdown") || !skills.length) {
    steps.push({
      id: `st-${task.id}-2`,
      kind: "plan",
      label: "Drafted a plan",
      detail: "Split the task into three steps so progress is visible",
    });
  }
  if (skills.some((s) => s.id === "sk-risk")) {
    steps.push({
      id: `st-${task.id}-3`,
      kind: "comment",
      label: "Checked dependencies",
      detail: task.blockedByIds.length
        ? `Still blocked by ${task.blockedByIds.length} task(s)`
        : "No blocking dependencies",
    });
  }
  if (skills.some((s) => s.id === "sk-estimate")) {
    steps.push({
      id: `st-${task.id}-4`,
      kind: "field",
      label: "Estimated effort",
      detail: `Suggested ${1 + (hash(task.id) % 5)} points`,
    });
  }
  steps.push({
    id: `st-${task.id}-5`,
    kind: "comment",
    label: "Posted a progress comment",
    detail: "Reported what it did and what is left",
  });
  steps.push({
    id: `st-${task.id}-9`,
    kind: "done",
    label: "Run finished",
  });
  return steps;
}

/** Comment bodies produced by an agent run step. */
export function agentComment(
  agent: User,
  task: Task,
  step: AgentRunStep,
  state: AppState
): string {
  switch (step.kind) {
    case "ack":
      return `On it. I am taking **${task.name}**${
        task.dueDate ? ` (due ${formatDue(task.dueDate)})` : ""
      }. I will break it down, check dependencies and report back here.`;
    case "comment": {
      if (step.label === "Checked dependencies") {
        return step.detail && step.detail.startsWith("Still blocked")
          ? `Heads-up: this task is still blocked. I have not started the work; ping the owner of the blocker or clear the dependency.`
          : `Dependencies look clear — nothing upstream is open, so this can proceed.`;
      }
      const subs = state.tasks.filter((t) => t.parentId === task.id);
      return `Progress update: ${subs.length ? `${subs.filter((s) => s.completed).length}/${subs.length} subtasks done, ` : ""}${
        task.completed ? "the task is complete." : "work continues; I will update here next."
      }`;
    }
    default:
      return step.detail ?? step.label;
  }
}

/** Subtasks an agent creates when it plans work. */
export function agentSubtasks(task: Task): { name: string; order: number }[] {
  const verbs = [
    `Collect inputs for ${task.name.slice(0, 42)}`,
    `Do the core work for ${task.name.slice(0, 42)}`,
    `Review and hand off ${task.name.slice(0, 42)}`,
  ];
  return verbs.map((name, i) => ({ name, order: (i + 1) * 1000 }));
}

/* ============================================================== meetings */
export function meetingInsight(meeting: Meeting, state: AppState): string {
  const speakers = [...new Set(meeting.transcript.map((l) => l.speakerId))]
    .map((id) => state.users.find((u) => u.id === id)?.name ?? "Someone")
    .join(", ");
  return `${meeting.durationMin} min with ${speakers}. ${meeting.actionItems.length} action item${
    meeting.actionItems.length === 1 ? "" : "s"
  } detected.`;
}

/* ============================================================ formatting */
export function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

export function goalPercent(goal: Goal): number {
  const span = goal.targetValue - goal.startValue || 1;
  return Math.max(
    0,
    Math.min(100, Math.round(((goal.currentValue - goal.startValue) / span) * 100))
  );
}
