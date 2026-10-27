/** Longest side kept in memory. Enough for a full-bleed 1080x1920 frame with headroom. */
const MAX_SIDE = 2160;

export function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Decodes an image (honoring EXIF orientation) and caps its resolution. */
export async function decodeImage(source: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const scale = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) return bitmap;

  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  });
  bitmap.close();
  return resized;
}

/** Draws `image` so it fully covers a `width` x `height` box, cropping the overflow. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * Builds a small, heavily blurred and dimmed copy of the image to use as a backdrop.
 * The blur runs on pixels directly (not `ctx.filter`) so it looks identical in every browser;
 * once upscaled to full size it reads as a smooth gaussian blur.
 */
export function makeBackdrop(image: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(width / 10, height / 10);
  drawCover(ctx, image, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scratch = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < 3; i++) {
    boxBlur(pixels.data, scratch, canvas.width, canvas.height, 5, true);
    boxBlur(scratch, pixels.data, canvas.width, canvas.height, 5, false);
  }
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] *= 0.72;
    data[i + 1] *= 0.72;
    data[i + 2] *= 0.72;
    data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** One sliding-window box blur pass along rows (`horizontal`) or columns, clamping at edges. */
function boxBlur(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
) {
  const length = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const step = horizontal ? 4 : width * 4;
  const norm = 1 / (2 * radius + 1);
  const at = (i: number) => Math.min(length - 1, Math.max(0, i)) * step;

  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width * 4 : line * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += src[base + at(k) + c];
      for (let i = 0; i < length; i++) {
        dst[base + i * step + c] = sum * norm;
        sum += src[base + at(i + radius + 1) + c] - src[base + at(i - radius) + c];
      }
    }
  }
}

/** Center-crops a square from the image at a size suitable for the credit badge. */
export function makeAvatar(image: ImageBitmap, size = 192): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size, size);
  drawCover(ctx, image, size, size);
  return canvas;
}
