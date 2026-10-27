import { createCanvas, drawCover } from './media';
import { normalizeHandle, type Settings } from './settings';

/** Instagram Stories canvas. */
export const W = 1080;
export const H = 1920;
export const FPS = 30;

/** Instagram covers roughly the top and bottom 250px of a story with its own UI. */
export const SAFE_Y = 250;
const SIDE = 64;
const GAP = 40;

const DOT = 12;
const DOT_SPACING = 12;
const DOTS_OFFSET = 40;

const CARD_PAD = 64; // room around a card sprite for its drop shadow
const CREDIT_PAD = 24; // room around the credit sprite for its drop shadow
const AVATAR = 72;
const CREDIT_H = 92;
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface Slide {
  id: string;
  name: string;
  thumb: string;
  bitmap: ImageBitmap;
  backdrop: HTMLCanvasElement;
  /** Overrides the default duration when set. */
  duration: number | null;
}

interface Sprite {
  image: HTMLCanvasElement;
  x: number;
  y: number;
}

interface SceneSlide {
  slide: Slide;
  duration: number;
  sprite: Sprite;
}

export interface Scene {
  settings: Settings;
  slides: SceneSlide[];
  /** Transition length in seconds (0 when transitions are off). */
  transition: number;
  total: number;
  dotsY: number;
  credit: Sprite | null;
}

const spriteCache = new WeakMap<Slide, { key: string; image: HTMLCanvasElement }>();

/** Precomputes layout and pre-renders every static element, so drawing a frame is just a few blits. */
export function buildScene(slides: Slide[], settings: Settings, avatar: HTMLCanvasElement | null): Scene {
  const credit = makeCredit(settings, avatar);
  const top = credit?.top ?? false;

  // Vertical band available to the images: inside the safe area, minus the credit row.
  const regionTop = SAFE_Y + (credit && top ? CREDIT_H + GAP : 0);
  const regionBottom = H - SAFE_Y - (credit && !top ? CREDIT_H + GAP : 0);
  const showDots = settings.showDots && slides.length > 1;
  const dotsBlock = showDots ? DOTS_OFFSET + DOT : 0;

  const boxW = W - SIDE * 2;
  const boxH = regionBottom - regionTop - dotsBlock;
  const sizes = slides.map(({ bitmap }) => {
    const scale = Math.min(boxW / bitmap.width, boxH / bitmap.height);
    return { w: Math.round(bitmap.width * scale), h: Math.round(bitmap.height * scale) };
  });

  // Cards share a common center line so the dots don't jump between slides of different shapes.
  const tallest = Math.max(0, ...sizes.map((s) => s.h));
  const groupTop = regionTop + (regionBottom - regionTop - tallest - dotsBlock) / 2;
  const centerY = groupTop + tallest / 2;

  const sceneSlides = slides.map((slide, i): SceneSlide => {
    const duration = slide.duration ?? settings.slideDuration;
    if (settings.fit === 'cover') {
      return { slide, duration, sprite: { image: coverSprite(slide), x: 0, y: 0 } };
    }
    const { w, h } = sizes[i];
    return {
      slide,
      duration,
      sprite: {
        image: cardSprite(slide, w, h, settings.cornerRadius),
        x: Math.round((W - w) / 2) - CARD_PAD,
        y: Math.round(centerY - h / 2) - CARD_PAD,
      },
    };
  });

  const transition = settings.transition === 'none' ? 0 : settings.transitionDuration;
  const total =
    sceneSlides.reduce((sum, s) => sum + s.duration, 0) + Math.max(0, sceneSlides.length - 1) * transition;

  return {
    settings: { ...settings }, // snapshot, so an export in progress can't see later edits
    slides: sceneSlides,
    transition,
    total,
    dotsY: settings.fit === 'cover' ? regionBottom - DOT / 2 : groupTop + tallest + DOTS_OFFSET + DOT / 2,
    credit: credit && { image: credit.image, x: credit.x, y: credit.y },
  };
}

function cached(slide: Slide, key: string, render: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = spriteCache.get(slide);
  if (hit?.key === key) return hit.image;
  const image = render();
  spriteCache.set(slide, { key, image });
  return image;
}

function coverSprite(slide: Slide) {
  return cached(slide, 'cover', () => {
    const { canvas, ctx } = createCanvas(W, H);
    drawCover(ctx, slide.bitmap, W, H);
    return canvas;
  });
}

function cardSprite(slide: Slide, w: number, h: number, radius: number) {
  return cached(slide, `card:${w}x${h}:${radius}`, () => {
    const { canvas, ctx } = createCanvas(w + CARD_PAD * 2, h + CARD_PAD * 2);
    ctx.translate(CARD_PAD, CARD_PAD);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 56;
    ctx.shadowOffsetY = 18;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, radius);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, radius);
    ctx.clip();
    ctx.drawImage(slide.bitmap, 0, 0, w, h);
    ctx.restore();
    return canvas;
  });
}

function makeCredit(settings: Settings, avatar: HTMLCanvasElement | null) {
  const handle = normalizeHandle(settings.handle);
  if (!handle && !avatar) return null;

  const pill = settings.creditStyle === 'pill';
  const font = `600 36px ${FONT_STACK}`;
  const inset = (CREDIT_H - AVATAR) / 2;
  const textX = avatar ? inset + AVATAR + 18 : 32;
  const endPad = pill ? 32 : 8;

  const { ctx: measure } = createCanvas(1, 1);
  measure.font = font;
  const text = handle && fitText(measure, `@${handle}`, W - SIDE * 2 - textX - endPad);
  const width = text ? textX + measure.measureText(text).width + endPad : CREDIT_H;

  const { canvas, ctx } = createCanvas(width + CREDIT_PAD * 2, CREDIT_H + CREDIT_PAD * 2);
  ctx.translate(CREDIT_PAD, CREDIT_PAD);

  if (pill) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, CREDIT_H, CREDIT_H / 2);
    ctx.fillStyle = 'rgba(12, 12, 14, 0.55)';
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.roundRect(0.75, 0.75, width - 1.5, CREDIT_H - 1.5, CREDIT_H / 2);
    ctx.stroke();
  }

  if (avatar) {
    const r = AVATAR / 2;
    const cx = inset + r;
    const cy = CREDIT_H / 2;
    ctx.save();
    if (!pill) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, inset, inset, AVATAR, AVATAR);
    ctx.restore();
  }

  if (text) {
    ctx.font = font;
    ctx.fillStyle = '#fff';
    if (!pill) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 2;
    }
    // Center on the cap height so descenders (g, y, p) don't shift the baseline.
    const capHeight = ctx.measureText('H').actualBoundingBoxAscent;
    ctx.fillText(text, textX, Math.round(CREDIT_H / 2 + capHeight / 2));
  }

  const [vertical, horizontal] = settings.creditPosition.split('-');
  const x = horizontal === 'left' ? SIDE : horizontal === 'right' ? W - SIDE - width : (W - width) / 2;
  const y = vertical === 'top' ? SAFE_Y : H - SAFE_Y - CREDIT_H;
  return {
    image: canvas,
    x: Math.round(x) - CREDIT_PAD,
    y: Math.round(y) - CREDIT_PAD,
    top: vertical === 'top',
  };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(text.slice(0, end) + '…').width > maxWidth) end--;
  return text.slice(0, end) + '…';
}

/** Which slide(s) are on screen at time `t`, and how far the transition between them has run. */
function locate(scene: Scene, t: number): [from: number, to: number, progress: number] {
  let elapsed = 0;
  const last = scene.slides.length - 1;
  for (let i = 0; i <= last; i++) {
    elapsed += scene.slides[i].duration;
    if (t < elapsed || i === last) return [i, i, 0];
    if (t < elapsed + scene.transition) return [i, i + 1, (t - elapsed) / scene.transition];
    elapsed += scene.transition;
  }
  return [0, 0, 0];
}

/** The moment slide `index` is first fully on screen. */
export function slideStart(scene: Scene, index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) t += scene.slides[i].duration + scene.transition;
  return t;
}

/** The slide that takes up most of the frame at time `t`. */
export function slideAt(scene: Scene, t: number): number {
  const [from, to, progress] = locate(scene, t);
  return progress < 0.5 ? from : to;
}

const easeInOutCubic =(p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const smoothstep = (p: number) => p * p * (3 - 2 * p);

/** Draws the frame at time `t` (seconds). Expects `ctx` to map a W x H coordinate space. */
export function drawFrame(ctx: CanvasRenderingContext2D, scene: Scene, t: number) {
  const { settings, slides } = scene;
  ctx.globalAlpha = 1;
  ctx.fillStyle = settings.backgroundColor;
  ctx.fillRect(0, 0, W, H);

  if (slides.length) {
    const [from, to, p] = locate(scene, t);
    const sliding = settings.transition === 'slide';
    const e = sliding ? easeInOutCubic(p) : smoothstep(p);

    if (settings.fit === 'contain' && settings.background === 'blur') {
      ctx.drawImage(slides[from].slide.backdrop, 0, 0, W, H);
      if (to !== from) blit(ctx, slides[to].slide.backdrop, 0, 0, e, W, H);
    }

    const a = slides[from].sprite;
    if (to === from) {
      blit(ctx, a.image, a.x, a.y, 1);
    } else if (sliding) {
      const b = slides[to].sprite;
      blit(ctx, a.image, a.x - e * W, a.y, 1);
      blit(ctx, b.image, b.x + (1 - e) * W, b.y, 1);
    } else {
      // The outgoing slide only fades in the second half, so no background shows through mid-way.
      const b = slides[to].sprite;
      blit(ctx, a.image, a.x, a.y, Math.min(1, 2 - 2 * e));
      blit(ctx, b.image, b.x, b.y, e);
    }

    if (settings.showDots && slides.length > 1) drawDots(ctx, slides.length, from, to, e, scene.dotsY);
  }

  if (scene.credit) blit(ctx, scene.credit.image, scene.credit.x, scene.credit.y, 1);
  ctx.globalAlpha = 1;
}

function blit(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  alpha: number,
  w?: number,
  h?: number,
) {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  if (w !== undefined && h !== undefined) ctx.drawImage(image, x, y, w, h);
  else ctx.drawImage(image, x, y);
}

function drawDots(ctx: CanvasRenderingContext2D, count: number, from: number, to: number, e: number, y: number) {
  const width = count * DOT + (count - 1) * DOT_SPACING;
  let x = (W - width) / 2 + DOT / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 6;
  for (let i = 0; i < count; i++) {
    const active = (i === from ? 1 - e : 0) + (i === to ? e : 0);
    ctx.globalAlpha = 0.38 + 0.62 * Math.min(1, active);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, DOT / 2, 0, Math.PI * 2);
    ctx.fill();
    x += DOT + DOT_SPACING;
  }
  ctx.restore();
}
