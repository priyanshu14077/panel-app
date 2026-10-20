import { connection } from "next/server";
import { listRuns } from "@/lib/pipeline";

export async function GET() {
  await connection(); // the database is read synchronously; never prerender it
  return Response.json(await listRuns());
}
