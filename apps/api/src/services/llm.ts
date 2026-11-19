import OpenAI from "openai";

export async function completeJson(system: string, user: string): Promise<Record<string, unknown>> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return {};
  }
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
  const completion = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function completeText(system: string, user: string): Promise<string> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return "";
  }
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
  const completion = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}
