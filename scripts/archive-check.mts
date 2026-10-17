// Compiles the same run's resume twice into one folder and lists what is kept.
// Pass a run.json; set JOB_HUNT_ROOT to a scratch folder. No Claude calls.
import { promises as fs } from "node:fs";
import path from "node:path";
import { compileFitted } from "../src/lib/pipeline.ts";
import { readProfile } from "../src/lib/files.ts";
import { IMPROVED_DIR } from "../src/lib/paths.ts";

const run = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
for (let i = 0; i < 2; i++) {
  const out = await compileFitted(run.synthesis.resume, await readProfile(), "archive-check");
  console.log(`compile ${i + 1}: ${out.check.pages} page(s)`);
  await new Promise((r) => setTimeout(r, 1100)); // distinct mtimes for the archive names
}
const dir = path.join(IMPROVED_DIR, "archive-check");
console.log("folder:", (await fs.readdir(dir)).sort().join(", "));
console.log("archive:", (await fs.readdir(path.join(dir, "archive"))).join(", "));
