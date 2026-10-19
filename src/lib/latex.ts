import { promises as fs } from "node:fs";
import { NEEDS, type ResumeDoc } from "./schemas";
import type { Contact } from "./files";
import { TEMPLATE_PATH } from "./paths";

// Lines that still wait on an unanswered question never reach the PDF.
const known = (lines: string[]) => lines.filter((l) => !NEEDS.test(l));

export function escapeTex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\s+--\s+/g, " -- ");
}

// "https://www.github.com/x/" -> "github.com/x": what a parser and a reader see.
export function displayUrl(url: string): string {
  return url.replace(/^mailto:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

const href = (url: string, text: string, underline = true) =>
  `\\href{${url.replace(/([%#])/g, "\\$1")}}{${underline ? `\\underline{${escapeTex(text)}}` : escapeTex(text)}}`;

function itemList(lines: string[]): string {
  if (!lines.length) return "";
  return `      \\resumeItemListStart\n${lines.map((l) => `        \\resumeItem{${escapeTex(l)}}`).join("\n")}\n      \\resumeItemListEnd\n`;
}

// Name, then the target role title, then contact. Location sits at the end of
// the links line so the line under the name reads as the role.
function heading(c: Contact, headline: string): string {
  const first = [escapeTex(c.phone), c.email && href(`mailto:${c.email}`, c.email)];
  const portfolio = c.links.find((l) => l.label === "portfolio");
  if (portfolio) first.push(href(portfolio.url, displayUrl(portfolio.url)));
  const second = [...c.links.filter((l) => l.label !== "portfolio").map((l) => href(l.url, displayUrl(l.url))), escapeTex(c.location)];
  const title = headline.trim() ? `    \\large ${escapeTex(headline.trim())} \\\\ \\vspace{2pt}\n` : "";
  return `\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeTex(c.name)}} \\\\ \\vspace{1pt}
${title}    \\small ${first.filter(Boolean).join(" $|$ ")} \\\\
    ${second.filter(Boolean).join(" $|$\n    ")}
\\end{center}
`;
}

function section(doc: ResumeDoc, name: ResumeDoc["order"][number]): string {
  switch (name) {
    case "education":
      if (!doc.education.length) return "";
      return `\\section{Education}\n  \\resumeSubHeadingListStart\n${doc.education
        .map(
          (e) =>
            `    \\resumeSubheading\n      {${escapeTex(e.school)}}{${escapeTex(e.location)}}\n      {${escapeTex(e.degree)}}{${escapeTex(e.dates)}}\n${itemList(known(e.details))}`,
        )
        .join("")}  \\resumeSubHeadingListEnd\n\n`;
    case "experience":
      if (!doc.experience.length) return "";
      return `\\section{Experience}\n  \\resumeSubHeadingListStart\n${doc.experience
        .map((x) => {
          const company = x.url ? href(x.url, x.company, false) : escapeTex(x.company);
          return `    \\resumeSubheading\n      {${escapeTex(x.title)}}{${escapeTex(x.dates)}}\n      {${company}}{${escapeTex(x.location)}}\n${itemList(known(x.bullets))}`;
        })
        .join("")}  \\resumeSubHeadingListEnd\n\n`;
    case "projects":
      if (!doc.projects.length) return "";
      return `\\section{Projects}\n    \\resumeSubHeadingListStart\n${doc.projects
        .map((p) => {
          // No underline here: it collides with the first bullet below.
          const link = p.url ? href(p.url, displayUrl(p.url), false) : "";
          // A long stack runs into the right-aligned link; four is what fits.
          const stack = p.stack.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4).join(", ");
          return `      \\resumeProjectHeading\n          {\\textbf{${escapeTex(p.name)}} $|$ \\emph{${escapeTex(stack)}}}{${link}}\n${itemList(known(p.bullets))}`;
        })
        .join("")}    \\resumeSubHeadingListEnd\n\n`;
    case "skills": {
      const rows = doc.skills
        .map((s) => ({ label: s.label, items: known(s.items) }))
        .filter((s) => s.items.length);
      if (!rows.length) return "";
      return `\\section{Technical Skills}\n \\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n${rows
        .map((s) => `     \\textbf{${escapeTex(s.label)}}{: ${escapeTex(s.items.join(", "))}}`)
        .join(" \\\\\n")}\n    }}\n \\end{itemize}\n\n`;
    }
  }
}

export async function renderLatex(doc: ResumeDoc, contact: Contact): Promise<string> {
  const template = await fs.readFile(TEMPLATE_PATH, "utf8");
  const preamble = template.slice(0, template.indexOf("\\begin{document}") + "\\begin{document}".length);
  const summary = known(doc.summary).join(" ");
  const body = [
    heading(contact, doc.headline),
    summary ? `\\section{Summary}\n\\small{${escapeTex(summary)}}\n\n` : "",
    ...doc.order.map((s) => section(doc, s)),
  ].join("\n");
  return `${preamble}\n\n${body}\\end{document}\n`;
}

// Plain-text version for the re-screen and for RESUME-IMPROVED.md.
export function renderText(doc: ResumeDoc, contact: Contact, includeOpen: boolean): string {
  const pick = (lines: string[]) =>
    lines.filter((l) => includeOpen || !NEEDS.test(l)).map((l) => l.replace(NEEDS, "[needs: $1]"));
  const out: string[] = [
    `# ${contact.name}`,
    doc.headline,
    [contact.phone, contact.email, ...contact.links.map((l) => displayUrl(l.url)), contact.location].filter(Boolean).join(" · "),
  ];
  const summary = pick(doc.summary);
  if (summary.length) out.push("", "## Summary", summary.join(" "));
  for (const s of doc.order) {
    if (s === "education" && doc.education.length) {
      out.push("", "## Education");
      for (const e of doc.education) out.push(`${e.school}, ${e.location} — ${e.degree} · ${e.dates}`, ...pick(e.details).map((d) => `- ${d}`));
    }
    if (s === "experience" && doc.experience.length) {
      out.push("", "## Experience");
      for (const x of doc.experience)
        out.push("", `**${x.company}** — ${x.title} · ${x.location} · ${x.dates}`, ...pick(x.bullets).map((b) => `- ${b}`));
    }
    if (s === "projects" && doc.projects.length) {
      out.push("", "## Projects");
      for (const p of doc.projects)
        out.push("", `**${p.name}** — ${p.stack}${p.url ? ` · ${displayUrl(p.url)}` : ""}`, ...pick(p.bullets).map((b) => `- ${b}`));
    }
    if (s === "skills" && doc.skills.length) {
      out.push("", "## Technical Skills");
      for (const k of doc.skills) {
        const items = pick(k.items);
        if (items.length) out.push(`- **${k.label}:** ${items.join(", ")}`);
      }
    }
  }
  return out.join("\n");
}
