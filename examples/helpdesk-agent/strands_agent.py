"""The helpdesk agent in Strands. hone calls answer(input, ctx) once per trial."""
from strands import Agent, tool
from strands.models.anthropic import AnthropicModel

import helpdesk

TOOLS = [tool(f) for f in helpdesk.TOOLS]


def answer(input, ctx):
    # what a change may alter comes from the config: ctx.params
    model_id = ctx.params.get("model", "claude-haiku-5-5")
    agent = Agent(model=AnthropicModel(model_id=model_id, max_tokens=1024), tools=TOOLS, system_prompt=ctx.params["system_prompt"], callback_handler=None)
    result = agent(helpdesk.as_message(input))
    return ctx.from_strands(agent.messages, result.metrics.accumulated_usage, model=model_id)  # records the conversation and the usage
