import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Everything GitHub-side goes through the `gh` CLI, so it uses the account the
// user is already logged into (including private org repos they can read).
async function gh(args: string[]): Promise<string> {
  const { stdout } = await run("gh", args, { maxBuffer: 20 * 1024 * 1024, timeout: 60_000 });
  return stdout;
}

async function ghJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await gh(["api", path])) as T;
  } catch {
    return null; // 404s are normal: no README, empty repo, missing file
  }
}

async function ghRaw(path: string, limit: number): Promise<string> {
  try {
    return (await gh(["api", path, "-H", "Accept: application/vnd.github.raw"])).slice(0, limit);
  } catch {
    return "";
  }
}

export interface RepoMeta {
  fullName: string;
  url: string;
  description: string;
  isPrivate: boolean;
  pushedAt: string;
  stars: number;
  owner: string;
}

export interface RepoMaterial {
  languages: Record<string, number>;
  rootFiles: string[];
  readme: string;
  manifests: Record<string, string>;
  userCommits: number;
}

export async function githubLogin(): Promise<string> {
  return (await gh(["api", "user", "--jq", ".login"])).trim();
}

interface ListedRepo {
  nameWithOwner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  pushedAt: string;
  stargazerCount: number;
}

// The user's own non-fork repos plus every repo of every org they belong to.
export async function listRepos(login: string): Promise<RepoMeta[]> {
  const fields = "nameWithOwner,url,description,isPrivate,isFork,pushedAt,stargazerCount";
  const owners = [login, ...JSON.parse(await gh(["api", "user/orgs", "--jq", "[.[].login]"]))];
  const repos: RepoMeta[] = [];
  for (const owner of owners) {
    const listed: ListedRepo[] = JSON.parse(await gh(["repo", "list", owner, "--limit", "200", "--json", fields]));
    for (const r of listed) {
      if (r.isFork) continue;
      repos.push({
        fullName: r.nameWithOwner,
        url: r.url,
        description: r.description ?? "",
        isPrivate: r.isPrivate,
        pushedAt: r.pushedAt,
        stars: r.stargazerCount,
        owner,
      });
    }
  }
  return repos;
}

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "Dockerfile", "docker-compose.yml"];

// Counts the user's commits from the pagination header, without paging through them.
async function countCommits(fullName: string, login: string): Promise<number> {
  try {
    const out = await gh(["api", "-i", `repos/${fullName}/commits?author=${login}&per_page=1`]);
    const last = out.match(/[?&]page=(\d+)>; rel="last"/);
    if (last) return Number(last[1]);
    const body = out.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    return (JSON.parse(body) as unknown[]).length;
  } catch {
    return 0;
  }
}

export async function collectRepo(repo: RepoMeta, login: string): Promise<RepoMaterial> {
  const [languages, root, readme, userCommits] = await Promise.all([
    ghJson<Record<string, number>>(`repos/${repo.fullName}/languages`),
    ghJson<{ name: string; type: string }[]>(`repos/${repo.fullName}/contents`),
    ghRaw(`repos/${repo.fullName}/readme`, 8000),
    countCommits(repo.fullName, login),
  ]);
  const rootFiles = (root ?? []).map((f) => (f.type === "dir" ? `${f.name}/` : f.name));
  const manifests: Record<string, string> = {};
  await Promise.all(
    MANIFESTS.filter((m) => rootFiles.includes(m)).map(async (m) => {
      manifests[m] = await ghRaw(`repos/${repo.fullName}/contents/${m}`, 3000);
    }),
  );
  return { languages: languages ?? {}, rootFiles, readme, manifests, userCommits };
}

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The portfolio is a client-rendered app, so pages are rendered in headless
// Chrome before their text is read.
export async function renderPage(url: string): Promise<string> {
  const { stdout } = await run(CHROME, ["--headless=new", "--disable-gpu", "--virtual-time-budget=10000", "--dump-dom", url], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60_000,
  });
  return htmlToText(stdout);
}

export interface SitePage {
  url: string;
  text: string;
}

export async function collectSite(siteUrl: string): Promise<SitePage[]> {
  const base = new URL(siteUrl).origin;
  let paths = ["/"];
  try {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    // The sitemap may name a different host for the same site; keep only the paths.
    const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    // Tag index pages only list posts already crawled.
    if (found.length) paths = [...new Set(found)].filter((p) => !p.includes("/tags/"));
  } catch {}
  const pages: SitePage[] = [];
  for (const p of paths.slice(0, 20)) {
    try {
      pages.push({ url: base + p, text: (await renderPage(base + p)).slice(0, 12000) });
    } catch {}
  }
  return pages;
}
