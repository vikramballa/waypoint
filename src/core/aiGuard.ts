/**
 * Guardrails for AI teammates.
 *
 * The built-in engine is deterministic and never executes instructions found
 * in task text — but the moment a hosted model is connected, task names,
 * notes and comments (some written by guests) become an injection channel.
 * These guards are in place now so that swap is safe:
 *
 *  - `detectInjection` flags text that tries to instruct the model; flagged
 *    runs pause for a human before doing anything.
 *  - `untrusted` wraps workspace text for a prompt so it is clearly data.
 *  - `AGENT_TOOL_ALLOWLIST` is the complete set of things an agent run may do;
 *    everything else (deleting, sharing, changing roles…) is out of reach.
 */
import type { AppState, Task } from "./types";

const PATTERNS: [RegExp, string][] = [
  [/\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|guidelines)\b/i, "asks the AI to ignore its instructions"],
  [/\b(system|developer)\s+prompt\b/i, "references the system prompt"],
  [/\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|owner|root|developer|system)\b/i, "tries to change the AI's role"],
  [/\b(reveal|print|show|leak|send)\b[^.\n]{0,30}\b(secrets?|passwords?|tokens?|api\s*keys?|credentials)\b/i, "asks for secrets"],
  [/\b(delete|remove|wipe|archive)\s+(all|every|each)\s+(tasks?|projects?|comments?|users?)\b/i, "asks for bulk destructive changes"],
  [/\b(make|grant|give)\b[^.\n]{0,20}\b(me|us|them)\b[^.\n]{0,20}\b(admin|owner|access)\b/i, "asks for elevated access"],
  [/\b(curl|wget|fetch|post)\s+https?:\/\//i, "tries to reach an external URL"],
  [/\bjailbreak\b|\bDAN\b mode/i, "contains a jailbreak phrase"],
];

export interface InjectionFinding {
  reason: string;
  excerpt: string;
}

export function detectInjection(text: string): InjectionFinding | null {
  for (const [re, reason] of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const at = Math.max(0, (m.index ?? 0) - 20);
      return { reason, excerpt: text.slice(at, at + 90).trim() };
    }
  }
  return null;
}

/** Scan everything an agent would read for a task: name, notes, comments. */
export function scanTaskForInjection(state: AppState, task: Task): InjectionFinding | null {
  const texts = [task.name, task.notes, ...state.comments.filter((c) => c.taskId === task.id).map((c) => c.text)];
  for (const t of texts) {
    const hit = t ? detectInjection(t) : null;
    if (hit) return hit;
  }
  return null;
}

/** Quote workspace text as inert data for a model prompt. */
export function untrusted(label: string, text: string): string {
  const safe = text.replace(/<\/?untrusted[^>]*>/gi, "");
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}

/** Everything an agent run is allowed to do. Nothing else is reachable. */
export const AGENT_TOOL_ALLOWLIST = ["read-task", "create-subtask", "comment", "set-estimate", "complete-own-subtasks"] as const;
