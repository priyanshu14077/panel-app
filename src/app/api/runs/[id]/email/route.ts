import { EMAIL_KINDS, draftEmail } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { kind, notes } = (await request.json()) as { kind?: string; notes?: string };
  if (!kind || !(kind in EMAIL_KINDS)) return Response.json({ error: `kind must be one of ${Object.keys(EMAIL_KINDS).join(", ")}` }, { status: 400 });
  try {
    return Response.json(await draftEmail(id, kind as keyof typeof EMAIL_KINDS, notes ?? ""));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
