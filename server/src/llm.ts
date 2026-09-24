import { config } from "./config.js";
import type { Listing } from "./types.js";

function formatListing(listing: Listing): string {
  return `title: ${listing.title}\ntagline: ${listing.tagline}\nprice: ${listing.price}\ndescription: ${listing.description}`;
}

export async function summarizeChange(previous: Listing, next: Listing): Promise<string> {
  const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        {
          role: "system",
          content:
            "Summarize what changed between two competitor listings in one or two plain-English sentences. Mention only fields that changed.",
        },
        {
          role: "user",
          content: `Previous listing:\n${formatListing(previous)}\n\nCurrent listing:\n${formatListing(next)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const content =
    payload &&
    typeof payload === "object" &&
    "choices" in payload &&
    Array.isArray(payload.choices)
      ? payload.choices[0]?.message?.content
      : undefined;

  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("LLM response did not include a summary");
  }
  return content.trim();
}
