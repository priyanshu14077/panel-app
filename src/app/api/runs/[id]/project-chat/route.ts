import { discardProjectChat, projectChatTurn } from "@/lib/pipeline";

type Body = { project?: string; message?: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, message } = (await request.json()) as Body;
  if (!project) return Response.json({ error: "project is required" }, { status: 400 });
  try {
    return Response.json(await projectChatTurn(id, project, message?.trim() || undefined));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project } = (await request.json()) as Body;
  if (!project) return Response.json({ error: "project is required" }, { status: 400 });
  await discardProjectChat(id, project);
  return Response.json({ ok: true });
}
