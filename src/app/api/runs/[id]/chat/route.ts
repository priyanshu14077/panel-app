import { ndjson } from "@/lib/ndjson";
import { chat, clearChat } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { message } = (await request.json()) as { message?: string };
  if (!message?.trim()) return Response.json({ error: "message is required" }, { status: 400 });
  return ndjson(chat(id, message.trim()));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await clearChat(id);
  return Response.json({ ok: true });
}
