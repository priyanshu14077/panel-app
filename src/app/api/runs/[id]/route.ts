import { loadRun } from "@/lib/pipeline";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await loadRun(id));
  } catch {
    return Response.json({ error: "run not found" }, { status: 404 });
  }
}
