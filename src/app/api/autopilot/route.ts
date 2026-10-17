import { ndjson } from "@/lib/ndjson";
import { autopilot, type AutopilotInput } from "@/lib/pipeline";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AutopilotInput>;
  if (!body.resumeFile || !(body.url?.trim() || body.jobText?.trim())) {
    return Response.json({ error: "resumeFile and a url or jobText are required" }, { status: 400 });
  }
  return ndjson(
    autopilot({
      url: body.url?.trim() || undefined,
      jobText: body.jobText,
      resumeFile: body.resumeFile,
      research: Boolean(body.research),
      outreach: Boolean(body.outreach),
    }),
  );
}
