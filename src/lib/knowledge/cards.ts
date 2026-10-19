import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { askStructured } from "../claude";
import type { UsageTag } from "../usage";
import { parseContact, readProfile } from "../files";
import { KNOWLEDGE_DIR } from "../paths";
import { collectRepo, collectSite, githubLogin, listRepos, type RepoMeta } from "./collect";

// What one repo proves about the candidate, distilled from its README,
// manifests and languages. Every claim must be traceable to that material.
export const ProjectCard = z.object({
  summary: z.string().describe("One sentence: what this project is and does."),
  kind: z.enum(["product", "client-work", "tool-or-library", "learning", "assignment", "template-or-copy"]),
  maturity: z.enum(["prototype", "working", "production"]),
  maturityEvidence: z.string().describe("What in the material shows the maturity, e.g. 'README links a live deployment'."),
  stack: z.array(z.string()),
  skills: z.array(z.object({ skill: z.string(), evidence: z.string() })).describe("Skills this repo demonstrates, each with the concrete evidence."),
  resumeLines: z.array(z.string()).describe("2-4 resume-ready bullets using only facts in the material. No invented numbers."),
  metrics: z.array(z.string()).describe("Numbers the material itself states, quoted. Empty if none."),
  openQuestions: z.array(z.string()).describe("Facts the candidate could add to make this stronger, e.g. users, scale, latency."),
});
export type ProjectCard = z.infer<typeof ProjectCard>;

export const SiteDigest = z.object({
  positioning: z.string().describe("How the candidate presents themselves, in one or two sentences."),
  claims: z.array(z.string()).describe("Factual claims the site makes about the candidate's work and results."),
  pages: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      summary: z.string(),
      technicalFacts: z.array(z.string()).describe("Specific technical details, designs or results described on the page."),
    }),
  ),
});
export type SiteDigest = z.infer<typeof SiteDigest>;

export interface RepoEntry {
  meta: RepoMeta;
  languages: string[];
  userCommits: number;
  card: ProjectCard | null;
  cardFor: string; // pushedAt the card was built from; a newer push rebuilds it
  included: boolean;
}

export interface Knowledge {
  builtAt: string;
  login: string;
  site: (SiteDigest & { url: string; fetchedAt: string }) | null;
  repos: Record<string, RepoEntry>;
}

const JSON_PATH = path.join(KNOWLEDGE_DIR, "knowledge.json");
const MD_PATH = path.join(KNOWLEDGE_DIR, "knowledge.md");

export async function loadKnowledge(): Promise<Knowledge | null> {
  try {
    return JSON.parse(await fs.readFile(JSON_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function saveKnowledge(k: Knowledge): Promise<void> {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  await fs.writeFile(JSON_PATH, JSON.stringify(k, null, 2));
  await fs.writeFile(MD_PATH, knowledgeMarkdown(k));
}

const CARD_SYSTEM = `You read one of a software engineer's GitHub repositories and write down what it proves about them, for later use when tailoring their resume. Use ONLY the material given: README, manifests, file list, languages and commit count. Never invent users, metrics, employers or results. If the README is thin, say less. When the candidate has few or no commits, or the repo looks copied from a template or course, choose kind "template-or-copy" or "learning" and keep the claims modest.`;

const SITE_SYSTEM = `You read the rendered text of a software engineer's portfolio website and record what it says about them: positioning, factual claims about their work and results, and the technical substance of each page (case studies and blog posts especially). Quote numbers exactly as the site states them. Do not add anything the site does not say.`;

export type KnowledgeEvent =
  | { type: "stage"; stage: string }
  | { type: "repo"; name: string; status: "built" | "cached" | "skipped" | "failed"; detail?: string }
  | { type: "done"; summary: { repos: number; included: number; sitePages: number } }
  | { type: "error"; message: string };

export async function* refreshKnowledge(): AsyncGenerator<KnowledgeEvent> {
  try {
    const previous = await loadKnowledge();
    const login = await githubLogin();
    yield { type: "stage", stage: `Listing repos for ${login} and their orgs` };
    const metas = await listRepos(login);
    const k: Knowledge = { builtAt: new Date().toISOString(), login, site: previous?.site ?? null, repos: {} };

    yield { type: "stage", stage: `Reading ${metas.length} repos` };
    const processOne = async (meta: RepoMeta): Promise<KnowledgeEvent> => {
      const old = previous?.repos[meta.fullName];
      if (old?.card && old.cardFor === meta.pushedAt) {
        k.repos[meta.fullName] = { ...old, meta };
        return { type: "repo", name: meta.fullName, status: "cached" };
      }
      try {
        const material = await collectRepo(meta, login);
        const languages = Object.keys(material.languages);
        const hasContent = material.readme || Object.keys(material.manifests).length || material.rootFiles.length > 2;
        const entry: RepoEntry = {
          meta,
          languages,
          userCommits: material.userCommits,
          card: null,
          cardFor: meta.pushedAt,
          // Keep the user's own choice across refreshes; default to repos they committed to.
          included: old ? old.included : material.userCommits > 0,
        };
        if (hasContent) {
          entry.card = await askStructured({
            system: CARD_SYSTEM,
            prompt: repoPrompt(meta, material, languages),
            schema: ProjectCard,
            effort: "low",
            tier: "fast", tag: { action: "knowledge:repo" },
          });
        }
        k.repos[meta.fullName] = entry;
        return entry.card
          ? { type: "repo", name: meta.fullName, status: "built" }
          : { type: "repo", name: meta.fullName, status: "skipped", detail: "empty repo" };
      } catch (err) {
        if (old) k.repos[meta.fullName] = old;
        return { type: "repo", name: meta.fullName, status: "failed", detail: err instanceof Error ? err.message : String(err) };
      }
    };
    // Four at a time, reporting each batch as it lands.
    for (let i = 0; i < metas.length; i += 4) {
      for (const e of await Promise.all(metas.slice(i, i + 4).map(processOne))) yield e;
    }

    const siteUrl = parseContact(await readProfile()).links.find((l) => l.label === "portfolio")?.url;
    if (siteUrl) {
      yield { type: "stage", stage: `Rendering ${siteUrl}` };
      const pages = await collectSite(siteUrl);
      if (pages.length) {
        const digest = await askStructured({
          system: SITE_SYSTEM,
          prompt: pages.map((p) => `<page url="${p.url}">\n${p.text}\n</page>`).join("\n\n"),
          schema: SiteDigest,
          effort: "low",
          tier: "fast", tag: { action: "knowledge:site" },
        });
        k.site = { ...digest, url: siteUrl, fetchedAt: new Date().toISOString() };
      }
    }

    await saveKnowledge(k);
    const entries = Object.values(k.repos);
    yield {
      type: "done",
      summary: { repos: entries.length, included: entries.filter((e) => e.included && e.card).length, sitePages: k.site?.pages.length ?? 0 },
    };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

function repoPrompt(meta: RepoMeta, m: Awaited<ReturnType<typeof collectRepo>>, languages: string[]): string {
  const manifests = Object.entries(m.manifests)
    .map(([name, body]) => `<file name="${name}">\n${body}\n</file>`)
    .join("\n");
  return `<repo name="${meta.fullName}" private="${meta.isPrivate}" owner="${meta.owner}" stars="${meta.stars}" last_push="${meta.pushedAt}">
<description>${meta.description}</description>
<languages>${languages.join(", ")}</languages>
<candidate_commits>${m.userCommits}</candidate_commits>
<root_files>${m.rootFiles.join(", ")}</root_files>
${manifests}
<readme>
${m.readme || "(no README)"}
</readme>
</repo>`;
}

export async function setIncluded(fullName: string, included: boolean): Promise<void> {
  const k = await loadKnowledge();
  if (!k?.repos[fullName]) throw new Error(`unknown repo ${fullName}`);
  k.repos[fullName].included = included;
  await saveKnowledge(k);
}

const Shortlist = z.object({ repos: z.array(z.string()).describe("Full repo names, most relevant first.") });

// One cheap call picks the repos worth showing the writer for this job.
export async function shortlistRepos(k: Knowledge | null, job: string, tag: UsageTag): Promise<string[] | undefined> {
  if (!k) return undefined;
  const usable = Object.values(k.repos).filter((e) => e.included && e.card);
  if (usable.length <= 12) return undefined;
  const menu = usable.map((e) => `${e.meta.fullName}: ${e.card!.summary} [${e.card!.kind}, ${e.card!.maturity}, ${e.userCommits} commits] Stack: ${e.card!.stack.join(", ")}`).join("\n");
  try {
    const { repos } = await askStructured({
      tier: "fast",
      system: "Pick the candidate's repositories that best prove fit for this job posting: up to 12, most relevant first. Always include repos from their employers' organisations when the work is relevant. Prefer real products and client work with many commits over learning repos and templates. Return exact full names from the list.",
      prompt: `<job_posting>\n${job}\n</job_posting>\n\n<repos>\n${menu}\n</repos>`,
      schema: Shortlist,
      effort: "low",
      tag,
    });
    const known = new Set(usable.map((e) => e.meta.fullName));
    const picked = repos.filter((r) => known.has(r));
    return picked.length ? picked : undefined;
  } catch {
    return undefined; // fall back to the full knowledge base
  }
}

// Everything a CV could draw on: included repos with a card, and portfolio
// pages. Ids are repo full names and page urls.
export function knowledgeItems(k: Knowledge | null): { id: string; type: "repo" | "page"; title: string; url: string; summary: string; menu: string }[] {
  if (!k) return [];
  const repos = Object.values(k.repos)
    .filter((e) => e.included && e.card)
    .map((e) => ({
      id: e.meta.fullName,
      type: "repo" as const,
      title: e.meta.fullName.split("/").pop()!,
      url: e.meta.url,
      summary: e.card!.summary,
      menu: `${e.card!.summary} [${e.card!.kind}, ${e.card!.maturity}, ${e.userCommits} commits] Stack: ${e.card!.stack.join(", ")}`,
    }));
  const pages = (k.site?.pages ?? []).map((p) => ({
    id: p.url,
    type: "page" as const,
    title: p.title,
    url: p.url,
    summary: p.summary,
    menu: `Portfolio page. ${p.summary} Facts: ${p.technicalFacts.slice(0, 4).join("; ")}`,
  }));
  return [...repos, ...pages];
}

// Compact text the writing steps read: included repos with a card, cut to
// the run's shortlist when there is one. `pages` cuts the portfolio the same
// way; an empty list leaves it out.
export function knowledgeDigest(k: Knowledge | null, only?: string[], pages?: string[]): string {
  if (!k) return "(no knowledge base built yet)";
  const repos = Object.values(k.repos)
    .filter((e) => e.included && e.card && (!only || only.includes(e.meta.fullName)))
    .sort((a, b) => b.meta.pushedAt.localeCompare(a.meta.pushedAt))
    .map((e) => {
      const c = e.card!;
      return [
        `<repo name="${e.meta.fullName}" url="${e.meta.url}" private="${e.meta.isPrivate}" commits_by_candidate="${e.userCommits}" last_push="${e.meta.pushedAt.slice(0, 10)}" kind="${c.kind}" maturity="${c.maturity}">`,
        c.summary,
        `Stack: ${c.stack.join(", ")}`,
        `Skills shown: ${c.skills.map((s) => `${s.skill} (${s.evidence})`).join("; ")}`,
        `Resume lines: ${c.resumeLines.join(" | ")}`,
        c.metrics.length ? `Stated numbers: ${c.metrics.join("; ")}` : "",
        "</repo>",
      ]
        .filter(Boolean)
        .join("\n");
    });
  const site = k.site && (!pages || pages.length)
    ? `<portfolio url="${k.site.url}">\nPositioning: ${k.site.positioning}\nClaims: ${k.site.claims.join(" | ")}\n${k.site.pages
        .filter((p) => !pages || pages.includes(p.url))
        .map((p) => `Page ${p.url} (${p.title}): ${p.summary} Facts: ${p.technicalFacts.join("; ")}`)
        .join("\n")}\n</portfolio>`
    : "";
  return `${repos.join("\n\n")}\n\n${site}`.trim();
}

function knowledgeMarkdown(k: Knowledge): string {
  const lines = [`# Knowledge base`, "", `Built ${k.builtAt} from github.com/${k.login} and its orgs.`, ""];
  if (k.site) {
    lines.push(`## Portfolio: ${k.site.url}`, "", k.site.positioning, "", ...k.site.claims.map((c) => `- ${c}`), "");
    for (const p of k.site.pages) lines.push(`### ${p.title} (${p.url})`, "", p.summary, "", ...p.technicalFacts.map((f) => `- ${f}`), "");
  }
  lines.push("## Repositories", "");
  for (const e of Object.values(k.repos).sort((a, b) => b.meta.pushedAt.localeCompare(a.meta.pushedAt))) {
    const c = e.card;
    lines.push(
      `### ${e.meta.fullName}${e.included ? "" : " (excluded)"}`,
      "",
      `${e.meta.url} · ${e.meta.isPrivate ? "private" : "public"} · ${e.userCommits} commits by you · last push ${e.meta.pushedAt.slice(0, 10)}`,
      "",
    );
    if (!c) {
      lines.push("No card: empty repo.", "");
      continue;
    }
    lines.push(
      `${c.summary} *(${c.kind}, ${c.maturity}: ${c.maturityEvidence})*`,
      "",
      `**Stack:** ${c.stack.join(", ")}`,
      "",
      ...c.skills.map((s) => `- **${s.skill}:** ${s.evidence}`),
      "",
      ...c.resumeLines.map((l) => `> ${l}`),
      "",
    );
  }
  return lines.join("\n");
}
