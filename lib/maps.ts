/** A location's map layers, bottom to top. */
export const MAP_LAYERS = [
  "base", "background", "map", "grid", "templates", "tiles", "structure",
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
  offsetX: number; // shifts lines right (pixels)
  offsetY: number; // shifts lines down (pixels)
}

export const DEFAULT_GRID: MapGrid = { size: 50, color: "#ffffff", offsetX: 0, offsetY: 0 };

/** Templates layer settings: the colour used to draw each kind of template. */
export const TEMPLATE_KINDS = ["movement", "aoe", "vision"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type TemplateColors = Record<TemplateKind, string>; // #rrggbb

export const TEMPLATE_LABELS: Record<TemplateKind, string> = { movement: "Movement", aoe: "Action AoE", vision: "Vision" };
/** Templates are drawn very dim so the map stays readable underneath. */
export const TEMPLATE_OPACITY = 0.15;

export const DEFAULT_TEMPLATE_COLORS: TemplateColors = { movement: "#3b82f6", aoe: "#ef4444", vision: "#facc15" };

/**
 * Structure layer pieces. Walls, doors and windows run between grid corners. Stairs are a sloped flight
 * within a portrait (side-on) map, walkable like a floor. A staircase sits in a cell and leads to another level.
 */
export const STRUCTURE_KINDS = ["wall", "door", "window", "stairs", "staircase"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const STRUCTURE_LABELS: Record<StructureKind, string> = {
  wall: "Wall",
  door: "Door",
  window: "Window",
  stairs: "Stairs",
  staircase: "Level link",
};

export const STRUCTURE_STYLES: Record<Exclude<StructureKind, "staircase">, { color: string; width: number }> = {
  wall: { color: "#e5e7eb", width: 6 },
  door: { color: "#b45309", width: 6 },
  window: { color: "#7dd3fc", width: 3 },
  stairs: { color: "#d6b98c", width: 3 },
};

/** How a clip in an ambient sound's playlist plays. */
export const CLIP_MODES = ["loop", "layer", "event", "manual"] as const;
export type ClipMode = (typeof CLIP_MODES)[number];
export const CLIP_MODE_LABELS: Record<ClipMode, string> = {
  loop: "Looped in sequence",
  layer: "Looped together (layer)",
  event: "Triggered by map event",
  manual: "Played manually",
};

/** Light sources: a point light shines all round; a directional light shines in a cone. */
export const LIGHT_KINDS = ["point", "directional"] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];

/** Edges of the scene that control buttons can sit along. */
export const CONTROL_EDGES = ["top", "right", "bottom", "left"] as const;
export type ControlEdge = (typeof CONTROL_EDGES)[number];
