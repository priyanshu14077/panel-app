import { ndjson } from "@/lib/ndjson";
import { applyProjectChat } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project } = (await request.json()) as { project?: string };
  if (!project) return Response.json({ error: "project is required" }, { status: 400 });
  return ndjson(await applyProjectChat(id, project));
}
