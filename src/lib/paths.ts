import path from "node:path";

// The app shares its folders with the /hiring-panel skill, so runs from either
// show up in both. JOB_HUNT_ROOT defaults to the folder this app lives in.
export const ROOT = process.env.JOB_HUNT_ROOT ?? path.resolve(process.cwd(), "..");

export const PROFILE_PATH = path.join(ROOT, "resume", "profile.md");
export const RESUME_DIR = path.join(ROOT, "resume");
export const JOBS_DIR = path.join(ROOT, "job descriptions");
export const PANEL_DIR = path.join(ROOT, ".hiring-panel");
export const IMPROVED_DIR = path.join(ROOT, "improved resume");
export const KNOWLEDGE_DIR = path.join(ROOT, "resume", "knowledge");

// Jake's Resume (MIT), vendored in templates/. RESUME_TEMPLATE overrides it.
export const TEMPLATE_PATH = process.env.RESUME_TEMPLATE ?? path.join(process.cwd(), "templates", "jake-resume.tex");

// Every id that reaches the filesystem goes through this, so a crafted id
// can never escape its parent directory.
export function safeSegment(id: string): string {
  const clean = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!clean) throw new Error(`invalid id: ${id}`);
  return clean;
}
