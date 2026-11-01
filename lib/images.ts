import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Images live in data/images and are served by app/images/[file]/route.ts.
export const IMAGE_DIR = path.join("data", "images");
fs.mkdirSync(IMAGE_DIR, { recursive: true });

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));

/** Saves image bytes and returns the URL to reference them by. */
export function saveImage(bytes: Buffer, contentType: string): string {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new Error(`Unsupported image type: ${contentType}`);
  const file = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, file), bytes);
  return `/images/${file}`;
}

/** Generates an image with OpenAI. Needs OPENAI_API_KEY in .env.local. */
export async function generateImage(prompt: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
      prompt,
      size: "1024x1024",
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { b64_json: string }[] };
  return saveImage(Buffer.from(json.data[0].b64_json, "base64"), "image/png");
}
