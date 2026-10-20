import { connection, type NextRequest } from "next/server";
import { facets, searchMessages, type MessageKind } from "@/lib/db";

const KINDS: MessageKind[] = ["chat", "project-interview", "email", "outreach"];

export async function GET(req: NextRequest) {
  await connection();
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind") as MessageKind | null;
  const role = p.get("role");
  const hits = searchMessages({
    q: p.get("q") ?? undefined,
    kind: kind && KINDS.includes(kind) ? kind : undefined,
    role: role === "user" || role === "assistant" ? role : undefined,
    company: p.get("company") || undefined,
    stage: p.get("stage") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
  });
  return Response.json({ hits, ...facets() });
}
