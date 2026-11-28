// Client-safe: how loud the GM's placed sounds are where a player's token stands.
export type Placed = { id: number; url: string; x: number; y: number; radius: number; volume: number };

/** How loud a placed sound is at a spot (grid units): full at its centre, fading to nothing at its radius. */
export const loudnessAt = (s: Placed, at: { x: number; y: number }) => s.volume * Math.max(0, 1 - Math.hypot(at.x - s.x, at.y - s.y) / Math.max(0.01, s.radius));
