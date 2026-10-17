import { listRuns } from "@/lib/pipeline";

export async function GET() {
  return Response.json(await listRuns());
}
