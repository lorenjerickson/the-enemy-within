import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, addAsset, type AssetUsage } from "@/lib/db";
import { transparentToken } from "@/lib/tokenArt";

// Uploaded media (images and audio) live in <DATA_DIR>/images and are served by app/images/[file]/route.ts.
export const IMAGE_DIR = path.join(DATA_DIR, "images");
fs.mkdirSync(IMAGE_DIR, { recursive: true });

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export const CONTENT_TYPES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type])),
  wav: "audio/wav",
};

/** Saves uploaded media bytes (image or audio) and returns the URL to reference them by. */
export function saveImage(bytes: Buffer, contentType: string): string {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new Error(`Unsupported file type: ${contentType}`);
  const file = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, file), bytes);
  return `/images/${file}`;
}

/** Generates an image with OpenAI. Needs OPENAI_API_KEY in .env.local. Token art comes back with a transparent background. */
export async function generateImage(prompt: string, { token = false } = {}): Promise<string> {
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      ...(token && model.startsWith("gpt-image") ? { background: "transparent", output_format: "png" } : {}),
      size: "1024x1024",
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { b64_json: string }[] };
  const bytes = Buffer.from(json.data[0].b64_json, "base64");
  // Also cut the background away ourselves, in case the model painted one anyway.
  return saveImage(token ? await transparentToken(bytes) : bytes, "image/png");
}

/**
 * Reads the ImagePicker fields: an uploaded file wins, otherwise a generated image URL.
 * A new upload is recorded in the asset library as an image with the given usage.
 */
export async function imageFromForm(formData: FormData, usage: AssetUsage, name?: string, field = "image"): Promise<string | null> {
  // The default ImagePicker submits "upload" + "image"; one with another field name submits "<field>Upload" + "<field>".
  const upload = formData.get(field === "image" ? "upload" : `${field}Upload`);
  if (upload instanceof File && upload.size > 0) {
    const bytes = Buffer.from(await upload.arrayBuffer());
    // Tokens always get a transparent background (and so are stored as PNG).
    const url = usage === "token" ? saveImage(await transparentToken(bytes), "image/png") : saveImage(bytes, upload.type);
    addAsset({ name: name || upload.name.replace(/\.[^.]+$/, "") || "Untitled", type: "image", usage, url });
    return url;
  }
  return String(formData.get(field) ?? "").trim() || null;
}

/** Saves an uploaded audio file into the asset library as ambient sound; returns the asset URL. */
export async function audioFromForm(formData: FormData, name?: string): Promise<string | null> {
  const upload = formData.get("audio");
  if (!(upload instanceof File) || upload.size === 0) return null;
  if (!upload.type.startsWith("audio/")) throw new Error("Not an audio file");
  const url = saveImage(Buffer.from(await upload.arrayBuffer()), upload.type);
  addAsset({ name: name || upload.name.replace(/\.[^.]+$/, "") || "Untitled", type: "audio", usage: "ambient", url });
  return url;
}
