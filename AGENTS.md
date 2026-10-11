<!-- oh-my-harness:start:branch-workflow -->
## 브랜치 작업 규칙
- 모든 변경은 새 작업 브랜치에서 진행한다.
- main 또는 master 브랜치에 직접 커밋하지 않는다.
- 작업을 시작하거나 커밋하기 전에 현재 브랜치가 이미 머지되었는지 확인한다.
- 이미 머지된 브랜치에서는 추가 작업이나 커밋을 하지 않고 새 브랜치를 만든다.

<!-- oh-my-harness:end:branch-workflow -->


<!-- oh-my-harness:start:tdd-workflow -->
## TDD 규칙
- 구현 코드를 수정하기 전에 실패하는 테스트를 먼저 작성하거나 수정한다.
- 테스트 실패를 확인한 뒤 테스트를 통과시키는 최소한의 구현만 추가한다.
- 테스트가 통과한 상태에서만 리팩터링한다.
- 버그 수정 시에는 해당 버그를 재현하는 회귀 테스트를 먼저 추가한다.

<!-- oh-my-harness:end:tdd-workflow -->


<!-- oh-my-harness:start:atomic-commits -->
## 원자적 커밋 규칙
- 각 커밋은 하나의 논리적 변경만 포함한다.
- 기능 변경, 리팩터링, 포맷팅, 문서 변경을 가능하면 별도 커밋으로 분리한다.
- 모든 커밋은 독립적으로 이해할 수 있고 테스트 가능한 상태여야 한다.
- 관련 없는 파일이나 변경을 같은 커밋에 포함하지 않는다.
- 커밋 메시지는 변경의 목적을 명확하게 설명한다.

<!-- oh-my-harness:end:atomic-commits -->


<!-- oh-my-harness:start:omh-loop-protocol -->
## Autonomous Loop Protocol

The autonomous loop runs one work order per fresh session. `WORKPLAN.md` is the single source of truth.

- Read `WORKPLAN.md` first; it is the single source of truth.
- Pick the next unchecked task and implement it exactly as its work order in `docs/work-orders/<ID>.md` says. Make no design decisions.
- No work order, no work: mark the task "BLOCKED: no work order" and stop. Never write your own work order.
- Run the work order's acceptance commands before ticking any checkbox.
- Architect-only, never edited by the loop: none declared — add paths to `loop.architectOnly` in harness.yaml.
- If a task needs a human, or after three failed attempts, mark it "BLOCKED: <reason>" and move on. Never idle waiting for a person.
- One task, one commit; update the checkbox and the progress log in the same commit.
- Print exactly OMH_GOAL_COMPLETE as the final line ONLY when every task is done and verified; otherwise never mention that string in any form.

Start: `omh loop start`
Watch: `omh loop status`, then `tail -f .omh/state/loop/runs/<runId>/events.jsonl`
Stop: `omh loop stop` (`--now` to skip the grace period)
<!-- oh-my-harness:end:omh-loop-protocol -->
