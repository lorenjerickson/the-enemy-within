import sharp from "sharp";

/** How close (RGB distance) a pixel must be to the background colour to be cut away. */
const TOLERANCE = 48;
/** Tighter, for background showing through gaps inside the figure. */
const ENCLOSED_TOLERANCE = 20;

/**
 * Token art must have a transparent background. An image that already has one is kept (as PNG);
 * otherwise the background colour touching its edges is cut away (a flood fill from the border),
 * leaving the figure. Returns PNG bytes.
 */
export async function transparentToken(bytes: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  // Mostly transparent border already: nothing to remove.
  if (border.filter((i) => data[i * 4 + 3] < 128).length > border.length / 2) return sharp(bytes).png().toBuffer();

  // The background colour: the median border colour (robust to a figure touching the edge).
  const median = (c: number) => border.map((i) => data[i * 4 + c]).sort((a, b) => a - b)[border.length >> 1];
  const bg = [median(0), median(1), median(2)];
  const isBackground = (i: number) => {
    const dr = data[i * 4] - bg[0], dg = data[i * 4 + 1] - bg[1], db = data[i * 4 + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= TOLERANCE * TOLERANCE;
  };

  // Flood fill from the border through background-coloured pixels.
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const i of border) if (!seen[i] && isBackground(i)) (seen[i] = 1), (queue[tail++] = i);
  while (head < tail) {
    const i = queue[head++];
    data[i * 4 + 3] = 0;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n >= 0 && n < w * h && !seen[n] && isBackground(n)) (seen[n] = 1), (queue[tail++] = n);
    }
  }
  // Background enclosed by the figure (e.g. between a tail and a body): a tighter match anywhere.
  const close = (i: number) => {
    const dr = data[i * 4] - bg[0], dg = data[i * 4 + 1] - bg[1], db = data[i * 4 + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= ENCLOSED_TOLERANCE * ENCLOSED_TOLERANCE;
  };
  for (let i = 0; i < w * h; i++) if (close(i)) data[i * 4 + 3] = 0;
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
