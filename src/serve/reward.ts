// HTTP reward server: run the configured scorers on posted messages or output.
import type { ChatMessage, Score, Span, Trace } from "../core/types";
import { normalizeScore, type Scorer } from "../scorers/scorer";

export interface RewardServerOptions {
  scorers: Scorer[];
  port?: number;
  host?: string;
  log?: (line: string) => void;
}

export interface RewardServer {
  port: number;
  host: string;
  stop(): Promise<void>;
}

export interface ScoreRequest {
  messages?: ChatMessage[];
  output?: unknown;
  spans?: Span[];
  case?: { id?: string; input?: unknown; expected?: unknown; rubric?: string };
}

export interface ScoreResponse {
  reward: number;
  pass: boolean | null;
  scores: Score[];
}

class BadRequest extends Error {}

function parseItem(x: unknown): ScoreRequest {
  if (typeof x !== "object" || x === null) throw new BadRequest("body must be an object");
  const o = x as ScoreRequest;
  if (!Array.isArray(o.messages) && o.output === undefined) throw new BadRequest("body needs messages or output");
  return o;
}

const lastAssistant = (ms: ChatMessage[]): unknown => {
  const m = [...ms].reverse().find((x) => x.role === "assistant");
  return m ? m.content : null;
};
const firstUser = (ms: ChatMessage[]): unknown => ms.find((x) => x.role === "user")?.content;

export async function scoreOne(scorers: Scorer[], req: ScoreRequest, n: number): Promise<ScoreResponse> {
  const messages = req.messages ?? [];
  const now = new Date().toISOString();
  const caseId = req.case?.id ?? `adhoc-${n}`;
  const trace: Trace = { id: `reward-${n}`, caseId, targetId: "reward", trial: 0, startedAt: now, endedAt: now, messages, spans: req.spans ?? [], output: req.output ?? lastAssistant(messages), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  const c = { id: caseId, input: req.case?.input ?? firstUser(messages), ...(req.case?.expected !== undefined ? { expected: req.case.expected } : {}), ...(req.case?.rubric ? { rubric: req.case.rubric } : {}) };
  const scores: Score[] = [];
  // scorer exceptions propagate so the caller answers 500 instead of a silent null
  for (const s of scorers) scores.push(normalizeScore(await s.score({ case: c, trace, trial: 0 }), s.name, trace));
  const pass = scores.some((s) => s.pass === false) ? false : scores.some((s) => s.pass === true) ? true : null;
  const reward = pass === true ? 1 : pass === false ? 0 : scores.length ? scores.reduce((a, s) => a + s.value, 0) / scores.length : 0;
  return { reward, pass, scores };
}

export async function startRewardServer(opts: RewardServerOptions): Promise<RewardServer> {
  const log = opts.log ?? (() => {});
  let n = 0;
  const json = (body: unknown, status = 200): Response => Response.json(body, { status });
  const server = Bun.serve({
    port: opts.port ?? 8787,
    hostname: opts.host ?? "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, scorers: opts.scorers.map((s) => s.name) });
      if (req.method !== "POST" || (url.pathname !== "/score" && url.pathname !== "/batch")) return json({ error: "not found" }, 404);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      try {
        if (url.pathname === "/score") {
          const out = await scoreOne(opts.scorers, parseItem(body), ++n);
          log(`score #${n}: reward ${out.reward}`);
          return json(out);
        }
        const items = (body as { items?: unknown }).items;
        if (!Array.isArray(items)) throw new BadRequest("batch needs items[]");
        const parsed = items.map(parseItem);
        const results: ScoreResponse[] = Array.from({ length: parsed.length }, () => ({ reward: 0, pass: null, scores: [] }));
        // ponytail: fixed concurrency of 4; make it an option if a judge rate limit asks for it
        for (let i = 0; i < parsed.length; i += 4) await Promise.all(parsed.slice(i, i + 4).map(async (item, k) => (results[i + k] = await scoreOne(opts.scorers, item, ++n))));
        log(`batch of ${parsed.length}`);
        return json({ results });
      } catch (e) {
        if (e instanceof BadRequest) return json({ error: e.message }, 400);
        const msg = e instanceof Error ? e.message : String(e);
        log(`error: ${msg}`);
        return json({ error: msg }, 500);
      }
    },
  });
  return { port: server.port ?? 0, host: server.hostname ?? "127.0.0.1", stop: async () => void (await server.stop(true)) };
}
