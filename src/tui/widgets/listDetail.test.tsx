import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { ListDetail } from "./listDetail";

describe("ListDetail", () => {
  test("renders items with the selection marker, badges and the detail pane; empty state shows the hint", async () => {
    const setup = await testRender(
      <ListDetail title="codes" items={[{ id: "a", label: "retrieval-miss", badge: "12" }, { id: "b", label: "no-verify", badge: "3" }]} selected={1} detail={<text>definition of no-verify</text>} />,
      { width: 70, height: 8 },
    );
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("codes");
      expect(frame).toMatch(/▶.*no-verify/);
      expect(frame).toContain("12");
      expect(frame).toContain("definition of no-verify");
    } finally {
      setup.renderer.destroy();
    }
    const empty = await testRender(<ListDetail title="codes" items={[]} selected={0} detail={null} empty="run `hone cluster` first" />, { width: 50, height: 5 });
    try {
      await empty.renderOnce();
      expect(empty.captureCharFrame()).toContain("hone cluster");
    } finally {
      empty.renderer.destroy();
    }
  });
});
