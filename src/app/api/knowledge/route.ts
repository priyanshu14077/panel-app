import { loadKnowledge } from "@/lib/knowledge/cards";

export async function GET() {
  const k = await loadKnowledge();
  if (!k) return Response.json(null);
  return Response.json({
    builtAt: k.builtAt,
    login: k.login,
    site: k.site ? { url: k.site.url, pages: k.site.pages.length, positioning: k.site.positioning } : null,
    repos: Object.values(k.repos)
      .sort((a, b) => b.meta.pushedAt.localeCompare(a.meta.pushedAt))
      .map((e) => ({
        fullName: e.meta.fullName,
        url: e.meta.url,
        isPrivate: e.meta.isPrivate,
        pushedAt: e.meta.pushedAt,
        userCommits: e.userCommits,
        included: e.included,
        summary: e.card?.summary ?? null,
        kind: e.card?.kind ?? null,
        maturity: e.card?.maturity ?? null,
        stack: e.card?.stack ?? [],
      })),
  });
}
