# rag-python

A retrieval-augmented QA service (standard-library Python, no pip) and a hone config that scores it on retrieval recall, citation validity and the expected answer.

```bash
cd examples/rag-python
python3 app.py &            # POST /ask {"q": "..."} -> {"answer", "chunks", "_hone": {spans}}
hone run && hone matrix
hone calibrate --scorer rag.citations   # what the citation check actually catches
```

The service puts a `retrieval` span in the `_hone` field of its response; that is all hone needs for `rag.recall`, `rag.precision`, `rag.citations` and `rag.faithfulness` (the last one needs a Jev key). Cases carry `expected.chunks` (ids that should be retrieved) and `expected.answer`.

`start.ts` boots the server on a free port and prints `RAG_URL=...`; the config reads `RAG_URL`.
