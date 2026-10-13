"""hone Python bridge.

Spawned by hone as `python -I hone_bridge.py <module> <fn>`. Reads one JSON object per
line on stdin ({"id", "input", "ctx"}), calls `<fn>(input, ctx)` and writes one JSON
object per line on stdout ({"id", "result"} or {"id", "error"}).

`ctx` is a Context with `span(kind, name)`, `message(role, content, **kw)` and
`usage(input_tokens=, output_tokens=, cost_usd=, model=)`; whatever the handler records is
attached to the result as messages / spans / usage. `ctx.params` is the `params` of the
target in hone.config.ts: what a change alters (a prompt, a model, a setting).

For an agent built with a framework, `ctx.from_langchain(messages)` and
`ctx.from_strands(messages, usage)` record the whole conversation, tool calls included,
from what the framework returns. Neither library is imported here.

A third argument sets how many calls are served at once (threads; default 1).

The protocol has stdout to itself: whatever the module prints goes to stderr.
"""
from __future__ import annotations

import asyncio
import contextlib
import datetime as _dt
import importlib
import importlib.util
import inspect
import json
import os
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

_PROTOCOL_KEYS = ("messages", "spans", "usage", "artifacts", "error", "meta")


_ROLES = {"human": "user", "user": "user", "ai": "assistant", "assistant": "assistant", "system": "system", "tool": "tool"}


def _text(content) -> str:
    """Text of a message content: a string, or a list of blocks of which the text ones count."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and "text" in block and block.get("type", "text") == "text":
            parts.append(str(block["text"]))
    return "".join(parts)


def _json(value) -> str:
    return value if isinstance(value, str) else json.dumps(value, default=str)


def _call_entry(call_id, name, args) -> dict:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": _json(args if args is not None else {})}}


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


class SpanHandle:
    def __init__(self, span: dict):
        self._span = span

    def set_input(self, value) -> None:
        self._span["input"] = value

    def set_output(self, value) -> None:
        self._span["output"] = value

    def attr(self, key: str, value) -> None:
        self._span.setdefault("attrs", {})[key] = value


class Context:
    def __init__(self, raw: dict):
        self.case_id = raw.get("caseId")
        self.trial = raw.get("trial")
        self.prefix = raw.get("prefix")
        self.params: dict = raw.get("params") or {}
        self.model = None
        self.messages: list = list(self.prefix) if self.prefix else []
        self.spans: list = []
        self._usage: dict = {}
        self._stack: list = []
        self._seq = 0

    @contextlib.contextmanager
    def span(self, kind: str, name: str):
        self._seq += 1
        span = {"id": f"s{self._seq}", "kind": kind, "name": name, "startedAt": _now()}
        if self._stack:
            span["parentId"] = self._stack[-1]
        self.spans.append(span)
        self._stack.append(span["id"])
        try:
            yield SpanHandle(span)
        except BaseException as e:  # noqa: BLE001 - recorded then re-raised
            span.setdefault("attrs", {})["error"] = f"{type(e).__name__}: {e}"
            raise
        finally:
            span["endedAt"] = _now()
            self._stack.pop()

    def message(self, role: str, content, **extra) -> None:
        m = {"role": role, "content": content}
        m.update(extra)
        self.messages.append(m)

    def usage(self, input_tokens: float = 0, output_tokens: float = 0, cost_usd: float = 0.0, model=None) -> None:
        """Add to the trial's usage. With a model name and no cost, hone prices the tokens from its own table."""
        for key, value in (("inputTokens", input_tokens), ("outputTokens", output_tokens), ("costUsd", cost_usd)):
            if value:
                self._usage[key] = self._usage.get(key, 0) + value
        if model:
            self.model = str(model)

    def from_langchain(self, messages):
        """Record what `agent.invoke(...)["messages"]` returns: LangChain or LangGraph message objects (or dicts) with
        their tool calls and tool results, and the token usage. Returns the text of the last assistant message."""
        last = None
        for m in messages:
            get = m.get if isinstance(m, dict) else (lambda key, default=None, _m=m: getattr(_m, key, default))
            role = _ROLES.get(str(get("type") or get("role") or ""), "user")
            text = _text(get("content"))
            if role == "tool":
                extra = {k: v for k, v in (("tool_call_id", get("tool_call_id")), ("name", get("name"))) if v}
                self.message("tool", text, **extra)
                continue
            calls = [_call_entry(c.get("id"), c.get("name"), c.get("args")) for c in (get("tool_calls") or [])]
            self.message(role, text, **({"tool_calls": calls} if calls else {}))
            used = get("usage_metadata") or {}
            meta = get("response_metadata") or {}
            if used:
                self.usage(input_tokens=used.get("input_tokens", 0), output_tokens=used.get("output_tokens", 0), model=meta.get("model_name") or meta.get("model"))
            if role == "assistant" and text:
                last = text
        return last

    def from_strands(self, messages, usage=None, model=None):
        """Record a Strands agent's `agent.messages` (content blocks `text`, `toolUse`, `toolResult`) and
        `result.metrics.accumulated_usage`. Returns the text of the last assistant message."""
        names: dict = {}
        last = None
        for m in messages:
            blocks = m.get("content") or []
            if isinstance(blocks, str):
                blocks = [{"text": blocks}]
            blocks = [b for b in blocks if isinstance(b, dict)]
            text = "".join(str(b["text"]) for b in blocks if "text" in b)
            for r in (b["toolResult"] for b in blocks if "toolResult" in b):
                body = "".join(str(c["text"]) if "text" in c else _json(c.get("json")) for c in (r.get("content") or []) if isinstance(c, dict))
                extra = {k: v for k, v in (("tool_call_id", r.get("toolUseId")), ("name", names.get(r.get("toolUseId")))) if v}
                self.message("tool", body, **extra)
            uses = [b["toolUse"] for b in blocks if "toolUse" in b]
            for u in uses:
                names[u.get("toolUseId")] = u.get("name")
            role = "assistant" if m.get("role") == "assistant" else "user"
            if uses:
                self.message("assistant", text, tool_calls=[_call_entry(u.get("toolUseId"), u.get("name"), u.get("input")) for u in uses])
            elif text:
                self.message(role, text)
            if role == "assistant" and text:
                last = text
        if usage:
            self.usage(input_tokens=usage.get("inputTokens", 0), output_tokens=usage.get("outputTokens", 0), model=model)
        elif model:
            self.model = str(model)
        return last

    def finish(self, result) -> dict:
        base = {"output": result, "messages": self.messages, "spans": self.spans, "usage": self._usage}
        if self.model:
            base["meta"] = {"model": self.model}
        if isinstance(result, dict) and "output" in result and any(k in result for k in _PROTOCOL_KEYS):
            merged = dict(base)
            merged["output"] = result["output"]
            for key in _PROTOCOL_KEYS:
                if key in result:
                    merged[key] = (self.spans + result[key]) if key == "spans" else result[key]
            return merged
        return base


def _load(module: str, fn: str):
    if module.endswith(".py") or os.sep in module:
        spec = importlib.util.spec_from_file_location("hone_user_module", module)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot load {module}")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hone_user_module"] = mod
        spec.loader.exec_module(mod)
    else:
        # the bridge runs with -I, which drops the working directory from sys.path; put it back so `module: "answer"` finds ./answer.py
        cwd = os.getcwd()
        if cwd not in sys.path:
            sys.path.insert(0, cwd)
        mod = importlib.import_module(module)
    return getattr(mod, fn)


def _call(fn, payload: dict):
    ctx = Context(payload.get("ctx") or {})
    result = fn(payload.get("input"), ctx)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
    return ctx.finish(result)


_out = threading.Lock()
_protocol = sys.stdout


def _own_stdout() -> None:
    """Keep the real stdout for the protocol and point file descriptor 1 at stderr, so nothing the module prints, and
    nothing a process it starts writes, can land between two protocol lines or pass for one."""
    global _protocol
    _protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr


def _emit(obj: dict) -> None:
    with _out:
        _protocol.write(json.dumps(obj, default=str) + "\n")
        _protocol.flush()


def _serve(fn, payload: dict) -> None:
    rid = payload.get("id")
    try:
        _emit({"id": rid, "result": _call(fn, payload)})
    except BaseException as e:  # noqa: BLE001
        _emit({"id": rid, "error": {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}})


def main() -> int:
    if len(sys.argv) not in (3, 4):
        sys.stderr.write("usage: hone_bridge.py <module> <fn> [workers]\n")
        return 2
    _own_stdout()
    try:
        fn = _load(sys.argv[1], sys.argv[2])
    except BaseException as e:  # noqa: BLE001
        _emit({"id": None, "error": {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}})
        return 1
    workers = max(1, int(sys.argv[3])) if len(sys.argv) == 4 else 1
    _emit({"id": None, "ready": True})
    # agent calls wait on a model, so threads are enough to serve several at once
    pool = ThreadPoolExecutor(max_workers=workers) if workers > 1 else None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as e:
            _emit({"id": None, "error": {"type": "JSONDecodeError", "message": str(e), "traceback": ""}})
            continue
        if pool:
            pool.submit(_serve, fn, payload)
        else:
            _serve(fn, payload)
    if pool:
        pool.shutdown(wait=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
