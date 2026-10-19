import { promises as fs } from "node:fs";
import path from "node:path";
import { loadRun } from "@/lib/pipeline";
import { IMPROVED_DIR, safeSegment } from "@/lib/paths";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await loadRun(id);
    const query = new URL(request.url).searchParams;
    // ?cv serves the CV instead of the one-page resume.
    const doc = query.has("cv") ? run.cv : run.pdf;
    if (!doc) return new Response("no PDF yet", { status: 404 });
    const file = path.join(IMPROVED_DIR, safeSegment(doc.folder), path.basename(doc.file));
    const data = await fs.readFile(file);
    const download = query.has("download");
    return new Response(data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(doc.file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
