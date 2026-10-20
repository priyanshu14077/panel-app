import { connection } from "next/server";
import { evaluateRun } from "@/lib/evals";
import { listRuns, loadRun } from "@/lib/pipeline";

export async function GET() {
  await connection(); // the database is read synchronously; never prerender it
  const runs = await listRuns();
  const rows = [];
  for (const r of runs) {
    const run = await loadRun(r.id);
    rows.push({
      id: r.id,
      createdAt: r.createdAt,
      label: r.synthesis ? `${r.synthesis.job.company} · ${r.synthesis.job.role}` : `${r.id} (failed)`,
      results: await evaluateRun(run),
    });
  }
  return Response.json(rows);
}
