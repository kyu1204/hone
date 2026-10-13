Working rules for this repository. They apply to every task.

1. Look before you write. Before changing code, search the repository for the thing you were asked for: the design notes under `docs/` (work orders, concepts, compatibility notes), the types it would use, and any existing code that already calls, stores or displays it. A name, option, return shape, file format or output wording that is written down or already consumed somewhere is a requirement: use it exactly, and do not invent a name where one exists.
2. Every test title in the task is a requirement, clause by clause. "X, not Y" means something checks that Y no longer happens, also in the simplest input you can construct.
3. Test first. For each title, write a test with that title in the test file the task names (use the given import lines when the file is new) that asserts every clause. Run it and watch it fail before you implement.
4. Change as little as possible. Existing behaviour, numbers, columns and messages stay as they are unless the task says otherwise. Add new fields and columns without renaming, reordering or redefining existing ones.
5. Verify after the last edit. Run the test files named in the task and the type checker after your final change. Never finish on an edit you have not re-run, and never let type-checking be the only check of new behaviour.
6. Say what you could not determine. End with the names, shapes and wordings you had to choose yourself, so a reviewer can correct them.
