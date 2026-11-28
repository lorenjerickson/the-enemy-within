"use client";

import type DiceBox from "@3d-dice/dice-box";

let shared: Promise<DiceBox> | null = null;

/**
 * The one 3D dice box for the page, in its own full-screen layer on <body> (above the map, under the prompts). Every
 * roll prompt throws into it. One per page because each box holds a WebGL context and draws into the element it was
 * made in: a box made in a prompt's own element kept drawing into that element after the prompt went away and came
 * back (a new round's plan dice, the next roll), so the dice rolled but couldn't be seen.
 */
export function diceBox(): Promise<DiceBox> {
  if (shared && document.getElementById("dice-layer")) return shared;
  document.getElementById("dice-layer")?.remove();
  const layer = document.createElement("div");
  layer.id = "dice-layer";
  layer.style.cssText = "position:fixed;inset:0;z-index:30;pointer-events:none";
  document.body.appendChild(layer);
  const made = import("@3d-dice/dice-box").then(async ({ default: Box }) => {
    const box = new Box({ container: "#dice-layer", assetPath: "/assets/dice-box/", scale: 7, theme: "default", themeColor: "#7c3aed" });
    // The box sizes its drawing from the canvas's size on screen when it starts (and again only when the window is
    // resized). Sized after starting, a bare canvas (300×150) was drawn small and stretched to fill the screen:
    // blurry, squashed dice. So it fills the layer first.
    for (const c of layer.querySelectorAll("canvas")) Object.assign(c.style, { width: "100%", height: "100%", display: "block" });
    await box.init();
    for (const c of layer.querySelectorAll("canvas")) Object.assign(c.style, { width: "100%", height: "100%", display: "block" }); // (a canvas made by init)
    window.dispatchEvent(new Event("resize")); // it measures again on a resize: now at full size
    return box;
  });
  shared = made;
  made.catch(() => { if (shared === made) shared = null; }); // a failed start: try again next time
  return made;
}

/** Takes the dice off the screen (a prompt closed). */
export function clearDice(): void {
  if (soon) clearTimeout(soon);
  shared?.then((b) => b.clear()).catch(() => {});
}

let soon: ReturnType<typeof setTimeout> | null = null;
/** Takes the dice off a moment after they've settled (long enough to read them). */
export function clearDiceSoon(ms = 2500): void {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => { soon = null; shared?.then((b) => b.clear()).catch(() => {}); }, ms);
}
