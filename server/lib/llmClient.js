import OpenAI from "openai";

export function getLLMClient(provider = "openai") {
  if (provider === "grok") {
    if (!process.env.XAI_API_KEY) {
      throw new Error("XAI_API_KEY missing");
    }

    return new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}
