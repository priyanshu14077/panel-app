import { ndjson } from "@/lib/ndjson";
import { runPanel } from "@/lib/pipeline";

export async function POST(request: Request) {
  const { jobText, resumeFile } = (await request.json()) as { jobText?: string; resumeFile?: string };
  if (!jobText?.trim() || !resumeFile) {
    return Response.json({ error: "jobText and resumeFile are required" }, { status: 400 });
  }
  return ndjson(runPanel({ jobText, resumeFile }));
}
