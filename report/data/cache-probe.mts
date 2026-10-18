import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
const c = new Anthropic();
const model = process.argv[2] ?? "claude-haiku-5-5";
const nonce = Date.now();
const ctx = `<doc id="${nonce}">\n` + Array.from({ length: 400 }, (_, i) => `Line ${i}: the candidate shipped service ${i} handling ${i * 13} requests a day.`).join("\n") + "\n</doc>";
const A = z.object({ a: z.string() });
const B = z.object({ items: z.array(z.object({ b: z.string(), n: z.number() })) });
async function call(label: string, system: string, schema: z.ZodType | null, effort: "low" | "medium" | "high", task: string) {
  const m = await c.beta.messages.stream({
    model, max_tokens: 2000, system,
    messages: [{ role: "user", content: [{ type: "text", text: ctx, cache_control: { type: "ephemeral" } }, { type: "text", text: task }] }],
    output_config: schema ? { effort, format: betaZodOutputFormat(schema) } : { effort },
  }).finalMessage();
  console.log(label.padEnd(28), "write", m.usage.cache_creation_input_tokens, "read", m.usage.cache_read_input_tokens, "in", m.usage.input_tokens);
}
const S = "You answer briefly about the document.";
await call("1 base A/low", S, A, "low", "Summarize in 5 words.");
await call("2 same prefix, schema B", S, B, "low", "List two services.");
await call("3 no schema", S, null, "low", "One word.");
await call("4 effort medium", S, A, "medium", "Summarize in 5 words.");
await call("5 different system", S + " Be terse.", A, "low", "Summarize in 5 words.");
