Improved the helpdesk agent by replacing its vague one-line prompt with an explicit operating contract in [hone.config.ts](/Users/minkyu/.cache/hone-bench/custom-agents/langchain-codex/hone.config.ts:4).

What was wrong:

- Policy answers omitted bracketed citations such as `[P-02]`.
- IT requests sometimes offered help instead of creating a ticket and returning its ID.
- Security incidents omitted `security@acme.example` or used the wrong priority.
- Missing-policy questions redirected employees elsewhere rather than opening a low-priority escalation ticket.

Results:

- Baseline: **47.2% pass@1** — 34/72 trials.
- Applied version: **94.4% pass@1** — 68/72 trials.
- No execution errors.
- The cheaper Haiku model was retained; Sonnet was unnecessary.

Hone’s verdict:

> **PROVEN.** On 12 cases it never saw, the explicit helpdesk operating contract increased pass rate from **42% to 96%**—a **+54-point** gain (95% interval **+23 to +86**, **p = 0.02**). Cost per case: **1.1×**.

This passed hone’s tightened `p < 0.025` threshold because the holdout set had already evaluated another candidate. Remaining failures are confined to a few ticket-handling cases, including one intermittent result.