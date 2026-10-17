import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JOBS_DIR, PROFILE_PATH, RESUME_DIR } from "./paths";

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

export async function listResumes(): Promise<string[]> {
  const names = await fs.readdir(RESUME_DIR);
  return names.filter((n) => n.toLowerCase().endsWith(".pdf")).sort();
}

export async function resumeText(file: string): Promise<string> {
  const name = path.basename(file); // never leave the resume folder
  const { stdout } = await run("pdftotext", ["-layout", path.join(RESUME_DIR, name), "-"]);
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
