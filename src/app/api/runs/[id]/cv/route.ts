import { ndjson } from "@/lib/ndjson";
import { createCv } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { picks } = (await request.json()) as { picks?: unknown };
  if (!Array.isArray(picks) || !picks.every((p) => typeof p === "string")) return Response.json({ error: "picks must be a list of ids" }, { status: 400 });
  return ndjson(await createCv(id, picks));
}
