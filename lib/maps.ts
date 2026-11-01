/** A location's map layers, bottom to top. */
export const MAP_LAYERS = [
  "base", "background", "map", "templates", "tiles", "walls",
  "tokens", "sounds", "lighting", "effects", "notes", "controls",
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
