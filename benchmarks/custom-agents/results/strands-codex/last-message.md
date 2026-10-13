Hone found the core problem: the one-sentence system prompt doesn’t define the helpdesk’s operating rules.

The agent frequently:

- Omits bracketed policy citations such as `[P-02]`.
- Fails to create tickets when no policy is found or support escalation is required.
- Leaves security escalations incomplete—wrong priority, missing ticket reference, or missing `security@acme.example`.

I tested four prompt hypotheses plus the larger Sonnet model. The strongest candidate was [explicit-helpdesk-contract.ts](/Users/minkyu/.cache/hone-bench/custom-agents/strands-codex/sharpen/explicit-helpdesk-contract.ts). It explicitly defines citation, ticketing, and security procedures.

Results:

- Development cases: **52% → 92%**
- 12 unseen held-out cases: **33% → 83%**
- Gain: **+50 percentage points**
- 95% interval: **+7 to +93**
- Cost per case: **1.2×**
- Sonnet provided no additional accuracy over the prompt change.

Hone’s verdict:

> **PROMISING, not proven.** On 12 cases it never saw, make the helpdesk operating contract explicit takes the pass rate from 33% to 83% (+50 points, 95% interval +7 to +93, p = 0.07). Cost per case: 1.2x. About 20 held-out cases would settle it.

Because this was the second distinct candidate judged by the same holdout set, hone required `p < 0.025`; it achieved `p = 0.07`. Following hone’s rules, I left the candidate ready under `sharpen/` but did not modify the production prompt. New evaluation cases are needed before it can be responsibly shipped.