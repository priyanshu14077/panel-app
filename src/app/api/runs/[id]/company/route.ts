import { ndjson } from "@/lib/ndjson";
import { researchCompany } from "@/lib/pipeline";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return ndjson(await researchCompany(id));
}
