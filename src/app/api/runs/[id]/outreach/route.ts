import { OUTREACH_TARGETS, draftOutreach } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { target, notes } = (await request.json()) as { target?: string; notes?: string };
  if (!target || !(target in OUTREACH_TARGETS)) {
    return Response.json({ error: `target must be one of ${Object.keys(OUTREACH_TARGETS).join(", ")}` }, { status: 400 });
  }
  try {
    return Response.json(await draftOutreach(id, target as keyof typeof OUTREACH_TARGETS, notes ?? ""));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
