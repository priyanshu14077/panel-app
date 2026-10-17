import { ndjson } from "@/lib/ndjson";
import { addProject, type AddedProject } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = (await request.json()) as Partial<AddedProject>;
  if (!p.name?.trim() || !p.details?.trim()) return Response.json({ error: "name and details are required" }, { status: 400 });
  return ndjson(
    await addProject(id, {
      name: p.name.trim(),
      url: p.url?.trim() ?? "",
      status: p.status === "in progress" ? "in progress" : "built",
      stack: p.stack?.trim() ?? "",
      details: p.details.trim(),
    }),
  );
}
