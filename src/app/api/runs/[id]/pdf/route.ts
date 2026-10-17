import { promises as fs } from "node:fs";
import path from "node:path";
import { loadRun } from "@/lib/pipeline";
import { IMPROVED_DIR, safeSegment } from "@/lib/paths";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await loadRun(id);
    if (!run.pdf) return new Response("no PDF yet", { status: 404 });
    const file = path.join(IMPROVED_DIR, safeSegment(run.pdf.folder), path.basename(run.pdf.file));
    const data = await fs.readFile(file);
    const download = new URL(request.url).searchParams.has("download");
    return new Response(data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(run.pdf.file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
