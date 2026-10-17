import { promises as fs } from "node:fs";
import path from "node:path";
import { PANEL_DIR } from "./paths";

// List prices in dollars per million tokens. Cache writes (5-minute TTL) cost
// 1.25x input. A fallback can serve a request on another model, so price by
// the model that actually answered.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
};
const WEB_SEARCH_PER_REQUEST = 10 / 1000;

export interface UsageTag {
  runId?: string;
  action: string;
}

export interface UsageRecord extends UsageTag {
  at: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  cost: number;
}

interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

const LEDGER = path.join(PANEL_DIR, "usage.jsonl");

// Haiku 5.5 bills prompts over 100K tokens at 5x its short-prompt rates.
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheRead: 0.05 };

export function priceOf(model: string, u: ApiUsage): number {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const long = model === "claude-haiku-5-5" && u.input_tokens + read + write > 100_000;
  const p = long ? HAIKU_LONG : (PRICES[model] ?? PRICES["claude-opus-5-5"]);
  return (
    (u.input_tokens * p.input + write * p.input * 1.25 + read * p.cacheRead + u.output_tokens * p.output) / 1_000_000 +
    (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PER_REQUEST
  );
}

export async function recordUsage(tag: UsageTag | undefined, model: string, u: ApiUsage): Promise<void> {
  const record: UsageRecord = {
    at: new Date().toISOString(),
    runId: tag?.runId,
    action: tag?.action ?? "untagged",
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearches: u.server_tool_use?.web_search_requests ?? 0,
    cost: priceOf(model, u),
  };
  try {
    await fs.mkdir(PANEL_DIR, { recursive: true });
    await fs.appendFile(LEDGER, `${JSON.stringify(record)}\n`);
  } catch {} // metering must never break a run
}

export async function readUsage(): Promise<UsageRecord[]> {
  try {
    return (await fs.readFile(LEDGER, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
