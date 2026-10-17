import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IMPROVED_DIR, JOBS_DIR, PROFILE_PATH, RESUME_DIR, safeSegment } from "./paths";

const run = promisify(execFile);

export interface Contact {
  name: string;
  location: string;
  phone: string;
  email: string;
  links: { label: string; url: string }[];
}

export async function readProfile(): Promise<string> {
  try {
    return await fs.readFile(PROFILE_PATH, "utf8");
  } catch {
    return "";
  }
}

// Contact lines in profile.md look like "- Email: x@y.com".
export function parseContact(profile: string): Contact {
  const section = profile.split(/^## /m).find((s) => s.startsWith("Contact")) ?? "";
  const fields = new Map<string, string>();
  for (const m of section.matchAll(/^- ([^:]+):\s*(.+)$/gm)) fields.set(m[1].trim().toLowerCase(), m[2].trim());
  const linkKeys = ["portfolio", "linkedin", "github", "leetcode"];
  return {
    name: fields.get("name") ?? "Your Name",
    location: fields.get("location") ?? "",
    phone: fields.get("phone") ?? "",
    email: fields.get("email") ?? "",
    links: linkKeys.filter((k) => fields.has(k)).map((k) => ({ label: k, url: fields.get(k)! })),
  };
}

// Appends bullet lines under a "## <heading>" section of profile.md, creating it if needed.
export async function appendProfileSection(heading: string, lines: string[]): Promise<void> {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return;
  let profile = await readProfile();
  const marker = `## ${heading}`;
  if (!profile.includes(marker)) profile = `${profile.trimEnd()}\n\n${marker}\n`;
  const at = profile.indexOf(marker) + marker.length;
  const next = profile.indexOf("\n## ", at);
  const end = next === -1 ? profile.length : next;
  const section = `${profile.slice(at, end).trimEnd()}\n${clean.map((l) => `- ${l}`).join("\n")}\n`;
  await fs.writeFile(PROFILE_PATH, `${profile.slice(0, at)}${section}${profile.slice(end)}`.trimEnd() + "\n");
}

// A resume the panel can review: one of your own PDFs in resume/, or a PDF
// the pipeline compiled into improved resume/<job>/. Ids are
// "base:<file.pdf>" and "improved:<folder>"; a bare file name is a legacy
// base id from runs made before improved PDFs could be reviewed.
export interface ResumeOption {
  id: string;
  group: "base" | "improved";
  label: string;
  folder?: string;
  updatedAt: string;
}

const isPdf = (n: string) => n.toLowerCase().endsWith(".pdf");

export function improvedFolderOf(id: string): string | null {
  return id.startsWith("improved:") ? id.slice("improved:".length) : null;
}

async function improvedPdf(folder: string): Promise<string | null> {
  if (safeSegment(folder) !== folder) return null; // never leave improved resume/
  try {
    // Local-only app reading the user's own folders, so tracing doesn't matter.
    const name = (await fs.readdir(path.join(/*turbopackIgnore: true*/ IMPROVED_DIR, folder))).find(isPdf);
    return name ? path.join(/*turbopackIgnore: true*/ IMPROVED_DIR, folder, name) : null;
  } catch {
    return null;
  }
}

export async function resumePath(id: string): Promise<string> {
  const folder = improvedFolderOf(id);
  if (folder !== null) {
    const pdf = await improvedPdf(folder);
    if (!pdf) throw new Error(`No compiled PDF in improved resume/${folder}`);
    return pdf;
  }
  const name = path.basename(id.replace(/^base:/, "")); // never leave resume/
  return path.join(RESUME_DIR, name);
}

// Base resumes A-Z, then improved PDFs newest first. `labels` maps an improved
// folder to the job it was built for ("LimeChat · SDE").
export async function listResumes(labels: Map<string, string> = new Map()): Promise<ResumeOption[]> {
  const base: ResumeOption[] = [];
  for (const name of (await fs.readdir(RESUME_DIR)).filter(isPdf).sort()) {
    const stat = await fs.stat(path.join(RESUME_DIR, name));
    base.push({ id: `base:${name}`, group: "base", label: name, updatedAt: stat.mtime.toISOString() });
  }
  const improved: ResumeOption[] = [];
  let folders: string[] = [];
  try {
    folders = await fs.readdir(IMPROVED_DIR);
  } catch {}
  for (const folder of folders) {
    const pdf = await improvedPdf(folder);
    if (!pdf) continue;
    const stat = await fs.stat(/*turbopackIgnore: true*/ pdf);
    improved.push({
      id: `improved:${folder}`,
      group: "improved",
      label: labels.get(folder) ?? folder,
      folder,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  improved.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...base, ...improved];
}

export async function resumeText(id: string): Promise<string> {
  const { stdout } = await run("pdftotext", ["-layout", await resumePath(id), "-"]);
  return stdout;
}

export interface SavedJob {
  folder: string;
  text: string;
}

export async function listJobs(): Promise<SavedJob[]> {
  let folders: string[] = [];
  try {
    folders = await fs.readdir(JOBS_DIR);
  } catch {
    return [];
  }
  const jobs: SavedJob[] = [];
  for (const folder of folders.sort()) {
    for (const file of ["job_description.md", "raw_jd.txt"]) {
      try {
        // Local-only app reading the user's own folders, so tracing doesn't matter.
        jobs.push({ folder, text: await fs.readFile(path.join(/*turbopackIgnore: true*/ JOBS_DIR, folder, file), "utf8") });
        break;
      } catch {}
    }
  }
  return jobs;
}
