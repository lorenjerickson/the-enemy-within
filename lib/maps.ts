/** A location's map layers, bottom to top. */
export const MAP_LAYERS = [
  "base", "background", "map", "templates", "tiles", "walls",
  "tokens", "sounds", "lighting", "effects", "notes", "controls",
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** Background layer settings: a solid colour, or a texture image stretched to fill or tiled. */
export interface MapBackground {
  mode: "color" | "texture";
  color: string; // #rrggbb
  image: string | null;
  fit: "fill" | "tile";
}

export const DEFAULT_BACKGROUND: MapBackground = { mode: "color", color: "#2a303c", image: null, fit: "fill" };

/** Map layer settings: the map image and padding (in image pixels) added around each edge. */
export interface MapImage {
  image: string | null;
  padding: { top: number; right: number; bottom: number; left: number };
}

export const DEFAULT_MAP_IMAGE: MapImage = { image: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
export const EDGES = ["top", "right", "bottom", "left"] as const;
