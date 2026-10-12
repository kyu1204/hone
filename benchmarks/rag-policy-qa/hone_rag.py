"""hone python target over the rag_qa_eval RAG: runs app.rag in-process so an arbitrary system prompt can be injected.

Env: HONE_RAG_PROMPT (full system prompt text; empty = the version chosen by RAG_PROMPT), TOP_K and the app's own settings."""
import os
import sys

sys.path.insert(0, os.environ.get("RAG_REPO", "/Users/minkyu/Documents/rag_qa_eval"))
from app import rag  # noqa: E402
from app.config import settings  # noqa: E402

PROMPT_TEXT = os.environ.get("HONE_RAG_PROMPT", "").strip()
if PROMPT_TEXT:
    rag.PROMPTS["hone"] = PROMPT_TEXT
    settings.rag_prompt = "hone"


def handler(question, ctx):
    top_k = int(os.environ.get("TOP_K", settings.top_k))
    result = rag.answer(str(question), top_k)
    d = result.to_dict(debug=True)
    retrieved = [{"id": str(h["chunk_id"]) if "chunk_id" in h else str(h.get("ref")), "text": h.get("content") or h.get("snippet", ""), "score": h.get("score"), "page_start": h.get("page_start"), "page_end": h.get("page_end"), "document_id": h.get("document_id")} for h in (d.get("retrieved") or [])]
    with ctx.span("retrieval", "pgvector") as s:
        s.set_input(str(question))
        s.set_output(retrieved)
    usage = d.get("meta", {}).get("usage") or {}
    ctx.usage(usage.get("prompt_tokens", 0) or 0, usage.get("completion_tokens", 0) or 0)
    ctx.message("system", rag.PROMPTS[settings.rag_prompt])
    ctx.message("user", str(question))
    ctx.message("assistant", d.get("answer", ""))
    # output = the answer text (so hone's fault injectors and text scorers see it); the structured parts ride in meta
    return {"output": d.get("answer", ""), "meta": {"status": d["status"], "citations": d.get("citations", []), "retrieved": retrieved, "warnings": d.get("warnings", []), "prompt_version": settings.rag_prompt, "top_k": top_k, "model": settings.llm_model}}
