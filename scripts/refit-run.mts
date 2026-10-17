// Recompiles a saved run's PDF with the current renderer. No Claude calls.
import { promises as fs } from "node:fs";
import { compileFitted } from "../src/lib/pipeline.ts";
import { readProfile } from "../src/lib/files.ts";
import { safeSegment } from "../src/lib/paths.ts";

const [runFile] = process.argv.slice(2);
const run = JSON.parse(await fs.readFile(runFile, "utf8"));
const s = run.synthesis;
const parts = s.job.jobId ? [s.job.jobId, s.job.company, s.job.role] : [s.job.company, s.job.role, run.createdAt.slice(0, 10)];
const folder = safeSegment([...new Set(safeSegment(parts.join("-")).split("-"))].slice(0, 7).join("-"));
run.pdf = await compileFitted(s.resume, await readProfile(), folder);
await fs.writeFile(runFile, JSON.stringify(run, null, 2));
console.log(run.pdf.folder, run.pdf.check.pages, "page(s)");
