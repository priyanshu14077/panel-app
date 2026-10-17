import { setIncluded } from "@/lib/knowledge/cards";

export async function POST(request: Request) {
  const { fullName, included } = (await request.json()) as { fullName?: string; included?: boolean };
  if (!fullName || typeof included !== "boolean") return Response.json({ error: "fullName and included are required" }, { status: 400 });
  try {
    await setIncluded(fullName, included);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
