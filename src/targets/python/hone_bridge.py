"""hone Python bridge.

Spawned by hone as `python -I hone_bridge.py <module> <fn>`. Reads one JSON object per
line on stdin ({"id", "input", "ctx"}), calls `<fn>(input, ctx)` and writes one JSON
object per line on stdout ({"id", "result"} or {"id", "error"}).

`ctx` is a Context with `span(kind, name)`, `message(role, content, **kw)` and
`usage(input_tokens=, output_tokens=, cost_usd=)`; whatever the handler records is
attached to the result as messages / spans / usage.
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
import traceback

_PROTOCOL_KEYS = ("messages", "spans", "usage", "artifacts", "error", "meta")


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

    def usage(self, input_tokens: float = 0, output_tokens: float = 0, cost_usd: float = 0.0) -> None:
        for key, value in (("inputTokens", input_tokens), ("outputTokens", output_tokens), ("costUsd", cost_usd)):
            if value:
                self._usage[key] = self._usage.get(key, 0) + value

    def finish(self, result) -> dict:
        base = {"output": result, "messages": self.messages, "spans": self.spans, "usage": self._usage}
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


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, default=str) + "\n")
    sys.stdout.flush()


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: hone_bridge.py <module> <fn>\n")
        return 2
    try:
        fn = _load(sys.argv[1], sys.argv[2])
    except BaseException as e:  # noqa: BLE001
        _emit({"id": None, "error": {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}})
        return 1
    _emit({"id": None, "ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as e:
            _emit({"id": None, "error": {"type": "JSONDecodeError", "message": str(e), "traceback": ""}})
            continue
        rid = payload.get("id")
        try:
            _emit({"id": rid, "result": _call(fn, payload)})
        except BaseException as e:  # noqa: BLE001
            _emit({"id": rid, "error": {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
