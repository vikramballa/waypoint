import { lazy, type ComponentType } from "react";

type Loader = () => Promise<unknown>;
const loaders = new Set<Loader>();

/**
 * `React.lazy` for named exports, keeping the component's prop types.
 * Remembers the loader so `prefetchViews` can warm it.
 */
export function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K): M[K] {
  loaders.add(load);
  return lazy(async () => {
    const mod = await load();
    return { default: mod[name] as unknown as ComponentType<unknown> };
  }) as unknown as M[K];
}

/**
 * Warm every route chunk once the first screen has painted, so navigation
 * after load is instant while initial load stays small.
 */
export function prefetchViews(): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const run = () => loaders.forEach((load) => void load().catch(() => undefined));
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 3000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, 1200);
  return () => window.clearTimeout(id);
}
