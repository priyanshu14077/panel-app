import { importJob } from "@/lib/import-job";

export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  if (!url?.trim()) return Response.json({ error: "url is required" }, { status: 400 });
  try {
    return Response.json(await importJob(url.trim()));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
