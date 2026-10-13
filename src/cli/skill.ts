// The skill hone installs for coding agents and prints with `hone guide`: a short router and one reference per topic.
// The files under skills/hone are the source; they are embedded so the compiled CLI carries them.
import skill from "../../skills/hone/SKILL.md" with { type: "text" };
import cases from "../../skills/hone/references/cases.md" with { type: "text" };
import mcp from "../../skills/hone/references/mcp.md" with { type: "text" };
import results from "../../skills/hone/references/results.md" with { type: "text" };
import setup from "../../skills/hone/references/setup.md" with { type: "text" };
import sharpening from "../../skills/hone/references/sharpening.md" with { type: "text" };
import steps from "../../skills/hone/references/steps.md" with { type: "text" };

/** In the order the skill's table lists them. */
export const TOPICS = ["setup", "cases", "sharpening", "results", "steps", "mcp"] as const;

const REFERENCES: Record<(typeof TOPICS)[number], string> = { setup, cases, sharpening, results, steps, mcp };

/** Every file of the skill, by its path inside the skill directory. */
export const SKILL_FILES: Record<string, string> = { "SKILL.md": skill, ...Object.fromEntries(TOPICS.map((t) => [`references/${t}.md`, REFERENCES[t]])) };

/** The skill itself, or one topic of it; undefined for a topic that does not exist. */
export function guide(topic?: string): string | undefined {
  return topic === undefined ? skill : (REFERENCES as Record<string, string | undefined>)[topic];
}
