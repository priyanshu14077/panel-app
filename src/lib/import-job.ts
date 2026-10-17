import { promises as fs } from "node:fs";
import path from "node:path";
import { htmlToText, renderPage } from "./knowledge/collect";
import { JOBS_DIR } from "./paths";

export interface Founder {
  name: string;
  title: string;
  linkedin: string;
}

export interface ImportedJob {
  folder: string;
  title: string;
  company: string;
  text: string;
  founders: Founder[];
}

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };

interface JobPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: unknown;
  baseSalary?: unknown;
  employmentType?: string | string[];
}

// Most job boards (YC, Greenhouse, Lever, Ashby) embed a schema.org JobPosting.
function findJobPosting(html: string): JobPosting | null {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]);
      const nodes: JobPosting[] = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const job = nodes.find((n) => [n["@type"]].flat().includes("JobPosting"));
      if (job) return job;
    } catch {}
  }
  return null;
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const ycSlug = (u: URL) => (u.hostname.endsWith("ycombinator.com") ? u.pathname.match(/^\/companies\/([^/]+)/)?.[1] : undefined);

interface YcCompany {
  name: string;
  batch_name?: string;
  team_size?: number;
  one_liner?: string;
  long_description?: string;
  website?: string;
  linkedin_url?: string;
  founders?: { full_name: string; title?: string; linkedin_url?: string }[];
}

// YC company pages carry their data in an Inertia `data-page` attribute.
async function ycCompany(slug: string): Promise<YcCompany | null> {
  try {
    const html = await (await fetch(`https://www.ycombinator.com/companies/${slug}`, { headers: UA })).text();
    const raw = html.match(/data-page="([^"]+)"/)?.[1];
    return raw ? (JSON.parse(decodeEntities(raw)).props.company as YcCompany) : null;
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;
const asList = (v: unknown): Json[] => [v].flat().filter((x): x is Json => !!x && typeof x === "object");

// schema.org Place -> "San Francisco, California, US"
function fmtLocation(value: unknown): string {
  return asList(value)
    .map((place) => {
      const a = (place.address ?? {}) as Json;
      return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", ");
    })
    .filter(Boolean)
    .join("; ");
}

// schema.org MonetaryAmount -> "USD 130,000 - 170,000 per year"
function fmtSalary(value: unknown): string {
  const [amount] = asList(value);
  if (!amount) return "";
  const v = (amount.value ?? {}) as Json;
  const n = (x: unknown) => (typeof x === "number" ? x.toLocaleString("en-US") : String(x ?? ""));
  const range = v.minValue != null ? `${n(v.minValue)} - ${n(v.maxValue)}` : n(v.value);
  return [amount.currency, range, v.unitText ? `per ${String(v.unitText).toLowerCase()}` : ""].filter(Boolean).join(" ");
}

export async function importJob(url: string): Promise<ImportedJob> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links can be imported.");
  const html = await (await fetch(u, { headers: UA })).text();
  const posting = findJobPosting(html);

  let title = posting?.title ?? "";
  let company = posting?.hiringOrganization?.name ?? "";
  let body = posting?.description ? htmlToText(decodeEntities(posting.description).replace(/<\/(p|li|h\d)>/g, "\n")) : "";
  if (!body) {
    body = htmlToText(html);
    // Client-rendered boards return an empty shell; render them instead.
    if (body.split(/\s+/).length < 150) body = await renderPage(u.toString());
  }
  if (!title) title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? "Job";

  const lines = [`# ${title}${company ? ` at ${company}` : ""}`, "", `Source: ${u}`];
  const location = fmtLocation(posting?.jobLocation);
  if (location) lines.push(`Location: ${location}`);
  const salary = fmtSalary(posting?.baseSalary);
  if (salary) lines.push(`Salary: ${salary}`);
  if (posting?.employmentType) lines.push(`Type: ${[posting.employmentType].flat().join(", ")}`);
  lines.push("", body.slice(0, 20000));

  let founders: Founder[] = [];
  const slug = ycSlug(u);
  if (slug) {
    const c = await ycCompany(slug);
    if (c) {
      company ||= c.name;
      founders = (c.founders ?? []).map((f) => ({ name: f.full_name, title: f.title ?? "", linkedin: f.linkedin_url ?? "" }));
      lines.push(
        "",
        `## About ${c.name} (Y Combinator${c.batch_name ? `, ${c.batch_name}` : ""})`,
        "",
        [c.one_liner, c.team_size ? `Team size: ${c.team_size}.` : "", c.website ? `Website: ${c.website}` : ""].filter(Boolean).join(" "),
        c.long_description ? `\n${c.long_description}` : "",
        founders.length ? `\nFounders: ${founders.map((f) => `${f.name}${f.title ? ` (${f.title})` : ""}${f.linkedin ? ` ${f.linkedin}` : ""}`).join("; ")}` : "",
      );
    }
  }

  const text = lines.join("\n").trim();
  const folder = `${company || u.hostname} - ${title}`.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  await fs.mkdir(path.join(JOBS_DIR, folder), { recursive: true });
  await fs.writeFile(path.join(JOBS_DIR, folder, "job_description.md"), `${text}\n`);
  return { folder, title, company, text, founders };
}
