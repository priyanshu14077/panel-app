import type { Run } from "./pipeline";

// Filters for the board, read from the posting with rules rather than a model
// call: free, instant, and the same answer every time.

export const FAMILIES = ["AI / ML", "Backend", "Full-stack", "Forward-deployed", "Platform", "Frontend", "Generalist"] as const;
export type Family = (typeof FAMILIES)[number];
export const LEVELS = ["Junior", "Mid", "Senior"] as const;
export type Level = (typeof LEVELS)[number] | "";
export const MODES = ["Remote", "Hybrid", "Onsite"] as const;
export type Mode = (typeof MODES)[number] | "";
export const REGIONS = ["India", "Europe", "UK", "US", "APAC", "Anywhere"] as const;
export type Region = (typeof REGIONS)[number] | "";

export interface JobFacets {
  families: Family[];
  level: Level;
  mode: Mode;
  region: Region;
  verdict: string; // the latest re-screen, or the first screen
  ats: number | null;
  fitRisk: boolean;
  groupKey: string; // the same posting run more than once shares this
}

const FAMILY_RULES: [Family, RegExp][] = [
  ["AI / ML", /\b(ai|ml|genai|llm|agents?|machine learning|applied scientist|intelligence)\b/i],
  ["Backend", /\b(back[- ]?end|payments?|api|server)\b/i],
  ["Full-stack", /\b(full[- ]?stack|product engineer|founding)\b/i],
  ["Forward-deployed", /\b(forward[- ]deployed|solutions?|integrations?|deployments?|support engineer|customer engineer)\b/i],
  ["Platform", /\b(platform|devops|sre|reliability|infrastructure|security|client engineering)\b/i],
  ["Frontend", /\b(front[- ]?end|ui engineer|web engineer)\b/i],
];

function familiesOf(role: string): Family[] {
  const found = FAMILY_RULES.filter(([, re]) => re.test(role)).map(([f]) => f);
  return found.length ? found : ["Generalist"];
}

// The title decides when it names a level; otherwise the fewest years asked for.
function levelOf(role: string, experience: string): Level {
  if (/\b(senior|sr\.?|staff|principal|lead)\b/i.test(role)) return "Senior";
  if (/\b(junior|jr\.?|intern|graduate|early[- ]career|new grad|associate|(engineer|developer) (i|1)\b|ic[12])\b/i.test(`${role} ${experience}`)) return "Junior";
  const years = [...`${role} ${experience}`.matchAll(/(\d+)\s*(?:\+|-|–|to)?\s*\d*\s*(?:years?|yrs?)/gi)].map((m) => Number(m[1]));
  const least = years.length ? Math.min(...years) : NaN;
  if (Number.isNaN(least)) return /\b(one|a) year\b/i.test(experience) ? "Junior" : "";
  return least <= 2 ? "Junior" : least <= 4 ? "Mid" : "Senior";
}

// "remote/hybrid/onsite not stated" names no mode.
const stated = (location: string) => location.replace(/\b(?:remote|hybrid|on-?site)(?:[\s/,]+(?:remote|hybrid|on-?site))*\s+not stated\b/gi, "");

function modeOf(raw: string): Mode {
  const location = stated(raw);
  if (/\bhybrid\b/i.test(location)) return "Hybrid";
  if (/\bremote\b/i.test(location) && !/not stated/i.test(location)) return "Remote";
  if (/\b(onsite|on-site|office|in-office|office-first)\b/i.test(location)) return "Onsite";
  return "";
}

const REGION_RULES: [Region, RegExp][] = [
  ["India", /\b(india|bengaluru|bangalore|delhi|noida|gurgaon|gurugram|mumbai|pune|hyderabad|chennai|kolkata|\bIN\b)/i],
  ["UK", /\b(united kingdom|\buk\b|london|england|manchester|edinburgh)\b/i],
  ["US", /\b(united states|\bus\b|usa|california|new york|san francisco|seattle|austin|boston)\b/i],
  ["APAC", /\b(apac|australia|sydney|melbourne|new zealand|christchurch|auckland|singapore|japan|tokyo)\b/i],
  ["Europe", /\b(europe|eu|spain|barcelona|madrid|germany|berlin|hamburg|munich|denmark|copenhagen|switzerland|zurich|france|paris|netherlands|amsterdam|poland|warsaw|portugal|lisbon|ireland|dublin|sweden|stockholm|finland|helsinki|\bES\b)\b/i],
];

// The first place the posting names wins: "Copenhagen HQ, ... London" is Europe.
function regionOf(location: string): Region {
  const hits = REGION_RULES.map(([region, re]) => ({ region, at: location.search(re) })).filter((h) => h.at >= 0);
  if (hits.length) return hits.sort((a, b) => a.at - b.at)[0].region;
  return /\bremote\b/i.test(location) ? "Anywhere" : "";
}

// Lowercase words of a title without brackets, levels or punctuation, so
// "SDE (Integrations / Deployments)" and "SDE (Integrations & GenAI Deployments)" meet.
const STOP = new Set(["and", "the", "of", "for", "a", "an", "in", "at", "with", "to", "i", "ii", "iii", "1", "2", "3", "4", "years", "year", "remote", "full", "time"]);
export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

const companyKey = (company: string) => company.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
// The title with its bracketed detail, levels and location suffixes dropped.
const titleKey = (role: string) => [...words(role.replace(/\(.*?\)/g, "").replace(/,.*$/, ""))].sort().join("-");

export function jobFacets(run: Run): JobFacets {
  const job = run.synthesis?.job;
  const d = run.details;
  const role = d?.role || job?.role || "";
  const location = d?.location ?? "";
  const verdict = run.rescreens.at(-1)?.verdict ?? run.reviews.find((r) => r.id === "screen")?.verdict ?? "";
  return {
    families: familiesOf(role),
    level: levelOf(role, d?.experience ?? ""),
    mode: modeOf(location),
    region: regionOf(location),
    verdict,
    ats: run.ats?.after?.score ?? run.ats?.before?.score ?? null,
    fitRisk: Boolean(d?.redFlags.length),
    groupKey: `${companyKey(d?.company || job?.company || "")}:${titleKey(role)}`,
  };
}

// What a posting asks for: its stack and title words. ATS terms are left out:
// only newer runs have them, and they would make old and new runs look apart.
function profileOf(run: Run): Set<string> {
  return new Set([...(run.details?.stack ?? []).map((t) => t.toLowerCase()), ...words(run.details?.role || run.synthesis?.job.role || "")]);
}

export interface Similar {
  id: string;
  company: string;
  role: string;
  score: number; // 0-100
}

// The closest other postings by stack, terms and title; repeats of the same
// posting are left out, since the board already groups them.
export function similarJobs(run: Run, runs: Run[], limit = 3): Similar[] {
  const mine = profileOf(run);
  const key = jobFacets(run).groupKey;
  const seen = new Set<string>();
  return runs
    .filter((r) => r.id !== run.id && r.synthesis && jobFacets(r).groupKey !== key)
    .map((r) => ({ run: r, score: jaccard(mine, profileOf(r)) }))
    .filter((x) => x.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .filter(({ run: r }) => {
      const k = jobFacets(r).groupKey;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit)
    .map(({ run: r, score }) => ({ id: r.id, company: r.synthesis!.job.company, role: r.synthesis!.job.role, score: Math.round(score * 100) }));
}
