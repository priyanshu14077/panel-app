// Exercises the GitHub + portfolio collectors. No Claude calls.
import { collectRepo, collectSite, githubLogin, listRepos } from "../src/lib/knowledge/collect.ts";

const login = await githubLogin();
const repos = await listRepos(login);
console.log("login", login, "repos", repos.length, "private", repos.filter((r) => r.isPrivate).length);
// The three most recently pushed repos.
for (const meta of [...repos].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)).slice(0, 3)) {
  const name = meta.fullName;
  const m = await collectRepo(meta, login);
  console.log(name, { commits: m.userCommits, langs: Object.keys(m.languages), files: m.rootFiles.length, readme: m.readme.length, manifests: Object.keys(m.manifests) });
}
const site = process.argv[2];
const pages = site ? await collectSite(site) : [];
console.log("site pages", pages.map((p) => `${new URL(p.url).pathname} ${p.text.split(" ").length}w`));
