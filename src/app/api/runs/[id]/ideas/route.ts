import { ndjson } from "@/lib/ndjson";
import { suggestProjects } from "@/lib/pipeline";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return ndjson(await suggestProjects(id));
}
