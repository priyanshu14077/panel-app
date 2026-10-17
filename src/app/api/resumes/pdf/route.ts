import { promises as fs } from "node:fs";
import path from "node:path";
import { resumePath } from "@/lib/files";

// Serves a base or improved resume PDF by id (?id=base:x.pdf or ?id=improved:<folder>).
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("id is required", { status: 400 });
  try {
    const file = await resumePath(id);
    return new Response(await fs.readFile(file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${path.basename(file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
