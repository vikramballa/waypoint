import { useEffect, useMemo } from "react";
import { useApp } from "../core/store";

/**
 * Drives queued agent runs one step at a time so a task assigned to an AI
 * teammate visibly progresses (plan → subtasks → comment → done) instead of
 * completing instantly.
 *
 * The timers are keyed on the run id + cursor (not on the array identity), so
 * unrelated state changes — typing, navigating — do not keep resetting them.
 */
export function AgentRunner() {
  const { state, dispatch } = useApp();

  const next = useMemo(() => {
    for (const r of state.agentRuns) {
      if (r.status !== "running" && r.status !== "queued") continue;
      if (!r.taskId) return r;
      const task = state.tasks.find((t) => t.id === r.taskId);
      if (task && task.assigneeId === r.teammateId) return r;
    }
    return null;
  }, [state.agentRuns, state.tasks]);
  const runKey = next ? `${next.id}:${next.cursor}` : null;

  useEffect(() => {
    if (!next) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "agent/runAdvance", runId: next.id });
    }, 2200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, dispatch]);

  const session = state.agentSessions.find((x) => x.status === "running");
  const sessionKey = session
    ? `${session.id}:${session.steps.filter((s) => s.at).length}`
    : null;

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "session/advance", id: session.id });
    }, 2600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, dispatch]);

  return null;
}
