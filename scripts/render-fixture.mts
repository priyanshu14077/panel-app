// Offline check of the JSON -> LaTeX -> PDF path. No API calls.
import path from "node:path";
import os from "node:os";
import { renderLatex } from "../src/lib/latex.ts";
import { compileResume } from "../src/lib/compile.ts";
import type { Contact } from "../src/lib/files.ts";
import type { ResumeDoc } from "../src/lib/schemas.ts";

const doc: ResumeDoc = {
  headline: "Backend & GenAI Engineer",
  summary: ["Backend engineer shipping FastAPI & RAG systems; cut cost 40% on Cloud Run."],
  order: ["experience", "projects", "skills", "education"],
  education: [{ school: "State University", location: "Springfield", degree: "B.Tech, Computer Science -- GPA 8.0/10.0", dates: "Jun 2026", details: [] }],
  experience: [{
    title: "Backend Engineer & Team Lead", company: "Acme Analytics", url: "https://acme.example",
    location: "Remote", dates: "Oct 2025 -- Present",
    bullets: [
      "Drove PostgreSQL search to sub-50 ms p95 with GIN indexes & RLS (100% of queries).",
      "Ran CI on GitHub Actions for every PR. [[needs:ci-cd-tool]]",
    ],
  }],
  projects: [{ name: "Taxops", stack: "FastAPI, Alembic", url: "https://github.com/octocat/hello-world", bullets: ["Stored money as integer paise, e.g. user_id #42 ~ safe."] }],
  skills: [{ label: "Languages", items: ["Python", "C++ [[needs:cpp]]"] }],
};

const dir = path.join(os.tmpdir(), "panel-fixture");
const contact: Contact = {
  name: "Jane Doe",
  location: "Springfield",
  phone: "+1-555-0100",
  email: "jane@example.com",
  links: [{ label: "github", url: "https://github.com/octocat" }],
};
const tex = await renderLatex(doc, contact);
const { pdf, check } = await compileResume(dir, tex, "Jane Doe");
console.log(pdf, JSON.stringify(check));
