import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";

// `override: true` so a .env value wins over an inherited (possibly empty)
// shell var — common in sandboxed/harness environments.
loadEnv({ override: true });

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing. Copy .env.example → .env and fill it in.");
  process.exit(1);
}

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const BRAND_MODEL = process.env.ADDIE_BRAND_MODEL ?? "claude-haiku-4-5-20251001";
export const STREAMER_MODEL = process.env.ADDIE_STREAMER_MODEL ?? "claude-sonnet-4-6";

type ToolCallArgs<T> = {
  model: string;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  /** Validate / coerce the tool input. Throws if shape is wrong. */
  parse: (raw: unknown) => T;
  maxTokens?: number;
};

/**
 * Forces the model to call exactly one tool and returns the parsed input.
 * Retries once on schema parse failure.
 */
export async function callTool<T>(args: ToolCallArgs<T>): Promise<T> {
  const tryOnce = async () => {
    const response = await anthropic.messages.create({
      model: args.model,
      max_tokens: args.maxTokens ?? 1024,
      system: args.system,
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: args.toolName },
      messages: [{ role: "user", content: args.user }],
    });
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Model did not call the requested tool.");
    }
    return args.parse(toolUse.input);
  };

  try {
    return await tryOnce();
  } catch (err) {
    return await tryOnce();
  }
}
