import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../core/types";
import { alignTraces, signature } from "./align";

const u = (c: string): ChatMessage => ({ role: "user", content: c });
const a = (c: string, tools: string[] = []): ChatMessage => ({ role: "assistant", content: c, ...(tools.length ? { tool_calls: tools.map((t, i) => ({ id: `${t}${i}`, type: "function" as const, function: { name: t, arguments: "{}" } })) } : {}) });
const t = (name: string, c = "ok"): ChatMessage => ({ role: "tool", name, tool_call_id: "x", content: c });

describe("alignTraces", () => {
  test("signatures capture role and tool names", () => {
    expect(signature(u("hi"))).toBe("user");
    expect(signature(a("", ["Read", "Write"]))).toBe("assistant:Read,Write");
    expect(signature(t("Read"))).toBe("tool:Read");
  });

  test("identical sequences align fully with no divergence", () => {
    const x = [u("q"), a("", ["Read"]), t("Read"), a("done")];
    const r = alignTraces(x, x);
    expect(r.pairs).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(r.divergence).toBeNull();
  });

  test("divergence is the first unmatched pair; unmatched steps get a gap on the other side", () => {
    const x = [u("q"), a("", ["Read"]), t("Read"), a("", ["Bash"]), t("Bash"), a("done")];
    const y = [u("q"), a("", ["Read"]), t("Read"), a("done")];
    const r = alignTraces(x, y);
    expect(r.divergence).toBe(3);
    expect(r.pairs.slice(0, 3)).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(r.pairs).toContainEqual([3, null]);
    expect(r.pairs).toContainEqual([4, null]);
    expect(r.pairs.at(-1)).toEqual([5, 3]);
    const z = [u("q"), a("", ["Write"]), t("Write"), a("done")];
    expect(alignTraces(x, z).divergence).toBe(1);
  });

  test("empty inputs", () => {
    expect(alignTraces([], []).pairs).toEqual([]);
    expect(alignTraces([u("q")], []).pairs).toEqual([[0, null]]);
    expect(alignTraces([u("q")], []).divergence).toBe(0);
  });
});
