import { cvOptions } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { refresh } = (await request.json().catch(() => ({}))) as { refresh?: boolean };
  try {
    return Response.json({ options: await cvOptions(id, refresh === true) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
