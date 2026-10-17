import { listJobs, listResumes, readProfile } from "@/lib/files";
import { listRuns } from "@/lib/pipeline";

export async function GET() {
  // Label each improved PDF with the job its latest run was for.
  const labels = new Map<string, string>();
  for (const r of await listRuns()) {
    if (r.pdf && r.synthesis && !labels.has(r.pdf.folder)) labels.set(r.pdf.folder, `${r.synthesis.job.company} · ${r.synthesis.job.role}`);
  }
  const [resumes, jobs, profile] = await Promise.all([listResumes(labels), listJobs(), readProfile()]);
  return Response.json({ resumes, jobs, hasProfile: profile.length > 0, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) });
}
