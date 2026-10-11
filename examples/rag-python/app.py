"""A tiny retrieval-augmented QA server with no dependencies: POST /ask {"q": "..."} -> {"answer", "chunks"}.
Stands in for a FastAPI + vector store service; swap the retrieval and generation for yours."""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

CHUNKS = [
    {"id": "c1", "text": "The new parking policy starts on 2026-07-01 and applies to all residents."},
    {"id": "c2", "text": "Visitor permits cost 10 EUR per day and are issued at the front desk."},
    {"id": "c3", "text": "The recycling schedule changes to Tuesdays from September."},
    {"id": "c4", "text": "The gym is closed for renovation until 2026-08-15."},
]
STOP = {"the", "is", "a", "an", "of", "when", "does", "do", "what", "how", "much", "to", "on", "in", "for", "and", "are"}


def tokens(s):
    return [t for t in re.findall(r"[a-z0-9-]+", s.lower()) if t not in STOP]


def retrieve(q, k=2):
    qt = set(tokens(q))
    scored = sorted(CHUNKS, key=lambda c: -len(qt & set(tokens(c["text"]))))
    return [c for c in scored[:k] if qt & set(tokens(c["text"]))]


def generate(q, chunks):
    if not chunks:
        return "I could not find that in the documents."
    best = chunks[0]
    m = re.search(r"\d{4}-\d{2}-\d{2}|\d+ EUR|Tuesdays", best["text"])
    fact = m.group(0) if m else best["text"]
    return f"{fact} [{best['id']}]"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0")) or b"{}"))
        q = str(body.get("q", ""))
        chunks = retrieve(q)
        payload = {
            "answer": generate(q, chunks),
            "chunks": chunks,
            # hone reads this field as the trace: a retrieval span makes rag.* scorers work.
            "_hone": {"spans": [{"id": "r1", "kind": "retrieval", "name": "keyword", "startedAt": "2026-10-12T00:00:00.000Z", "endedAt": "2026-10-12T00:00:00.010Z", "input": q, "output": chunks}]},
        }
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"listening on http://127.0.0.1:{server.server_address[1]}", flush=True)
    server.serve_forever()
