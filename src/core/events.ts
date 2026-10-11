import type { Score, Trial, Verdict } from "./types";

export type HoneEventMap = {
  "run:start": { runId: string; total: number };
  "trial:start": { trialId: string; caseId: string; targetId: string; trial: number };
  "trial:done": { trial: Trial; cached: boolean };
  "score:done": { trialId: string; score: Score };
  "stat:update": { caseId: string; targetId: string; verdict: Verdict };
  "case:stopped": { caseId: string; targetId: string; reason: "ci-width" | "max-trials" };
  "run:done": { runId: string; summary: Record<string, unknown> };
  log: { level: "debug" | "info" | "warn" | "error"; msg: string };
};

export type HoneEventName = keyof HoneEventMap;
export type Listener<K extends HoneEventName> = (payload: HoneEventMap[K]) => void;

/**
 * One typed bus shared by scheduler, executor, stats and every surface.
 * Listener errors never propagate into the emitter; they are re-emitted as `log` errors.
 */
export class HoneEvents {
  private listeners = new Map<HoneEventName, Set<Listener<HoneEventName>>>();

  on<K extends HoneEventName>(name: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as Listener<HoneEventName>);
    return () => this.off(name, fn);
  }

  once<K extends HoneEventName>(name: K, fn: Listener<K>): () => void {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends HoneEventName>(name: K, fn: Listener<K>): void {
    this.listeners.get(name)?.delete(fn as Listener<HoneEventName>);
  }

  emit<K extends HoneEventName>(name: K, payload: HoneEventMap[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    // Copy first: a listener may unsubscribe itself (once) while we iterate.
    for (const fn of Array.from(set)) {
      try {
        (fn as Listener<K>)(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (name === "log") continue; // never recurse on a failing log listener
        this.emit("log", { level: "error", msg: `listener for ${name} threw: ${msg}` });
      }
    }
  }

  listenerCount(name: HoneEventName): number {
    return this.listeners.get(name)?.size ?? 0;
  }

  /** Buffered async iteration; returning the iterator unsubscribes. */
  iterate<K extends HoneEventName>(name: K): AsyncIterable<HoneEventMap[K]> {
    return {
      [Symbol.asyncIterator]: () => {
        const queue: HoneEventMap[K][] = [];
        let wake: (() => void) | undefined;
        let done = false;
        const off = this.on(name, (p) => {
          queue.push(p);
          wake?.();
        });
        return {
          async next(): Promise<IteratorResult<HoneEventMap[K]>> {
            while (queue.length === 0 && !done) await new Promise<void>((r) => (wake = r));
            if (done && queue.length === 0) return { value: undefined, done: true };
            return { value: queue.shift() as HoneEventMap[K], done: false };
          },
          async return(): Promise<IteratorResult<HoneEventMap[K]>> {
            done = true;
            off();
            wake?.();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }
}
