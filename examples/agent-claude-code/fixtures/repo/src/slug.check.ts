import { expect, test } from "bun:test";
import { slugify } from "./slug";

test("collapses separators and trims dashes", () => {
  expect(slugify("Hello,  World!")).toBe("hello-world");
  expect(slugify("  Spaces  ")).toBe("spaces");
});
