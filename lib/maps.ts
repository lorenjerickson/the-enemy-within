/** A location's map layers, bottom to top. */
export const MAP_LAYERS = [
  "base", "background", "map", "grid", "templates", "tiles", "walls",
  "tokens", "sounds", "lighting", "effects", "notes", "controls",
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export type Padding = { top: number; right: number; bottom: number; left: number };
export const EDGES = ["top", "right", "bottom", "left"] as const;

/**
 * Background layer settings: a solid colour, or a texture image stretched to fill or tiled.
 * Padding (canvas pixels) insets the region the map image is drawn into.
 */
export interface MapBackground {
  mode: "color" | "texture";
  color: string; // #rrggbb
  image: string | null;
  fit: "fill" | "tile";
  padding: Padding;
}

export const DEFAULT_BACKGROUND: MapBackground = {
  mode: "color",
  color: "#2a303c",
  image: null,
  fit: "fill",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
};

export const PERSPECTIVES = ["overhead", "scenic", "portrait"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];

/** How each perspective is described when generating a map image. */
export const PERSPECTIVE_PROMPTS: Record<Perspective, string> = {
  overhead: "Top-down orthographic battle map, no grid.",
  scenic: "Wide scenic establishing view of the place.",
  portrait: "Portrait-orientation scene, as if seen from where a character stands.",
};

/** Map layer settings: the map image (centred in the background's padded region, aspect ratio kept) and its perspective. */
export interface MapImage {
  image: string | null;
  perspective: Perspective;
}

export const DEFAULT_MAP_IMAGE: MapImage = { image: null, perspective: "overhead" };

/** Grid layer settings. Overhead maps get square cells; portrait maps get columns (horizontal movement distance). */
export interface MapGrid {
  size: number; // canvas pixels per square / column
  color: string; // #rrggbb
}

export const DEFAULT_GRID: MapGrid = { size: 50, color: "#ffffff" };
