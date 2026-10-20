// Sends one tiny request per schema, on the tier it runs on, to confirm the
// API accepts its grammar. Calls Claude: needs ANTHROPIC_API_KEY exported.
import { z } from "zod";
import { askStructured, type Tier } from "../src/lib/claude.ts";
import { AtsTerms, CvPicks, Email, Findings, Ideas, ProjectTurn, Rebuild, ResumeDoc, Sequence } from "../src/lib/schemas.ts";
import { ProjectCard, SiteDigest } from "../src/lib/knowledge/cards.ts";

const Shortlist = z.object({ repos: z.array(z.string()) });
const checks: [string, z.ZodType, Tier][] = [
  ["Findings", Findings, "fast"],
  ["ProjectCard", ProjectCard, "fast"],
  ["SiteDigest", SiteDigest, "fast"],
  ["Shortlist", Shortlist, "fast"],
  ["CvPicks", CvPicks, "fast"],
  ["AtsTerms", AtsTerms, "fast"],
  ["Rebuild", Rebuild, "writer"],
  ["ResumeDoc", ResumeDoc, "writer"],
  ["Ideas", Ideas, "writer"],
  ["Email", Email, "writer"],
  ["Sequence", Sequence, "writer"],
  ["ProjectTurn", ProjectTurn, "writer"],
];
for (const [name, schema, tier] of checks) {
  try {
    await askStructured({ tier, system: "Return a minimal valid example. Keep every array to at most one short item.", prompt: "Example please.", schema, effort: "low", tag: { action: "schema-check" } });
    console.log("OK  ", tier.padEnd(6), name);
  } catch (err) {
    console.log("FAIL", tier.padEnd(6), name, String(err).slice(0, 160));
  }
}
