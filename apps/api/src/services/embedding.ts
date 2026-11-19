import crypto from "node:crypto";

export async function embedText(text: string): Promise<number[]> {
  const normalized = text.trim();
  if (!normalized) return Array.from({ length: 768 }, () => 0);

  if (process.env.GEMINI_API_KEY) {
    try {
      const model = process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text: normalized }] } }),
        },
      );
      if (response.ok) {
        const data = await response.json() as { embedding?: { values?: number[] } };
        if (data.embedding?.values?.length) return data.embedding.values;
      }
    } catch {
      // Deterministic fallback keeps local development functional.
    }
  }

  const vector = Array.from({ length: 768 }, () => 0);
  for (const [index, word] of normalized.toLowerCase().split(/\W+/).entries()) {
    if (!word) continue;
    const hash = crypto.createHash("sha256").update(word).digest();
    for (let offset = 0; offset < 4; offset += 1) {
      const position = ((hash.readUInt32BE(offset * 4) % 768) + 768) % 768;
      vector[position] += index % 2 === 0 ? 1 : -0.5;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}
