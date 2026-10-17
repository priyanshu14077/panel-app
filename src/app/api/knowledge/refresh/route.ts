import { refreshKnowledge } from "@/lib/knowledge/cards";
import { ndjson } from "@/lib/ndjson";

export async function POST() {
  return ndjson(refreshKnowledge());
}
