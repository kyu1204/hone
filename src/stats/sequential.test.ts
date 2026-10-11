import { describe, expect, test } from "bun:test";
import { mulberry32 } from "./dist";
import { nextCell, shouldStop } from "./sequential";

describe("sequential stopping", () => {
  test("a unanimous cell stops on width, a mixed cell runs to maxTrials, minTrials is honoured", () => {
    expect(shouldStop({ successes: 1, n: 1, maxTrials: 10, ciWidth: 0.3 }).stop).toBe(false);
    const sure = shouldStop({ successes: 10, n: 10, maxTrials: 20, ciWidth: 0.3 });
    expect(sure).toMatchObject({ stop: true, reason: "ci-width" });
    expect(sure.width).toBeLessThan(0.3);
    const mixed = shouldStop({ successes: 5, n: 10, maxTrials: 10, ciWidth: 0.3 });
    expect(mixed).toMatchObject({ stop: true, reason: "max-trials" });
    expect(shouldStop({ successes: 5, n: 9, maxTrials: 10, ciWidth: 0.3 }).stop).toBe(false);
  });

  test("nextCell prefers the widest interval among cells that may still run", () => {
    const cells = [
      { key: "sure", successes: 10, n: 10, maxTrials: 20 },
      { key: "wide", successes: 2, n: 4, maxTrials: 20 },
      { key: "done", successes: 3, n: 6, maxTrials: 6 },
      { key: "fresh", successes: 0, n: 0, maxTrials: 20 },
    ];
    expect(nextCell(cells, 0.3)?.key).toBe("fresh");
    expect(nextCell(cells.filter((c) => c.key !== "fresh"), 0.3)?.key).toBe("wide");
    expect(nextCell([cells[0]!, cells[2]!], 0.3)).toBeUndefined();
  });

  test("adaptive sampling converges with fewer trials than a fixed budget", () => {
    const rand = mulberry32(7);
    const rates = [0.95, 0.5, 0.05, 0.9, 0.1];
    const cells = rates.map((_, i) => ({ key: String(i), successes: 0, n: 0, maxTrials: 20 }));
    let total = 0;
    for (;;) {
      const c = nextCell(cells, 0.35);
      if (!c) break;
      c.n++;
      total++;
      if (rand() < rates[Number(c.key)]!) c.successes++;
    }
    expect(total).toBeLessThan(rates.length * 20);
    for (const c of cells) expect(c.n).toBeGreaterThanOrEqual(2);
  });
});
