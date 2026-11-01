"use server";

import { requireGm } from "@/lib/auth";
import { generateImage } from "@/lib/images";

export type ArtworkKind = "item" | "creature";

const PROMPTS: Record<ArtworkKind, string> = {
  item: "Illustration of a single item for a dark fantasy roleplaying game, centered on a plain background.",
  creature: "Illustration of a creature for a dark fantasy roleplaying game, full body, dramatic lighting.",
};

export async function generateArtwork(
  kind: ArtworkKind,
  name: string,
  description: string
): Promise<{ url?: string; error?: string }> {
  await requireGm();
  try {
    return { url: await generateImage(`${PROMPTS[kind]} ${kind[0].toUpperCase() + kind.slice(1)}: ${name}. ${description}`) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
