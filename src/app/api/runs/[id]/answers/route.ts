import { ndjson } from "@/lib/ndjson";
import { answerQuestions } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { answers } = (await request.json()) as { answers?: Record<string, string> };
  if (!answers) return Response.json({ error: "answers are required" }, { status: 400 });
  return ndjson(await answerQuestions(id, answers));
}
