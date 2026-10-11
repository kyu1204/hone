import { describe, expect, test } from "bun:test";
import fixture from "../../test/fixtures/atif-v1.7.json";
import { type AtifTrajectory, atifToMessages, messagesToAtif } from "./atif";

describe("ATIF v1.7 mapping", () => {
  test("steps map to user, assistant with tool_calls, and tool messages with matching ids", () => {
    const { messages, spans, meta } = atifToMessages(fixture as AtifTrajectory);
    expect(meta.agent).toBe("claude-code");
    expect(meta.model).toBe("claude-opus-5");
    expect(messages[0]).toMatchObject({ role: "user" });
    expect(String(messages[0]?.content)).toContain("hello.txt");
    const assistant = messages.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(assistant?.tool_calls?.[0]).toMatchObject({ id: "toolu_01Rmm2GPxpGq9Er31axjfYRv", type: "function", function: { name: "Write" } });
    expect(JSON.parse(assistant!.tool_calls![0]!.function.arguments)).toMatchObject({ file_path: "/app/hello.txt" });
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("toolu_01Rmm2GPxpGq9Er31axjfYRv");
    expect(String(toolMsg?.content)).toContain("File created successfully");
    expect(spans.filter((s) => s.kind === "tool").map((s) => s.name)).toContain("Write");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  test("round trip keeps roles, tool calls and results", () => {
    const { messages } = atifToMessages(fixture as AtifTrajectory);
    const back = messagesToAtif(messages, { name: "hone", version: "0", model_name: "m" });
    expect(back.schema_version).toBe("ATIF-v1.7");
    expect(back.steps.map((s) => s.source)).toEqual(["user", "agent", "agent"]);
    expect(back.steps[1]?.tool_calls?.[0]?.function_name).toBe("Write");
    expect(back.steps[1]?.observation?.results?.[0]?.source_call_id).toBe("toolu_01Rmm2GPxpGq9Er31axjfYRv");
    expect(atifToMessages(back).messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  test("unknown step sources become system messages and malformed input throws", () => {
    const t: AtifTrajectory = { schema_version: "ATIF-v1.7", session_id: "s", agent: { name: "x", version: "1" }, steps: [{ step_id: 1, timestamp: "2026-01-01T00:00:00Z", source: "system", message: "note" }] };
    expect(atifToMessages(t).messages[0]).toEqual({ role: "system", content: "note" });
    expect(() => atifToMessages({ schema_version: "ATIF-v9", steps: [] } as unknown as AtifTrajectory)).toThrow(/ATIF/);
  });
});
