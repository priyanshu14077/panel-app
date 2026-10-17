import { updateBoard } from "@/lib/pipeline";
import type { Stage, Writeup } from "@/lib/schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = (await request.json()) as { stage?: Stage; notes?: string; sent?: Partial<Record<Writeup, string | null>> };
  try {
    return Response.json(await updateBoard(id, patch));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
