import { listJobs, listResumes, readProfile } from "@/lib/files";

export async function GET() {
  const [resumes, jobs, profile] = await Promise.all([listResumes(), listJobs(), readProfile()]);
  return Response.json({ resumes, jobs, hasProfile: profile.length > 0, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) });
}
