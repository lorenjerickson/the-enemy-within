/** A location's map layers, bottom to top. */
export const MAP_LAYERS = [
  "base", "background", "map", "templates", "tiles", "walls",
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

/** Map layer settings: the map image, centred in the background's padded region with its aspect ratio kept. */
export interface MapImage {
  image: string | null;
}

export const DEFAULT_MAP_IMAGE: MapImage = { image: null };
