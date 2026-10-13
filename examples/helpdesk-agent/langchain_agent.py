"""The helpdesk agent in LangChain. hone calls answer(input, ctx) once per trial."""
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_anthropic import ChatAnthropic

import helpdesk

TOOLS = [tool(f) for f in helpdesk.TOOLS]


def answer(input, ctx):
    # what a change may alter comes from the config: ctx.params
    model = ChatAnthropic(model=ctx.params.get("model", "claude-haiku-5-5"), max_tokens=1024)
    agent = create_agent(model=model, tools=TOOLS, system_prompt=ctx.params["system_prompt"])
    result = agent.invoke({"messages": [{"role": "user", "content": helpdesk.as_message(input)}]})
    return ctx.from_langchain(result["messages"])  # records every message, tool call and the token usage
