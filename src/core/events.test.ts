import { describe, expect, test } from "bun:test";
import { HoneEvents } from "./events";

describe("HoneEvents", () => {
  test("on delivers typed payloads and the returned function unsubscribes", () => {
    const ev = new HoneEvents();
    const seen: number[] = [];
    const off = ev.on("run:start", (p) => seen.push(p.total));
    ev.emit("run:start", { runId: "r", total: 3 });
    off();
    ev.emit("run:start", { runId: "r", total: 4 });
    expect(seen).toEqual([3]);
  });

  test("once fires a single time and off removes a listener", () => {
    const ev = new HoneEvents();
    let count = 0;
    ev.once("log", () => count++);
    ev.emit("log", { level: "info", msg: "a" });
    ev.emit("log", { level: "info", msg: "b" });
    const fn = (): void => {
      count += 10;
    };
    ev.on("log", fn);
    ev.off("log", fn);
    ev.emit("log", { level: "info", msg: "c" });
    expect(count).toBe(1);
  });

  test("a throwing listener becomes a log error, not an exception", () => {
    const ev = new HoneEvents();
    const logs: string[] = [];
    ev.on("log", (p) => logs.push(`${p.level}:${p.msg}`));
    ev.on("case:stopped", () => {
      throw new Error("boom");
    });
    expect(() => ev.emit("case:stopped", { caseId: "c", targetId: "t", reason: "ci-width" })).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^error:.*boom/);
  });

  test("iterate yields events until the iterator is returned", async () => {
    const ev = new HoneEvents();
    const it = ev.iterate("trial:start")[Symbol.asyncIterator]();
    ev.emit("trial:start", { trialId: "a", caseId: "c", targetId: "t", trial: 0 });
    ev.emit("trial:start", { trialId: "b", caseId: "c", targetId: "t", trial: 1 });
    expect((await it.next()).value?.trialId).toBe("a");
    expect((await it.next()).value?.trialId).toBe("b");
    const pending = it.next();
    await it.return?.();
    expect((await pending).done).toBe(true);
    ev.emit("trial:start", { trialId: "c", caseId: "c", targetId: "t", trial: 2 });
    expect(ev.listenerCount("trial:start")).toBe(0);
  });
});
