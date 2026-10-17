import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PdfCheck {
  pages: number;
  placeholders: string[];
  links: string[];
}

export function pdfName(candidate: string): string {
  return `${candidate.trim().split(/\s+/).join("_")}_Resume.pdf`;
}

// Compiles resume.tex in `dir` with tectonic, renames the PDF, and runs the
// same checks as step 8 of the skill.
export async function compileResume(dir: string, tex: string, candidate: string): Promise<{ pdf: string; check: PdfCheck }> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "resume.tex"), tex);
  try {
    await run("tectonic", ["-X", "compile", "resume.tex"], { cwd: dir, timeout: 300_000 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    const lines = stderr.split("\n").filter((l) => /error|^!/.test(l));
    throw new Error(`LaTeX compile failed: ${lines.slice(0, 5).join(" | ") || stderr.slice(-400)}`);
  }
  const pdf = path.join(dir, pdfName(candidate));
  await fs.rename(path.join(dir, "resume.pdf"), pdf);

  const info = (await run("pdfinfo", [pdf])).stdout;
  const text = (await run("pdftotext", [pdf, "-"])).stdout;
  const urls = (await run("pdfinfo", ["-url", pdf])).stdout;
  return {
    pdf,
    check: {
      pages: Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0),
      placeholders: text.match(/\[ADD[^\]]*\]?|TODO|REPLACE/g) ?? [],
      links: [...new Set(urls.split("\n").slice(1).map((l) => l.trim().split(/\s+/)[2]).filter(Boolean))],
    },
  };
}
