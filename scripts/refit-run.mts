// Recompiles a saved run's PDF with the current renderer, after the
// deterministic resume checks (tense, links, repeats, counts). No Claude calls.
// Pass run ids, or --all for every run with a PDF.
import { allRuns, getRun, putRun } from "../src/lib/db.ts";
import { compileFitted } from "../src/lib/pipeline.ts";
import { readProfile } from "../src/lib/files.ts";
import { knownUrls, tidy } from "../src/lib/guardrails.ts";
import { loadKnowledge } from "../src/lib/knowledge/cards.ts";

const args = process.argv.slice(2);
const ids = args[0] === "--all" ? allRuns().filter((r) => r.pdf && r.synthesis).map((r) => r.id) : args;
const profile = await readProfile();
const urls = knownUrls(profile, JSON.stringify((await loadKnowledge()) ?? {}));
for (const id of ids) {
  const run = getRun(id);
  if (!run?.synthesis || !run.pdf) {
    console.log(id, "no rebuilt resume");
    continue;
  }
  const { doc, fixed } = tidy(run.synthesis.resume, "Resume", { today: new Date(), urls });
  run.synthesis.resume = doc;
  run.pdf = await compileFitted(doc, profile, run.pdf.folder);
  putRun(run);
  console.log(run.pdf.folder, run.pdf.check.pages, "page(s),", fixed.length, "fixes");
}
