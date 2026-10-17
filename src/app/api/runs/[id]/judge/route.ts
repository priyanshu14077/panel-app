import { evaluateRun, runJudge } from "@/lib/evals";
import { loadRun } from "@/lib/pipeline";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await runJudge(await loadRun(id));
    return Response.json(await evaluateRun(await loadRun(id)));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
