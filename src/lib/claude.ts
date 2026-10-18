import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { recordUsage, type UsageTag } from "./usage";

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

// What a call needs, not which model: "fast" reads and grades, "writer"
// writes things you will send, "research" searches the web.
export type Tier = "fast" | "writer" | "research";

// MODEL_PROFILE in .env.local picks the trade-off. Web search needs Sonnet or
// Opus, so research never runs on Haiku.
const PROFILES = {
  economy: { fast: HAIKU, writer: HAIKU, research: SONNET },
  balanced: { fast: HAIKU, writer: SONNET, research: SONNET },
  quality: { fast: OPUS, writer: OPUS, research: OPUS },
} as const;
export type Profile = keyof typeof PROFILES;
const requested = process.env.MODEL_PROFILE as Profile;
export const PROFILE: Profile = requested in PROFILES ? requested : "balanced";
export const PROFILE_MODELS = PROFILES[PROFILE];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export class RefusalError extends Error {}

type Effort = "low" | "medium" | "high";
type Message = Anthropic.Beta.BetaMessageParam;

// Sonnet and Opus retry a safety decline server-side on Anthropic's
// recommended model. Haiku has no server-side fallback (the parameter would
// leave a decline declined), so a Haiku decline is retried here on Sonnet.
function fallbackFor(model: string) {
  return model === HAIKU ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

// Runs one request on the tier's model, retrying a Haiku decline on Sonnet.
async function finalOnTier<M extends Anthropic.Beta.BetaMessage>(
  tier: Tier,
  tag: UsageTag | undefined,
  start: (model: string) => { finalMessage(): Promise<M> },
): Promise<M> {
  const model = PROFILE_MODELS[tier];
  let message = await start(model).finalMessage();
  await recordUsage(tag, message.model, message.usage);
  if (message.stop_reason === "refusal" && model === HAIKU) {
    message = await start(SONNET).finalMessage();
    await recordUsage(tag, message.model, message.usage);
  }
  if (message.stop_reason === "refusal") throw new RefusalError("The model declined this request.");
  return message;
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// A run's shared material (posting, resume, profile, knowledge base) goes in
// `context`, marked for caching, ahead of the task-specific `prompt`. The cache
// key also covers the system prompt and the output schema, so only repeats of
// the same action within 5 minutes read it back (at 0.1x): drafting outreach
// for several targets, or several kinds of email. Pass it only for those; a
// one-off call would pay the 1.25x write for nothing.
function userTurn(prompt: string, context?: string): Message {
  if (!context) return { role: "user", content: prompt };
  return {
    role: "user",
    content: [
      { type: "text", text: context, cache_control: { type: "ephemeral" } },
      { type: "text", text: prompt },
    ],
  };
}

export async function askText(opts: { tier: Tier; system: string; prompt: string; context?: string; effort: Effort; tag?: UsageTag }): Promise<string> {
  const message = await finalOnTier(opts.tier, opts.tag, (model) =>
    getClient().beta.messages.stream({
      model,
      max_tokens: 16000,
      system: opts.system,
      messages: [userTurn(opts.prompt, opts.context)],
      output_config: { effort: opts.effort },
      ...fallbackFor(model),
    }),
  );
  return textOf(message.content);
}

export async function askStructured<S extends z.ZodType>(opts: {
  tier: Tier;
  system: string;
  prompt: string;
  context?: string;
  schema: S;
  effort: Effort;
  tag?: UsageTag;
}): Promise<z.infer<S>> {
  const message = await finalOnTier(opts.tier, opts.tag, (model) =>
    getClient().beta.messages.stream({
      model,
      max_tokens: 64000,
      system: opts.system,
      messages: [userTurn(opts.prompt, opts.context)],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      ...fallbackFor(model),
    }),
  );
  if (message.stop_reason === "max_tokens") throw new Error("The response was cut off at max_tokens.");
  if (message.parsed_output == null) throw new Error("The response did not match the expected schema.");
  return message.parsed_output as z.infer<S>;
}

// Research with Anthropic's server-side web search. A long search can pause
// the turn; resending the conversation lets the server continue it.
export async function askResearch(opts: { system: string; prompt: string; tag?: UsageTag }): Promise<string> {
  const messages: Message[] = [{ role: "user", content: opts.prompt }];
  for (let i = 0; i < 4; i++) {
    const message = await finalOnTier("research", opts.tag, (model) =>
      getClient().beta.messages.stream({
        model,
        max_tokens: 16000,
        system: opts.system,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
        output_config: { effort: "medium" },
        ...fallbackFor(model),
      }),
    );
    if (message.stop_reason !== "pause_turn") return textOf(message.content);
    messages.push({ role: "assistant", content: message.content });
  }
  throw new Error("Company research did not finish.");
}

// Multi-turn chat that yields text as it streams. The candidate's material in
// the first turn is marked for caching, so later turns re-read it at 0.1x.
export async function* streamChat(opts: {
  system: string;
  context: string;
  turns: { role: "user" | "assistant"; text: string }[];
  tag?: UsageTag;
}): AsyncGenerator<string, string> {
  const model = PROFILE_MODELS.writer;
  const messages: Message[] = opts.turns.map((t, i) =>
    i === 0
      ? { role: t.role, content: [{ type: "text", text: opts.context, cache_control: { type: "ephemeral" } }, { type: "text", text: t.text }] }
      : { role: t.role, content: t.text },
  );
  const stream = getClient().beta.messages.stream({
    model,
    max_tokens: 16000,
    system: opts.system,
    messages,
    output_config: { effort: "medium" },
    ...fallbackFor(model),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }
  const message = await stream.finalMessage();
  await recordUsage(opts.tag, message.model, message.usage);
  if (message.stop_reason === "refusal") throw new RefusalError("The model declined this request.");
  return textOf(message.content);
}
