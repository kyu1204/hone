#!/usr/bin/env python3
"""cases-spec.json = cases.json with each task's written requirements (contracts/<id>.md) inserted into the statement.
The title-only statement stays in cases.json; both are run, so what the requirements are worth is measured."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
cases = json.loads((HERE / "cases.json").read_text())
for c in cases:
    req = (HERE / "contracts" / f"{c['id']}.md").read_text().strip()
    head, env = c["input"].rsplit("\n\nEnvironment:", 1)
    c["input"] = f"{head}\n\nRequirements. The maintainers' tests check exactly this, so follow the names and wording given here:\n{req}\n\nEnvironment:{env}"
(HERE / "cases-spec.json").write_text(json.dumps(cases, indent=1) + "\n")
print(f"wrote cases-spec.json: {len(cases)} cases")
