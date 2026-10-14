import { afterEach, describe, expect, test } from "bun:test";
import type { Case, Trace } from "../core/types";
import { createScorer } from "./index";

/** A conversation as a target records it: the tool calls the agent made, then its answer. */
function said(calls: [string, Record<string, unknown>][], answer: string): Trace {
  return {
    id: "t",
    caseId: "c",
    targetId: "agent",
    trial: 0,
    startedAt: "",
    endedAt: "",
    messages: [{ role: "user", content: "q" }, ...calls.map(([name, args], i) => ({ role: "assistant" as const, content: "", tool_calls: [{ id: `c${i}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] })), { role: "assistant", content: answer }],
    spans: [],
    output: answer,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}
const theCase = (expected: unknown): Case => ({ id: "c", input: "q", expected });
const judge = async (expected: unknown, trace: Trace, extra: Record<string, unknown> = {}) => createScorer({ name: "agent", ...extra }).score({ case: theCase(expected), trace, trial: 0 });

const stops: (() => void)[] = [];
afterEach(() => {
  for (const f of stops.splice(0)) f();
});
/** A model that answers every judge request with `verdict`. */
function stubModel(verdict: { verdict: string; reason: string }) {
  const asked: string[] = [];
  const s = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      asked.push(JSON.stringify(await req.json()));
      return Response.json({ choices: [{ message: { content: JSON.stringify(verdict) } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "gpt-5-mini" });
    },
  });
  stops.push(() => s.stop(true));
  return { provider: { kind: "openai", apiKey: "k", baseUrl: `http://127.0.0.1:${s.port}/v1`, model: "gpt-5-mini" }, asked };
}

describe("agent scorer", () => {
  const ticket = (category: string, priority: string): [string, Record<string, unknown>] => ["create_ticket", { category, priority, summary: "s" }];

  test("each expectation passes when the conversation keeps it, and names itself when it does not", async () => {
    // calls and never
    expect((await judge({ calls: ["search_policy"] }, said([["search_policy", { query: "meals" }]], "ok"))).pass).toBe(true);
    expect((await judge({ calls: ["search_policy"] }, said([], "ok"))).reason).toBe("did not call search_policy");
    expect((await judge({ never: ["reset_password"] }, said([["reset_password", { email: "a" }]], "done"))).reason).toBe("called reset_password, which this case does not allow");
    // order: each one called, and each before the next
    const verify: [string, Record<string, unknown>] = ["verify_identity", { employee_id: "E1" }];
    const reset: [string, Record<string, unknown>] = ["reset_password", { email: "a" }];
    expect((await judge({ order: ["verify_identity", "reset_password"] }, said([verify, reset], "done"))).pass).toBe(true);
    expect((await judge({ order: ["verify_identity", "reset_password"] }, said([reset, verify], "done"))).reason).toBe("called reset_password before verify_identity");
    expect((await judge({ order: ["verify_identity", "reset_password"] }, said([reset], "done"))).reason).toBe("did not call verify_identity");
    // args: compared as text, case ignored
    expect((await judge({ args: { create_ticket: { priority: "urgent" } } }, said([ticket("security", "Urgent")], "T-1"))).pass).toBe(true);
    expect((await judge({ args: { create_ticket: { priority: "urgent", category: "security" } } }, said([ticket("hardware", "high")], "T-1"))).reason).toBe('create_ticket was called with priority "high"; this case needs "urgent"; create_ticket was called with category "hardware"; this case needs "security"');
    // a reason is given once, though two expectations find it
    expect((await judge({ calls: ["create_ticket"], args: { create_ticket: { priority: "urgent" } } }, said([], "no"))).reason).toBe("did not call create_ticket");
    // says and never_says, case ignored
    expect((await judge({ says: ["[P-03]", "30,000"] }, said([], "Up to 30,000 KRW [p-03]."))).pass).toBe(true);
    expect((await judge({ says: ["[P-03]"] }, said([], "per policy P-03"))).reason).toBe('the answer does not contain "[P-03]"');
    expect((await judge({ never_says: ["[P-"] }, said([], "Pets are welcome [P-02]."))).reason).toBe('the answer contains "[P-", which it must not');
    // every broken one, in the order of the case
    const all = await judge({ calls: ["create_ticket"], says: ["security@acme.example"] }, said([], "Sorry to hear that."));
    expect(all).toMatchObject({ pass: false, value: 0, reason: 'did not call create_ticket; the answer does not contain "security@acme.example"' });
  });

  test("judge: a rule in words, decided by the model from the whole conversation", async () => {
    const no = stubModel({ verdict: "fail", reason: "it never says to write to the security team" });
    const r = await judge({ calls: ["create_ticket"], judge: "tells the employee to report the incident within the hour" }, said([ticket("security", "urgent")], "Ticket T-1 is open."), { provider: no.provider });
    expect(r).toMatchObject({ pass: false, reason: "it never says to write to the security team (the rule: tells the employee to report the incident within the hour)" });
    expect(no.asked[0]).toContain("create_ticket"); // the model sees the tool calls, not only the answer
    const yes = stubModel({ verdict: "pass", reason: "it does" });
    expect((await judge({ judge: ["a", "b"] }, said([], "fine"), { provider: yes.provider })).pass).toBe(true);
    expect(yes.asked).toHaveLength(2); // one question per rule
    // a broken expectation is enough: the model is not asked
    const unasked = stubModel({ verdict: "pass", reason: "" });
    expect((await judge({ calls: ["create_ticket"], judge: "anything" }, said([], "no"), { provider: unasked.provider })).reason).toBe("did not call create_ticket");
    expect(unasked.asked).toHaveLength(0);
  });

  test("with no model to ask, a rule in words leaves the trial undecided, not failed", async () => {
    const r = await judge({ calls: ["create_ticket"], judge: "is polite" }, said([ticket("other", "low")], "Done."), { model: false });
    expect(r.pass).toBeNull();
    expect(r.reason).toMatch(/no model to judge "is polite"/);
  });

  test("a case that says nothing about the conversation is not checked", async () => {
    expect((await judge("Paris", said([], "Paris"))).pass).toBeNull();
    expect((await judge({ answer: "x" }, said([], "x"))).pass).toBeNull();
  });
});
