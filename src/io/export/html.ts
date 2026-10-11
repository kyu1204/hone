// Self-contained HTML report for a run: tiles, matrix, per-trial details.
import type { Trial } from "../../core/types";
import { verdictFor } from "../../stats/passk";

const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root { --bg: #f6f7f9; --fg: #16181d; --muted: #5b616e; --line: #d9dde4; --ok: #2f7d4f; --bad: #b3261e; --warn: #a86a12; --surface: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1216; --fg: #e8ebf0; --muted: #9aa3b2; --line: #2a3140; --surface: #171b21; --ok: #6cc08b; --bad: #ff8a80; --warn: #e0a84a; } }
body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
.muted { color: var(--muted); }
.tiles { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; min-width: 120px; }
.tile b { display: block; font-size: 20px; }
table { border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; font-variant-numeric: tabular-nums; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; margin: 8px 0; }
summary { cursor: pointer; }
pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--bg); padding: 8px; border-radius: 4px; }
.flag { display: inline-block; font-size: 11px; padding: 1px 6px; border: 1px solid var(--warn); color: var(--warn); border-radius: 999px; margin-left: 6px; }
`;

export function renderReport(runId: string, trials: Trial[], summary: Record<string, unknown> | undefined): string {
  const cases = [...new Set(trials.map((t) => t.trace.caseId))].sort();
  const targets = [...new Set(trials.map((t) => t.trace.targetId))].sort();
  const cell = new Map<string, Trial[]>();
  for (const t of trials) {
    const k = `${t.trace.caseId}\u0000${t.trace.targetId}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(t);
  }
  const passed = trials.filter((t) => t.pass === true).length;
  const cost = trials.reduce((a, t) => a + t.costUsd, 0);
  const flagged = trials.filter((t) => t.flags.some((f) => f !== "cached")).length;
  const matrix = cases
    .map((c) => {
      const tds = targets
        .map((tg) => {
          const ts = cell.get(`${c}\u0000${tg}`) ?? [];
          if (!ts.length) return "<td class=\"muted\">·</td>";
          const v = verdictFor(c, tg, ts.map((t) => t.pass === true));
          const cls = v.passAt1 === 1 ? "ok" : v.passAt1 === 0 ? "bad" : "warn";
          const hack = ts.some((t) => t.flags.includes("reward-hack")) ? "<span class=\"flag\">reward-hack</span>" : "";
          return `<td class="${cls}"><a href="#cell-${esc(c)}-${esc(tg)}">${v.passes}/${v.n} (${v.passAt1.toFixed(2)})</a>${hack}</td>`;
        })
        .join("");
      return `<tr><th>${esc(c)}</th>${tds}</tr>`;
    })
    .join("\n");
  const details = cases
    .flatMap((c) =>
      targets.map((tg) => {
        const ts = cell.get(`${c}\u0000${tg}`) ?? [];
        if (!ts.length) return "";
        const items = ts
          .map((t) => {
            const scores = t.scores.map((s) => `<li class="${s.pass === true ? "ok" : s.pass === false ? "bad" : "muted"}">${esc(s.scorer)} ${s.value.toFixed(2)} <span class="muted">${esc(s.reason ?? "")}</span>${s.evidence?.length ? `<pre>${esc(JSON.stringify(s.evidence, null, 1).slice(0, 2000))}</pre>` : ""}</li>`).join("");
            const flags = t.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("");
            return `<details><summary><span class="${t.pass === true ? "ok" : t.pass === false ? "bad" : "muted"}">${t.pass === true ? "PASS" : t.pass === false ? "FAIL" : "UNDECIDED"}</span> trial #${t.trace.trial} ${flags} <span class="muted">$${t.costUsd.toFixed(4)}</span></summary>${t.trace.error ? `<p class="bad">error: ${esc(t.trace.error)}</p>` : ""}<ul>${scores}</ul><pre>${esc(typeof t.trace.output === "string" ? t.trace.output : JSON.stringify(t.trace.output, null, 1)).slice(0, 4000)}</pre></details>`;
          })
          .join("");
        return `<h3 id="cell-${esc(c)}-${esc(tg)}">${esc(c)} × ${esc(tg)}</h3>${items}`;
      }),
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>hone report ${esc(runId)}</title><style>${CSS}</style></head><body>
<h1>hone report</h1><p class="muted">run ${esc(runId)} · generated ${new Date().toISOString()}</p>
<div class="tiles"><div class="tile">pass@1<b>${trials.length ? (passed / trials.length).toFixed(2) : "n/a"}</b></div><div class="tile">trials<b>${trials.length}</b></div><div class="tile">cost<b>$${cost.toFixed(4)}</b></div><div class="tile">flagged<b class="${flagged ? "warn" : ""}">${flagged}</b></div></div>
<h2>matrix</h2><table><thead><tr><th>case \\ target</th>${targets.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${matrix}</tbody></table>
<h2>trials</h2>${details}
${summary ? `<h2>summary</h2><pre>${esc(JSON.stringify(summary, null, 1)).slice(0, 8000)}</pre>` : ""}
</body></html>\n`;
}
