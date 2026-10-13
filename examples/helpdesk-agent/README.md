# helpdesk-agent

An in-house agent the way teams build them: six internal tools, a one-line prompt, and house rules that live in people's heads. The same agent is here twice, in LangChain (`langchain_agent.py`) and in Strands (`strands_agent.py`), over the same tools (`helpdesk.py`). `hone test` compares the two; `hone sharpen` improves either.

```bash
cd examples/helpdesk-agent
uv sync                              # langchain, langchain-anthropic and strands-agents into .venv
export ANTHROPIC_API_KEY=...         # the agents call claude-haiku-5-5 on every trial
hone test                            # 36 cases, both frameworks, two trials each: about 90 seconds and $0.65
HONE_AGENT=langchain hone sharpen    # find why cases fail, rewrite the prompt, confirm on held-out cases
```

## Wiring an agent in

hone calls a Python function with the case input and a context. The function runs the agent and hands back what the framework returned. That is the whole integration:

```python
# langchain_agent.py
def answer(input, ctx):
    model = ChatAnthropic(model=ctx.params.get("model", "claude-haiku-5-5"), max_tokens=1024)
    agent = create_agent(model=model, tools=TOOLS, system_prompt=ctx.params["system_prompt"])
    result = agent.invoke({"messages": [{"role": "user", "content": helpdesk.as_message(input)}]})
    return ctx.from_langchain(result["messages"])
```

```python
# strands_agent.py
def answer(input, ctx):
    model_id = ctx.params.get("model", "claude-haiku-5-5")
    agent = Agent(model=AnthropicModel(model_id=model_id, max_tokens=1024), tools=TOOLS, system_prompt=ctx.params["system_prompt"], callback_handler=None)
    result = agent(helpdesk.as_message(input))
    return ctx.from_strands(agent.messages, result.metrics.accumulated_usage, model=model_id)
```

`ctx.from_langchain` and `ctx.from_strands` record the conversation: every tool call with its arguments, every tool result, the tokens and what they cost. `ctx.params` is the `params` of the target in `hone.config.ts`. The system prompt and the model name come from there, which is what lets a change replace them without touching the agent:

```ts
// hone.config.ts
langchain: { kind: "python", module: "langchain_agent", fn: "answer", python: ".venv/bin/python", workers: 6,
             params: { system_prompt: PROMPT, model: "claude-haiku-5-5" } },
```

## The house rules

The first prompt is `You are the Acme internal helpdesk assistant. Help employees with their questions.` It says none of the following. The cases do, six requests for each rule:

| rule | a case passes when |
|---|---|
| cite | a policy answer comes from `search_policy` and names the policy as `[P-03]` |
| verify | `reset_password` is called only after `verify_identity`, and never without an employee ID that checks out |
| lookup | a leave balance comes from `get_leave_balance`, not from the policy text |
| ticket | a hardware problem or a software request gets a ticket of the right category, `high` when the person cannot work and `normal` otherwise, and the answer gives the ticket id |
| security | a security incident gets a `security` ticket with priority `urgent`, and the answer says to write to security@acme.example |
| nopolicy | when no policy covers the question, the answer cites none and a `low` ticket of category `other` hands the question on |

A case says what must hold in the recorded conversation:

```json
{
  "id": "sec-lost-laptop",
  "input": { "from": "sara.cho@acme.example", "message": "I left my work laptop on the subway this morning." },
  "expected": {
    "tools": ["create_ticket"],
    "args": { "create_ticket": { "category": "security", "priority": "urgent" } },
    "says": ["security@acme.example"]
  },
  "tags": ["security"]
}
```

Three small scorers in `hone.config.ts` read it: `tools` (called, never called, in which order), `args` and `answer`. Each one's reason names the rule that was broken (`create_ticket was called with priority "high"; this request needs "urgent"`), because the diagnosis and the rewrites are built from those reasons.

## What `hone test` shows

One row per case and one column per framework, then the totals. `hone matrix` puts the two side by side (the run of 2026-10-13, claude-haiku-5-5):

```
target     band  cases  trials  pass@1  pass^3  $/solve   tokens/solve  s/solve  timeouts  hacks  cached  undecided  errors
langchain  A     36     72      0.46    n/a     $0.0094   6,001         8.0      0         0      0%
strands    A     36     72      0.46    n/a     $0.0098   6,381         8.0      0         0      0%

band: targets sharing a letter are not significantly different (Holm-adjusted paired tests).
```

Counted by rule, passed trials out of 12:

| rule | langchain | strands |
|---|---|---|
| cite | 0 | 0 |
| verify | 12 | 12 |
| lookup | 12 | 12 |
| ticket | 6 | 7 |
| security | 3 | 2 |
| nopolicy | 0 | 0 |

Both keep the two rules a model keeps unprompted and break the four that are this company's conventions. The columns agree, so the failures come from the prompt and not from the framework.

## Improve it

`hone sharpen` holds a third of the cases out, finds why the rest fail, and tries changes: rewrites of the system prompt (`sharpen.text` in the config says where a new text goes) and the larger model with the same prompt (`sharpen.variants`, at three times the price). The best one is then checked on the cases that were held out.

An idea of your own is a file under `sharpen/`, tried along with the rest:

```ts
// sharpen/cite-policies.ts
import { change } from "hone-eval";

change("cite the policy id", {
  why: "answers quote the policy text but never name the policy, and the cite cases need [P-xx]",
  text: "You are the Acme internal helpdesk assistant. When an answer comes from a policy, end the sentence with its id in brackets, like [P-03].",
});
```

`HONE_AGENT` picks one framework. Without it both run, and a change is judged on the two together.
