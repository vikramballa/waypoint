import { describe, expect, it } from "vitest";
import { createSeedState } from "./seed";
import { reducer } from "./store";
import { scopeStateForViewer } from "./rbac";
import type { AppState } from "./types";

function bigWorkspace(n: number): AppState {
  const s = createSeedState();
  const base = s.tasks.filter((t) => !t.parentId);
  const tasks = Array.from({ length: n }, (_, i) => {
    const src = base[i % base.length];
    return { ...src, id: `bulk-${i}`, parentId: i % 5 === 0 && i > 0 ? `bulk-${i - 1}` : null, order: i };
  });
  return { ...s, tasks: [...s.tasks, ...tasks] };
}

describe("scales to 10k tasks", () => {
  it("scopes state for a member and a guest quickly", () => {
    const s = bigWorkspace(10_000);
    for (const userId of ["u-jordan", "u-lucas"]) {
      const viewer = { ...s, currentUserId: userId };
      scopeStateForViewer(viewer); // warm up JIT
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) scopeStateForViewer(viewer);
      const ms = (performance.now() - t0) / 5;
      console.log(`scope ${userId}: ${ms.toFixed(1)} ms / call`);
      expect(ms).toBeLessThan(60);
    }
  });

  it("deletes a project with thousands of tasks quickly", () => {
    const s = bigWorkspace(10_000);
    const t0 = performance.now();
    const next = reducer(s, { type: "project/delete", id: "p-atlas" });
    const ms = performance.now() - t0;
    console.log(`project/delete: ${ms.toFixed(1)} ms`);
    expect(next.tasks.some((t) => t.projectId === "p-atlas")).toBe(false);
    expect(ms).toBeLessThan(250);
  });
});
