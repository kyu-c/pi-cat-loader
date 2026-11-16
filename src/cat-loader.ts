import { deflateSync } from "node:zlib";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  allocateImageId,
  deleteAllKittyImages,
  deleteKittyImage,
  encodeKitty,
  encodeITerm2,
  getCapabilities,
  getCellDimensions,
  Image,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  CAT_LOADER_COLORS,
  CAT_LOADER_FRAMES_BY_COLOR,
  MAX_CATS,
  type CatLoaderColor,
  type CatLoaderColorOption,
} from "./cat-frames.ts";
import type { CatLoaderSettings } from "./settings.ts";

type ExtensionUi = ExtensionContext["ui"];

const WIDGET_KEY = "cat-loader";
const IMAGE_LEFT_MARGIN_CELLS = 1;
const SOURCE_DIMENSIONS = { widthPx: 112, heightPx: 112 };
const CONFETTI_MIN_CATS = 3;
const CONFETTI_PIECES_PER_POPPER = 24;
// After the pop, confetti rains from the top at a steady rate for this long.
const CONFETTI_RAIN_SECONDS = 5.5;
const CONFETTI_RAIN_PIECES_PER_COLUMN_PER_SECOND = 1.6;
const CONFETTI_PIECE_WIDTH_CELLS = 0.5;
const CONFETTI_PIECE_HEIGHT_CELLS = 0.3;
// Physics units are cells and seconds; y grows downward.
const CONFETTI_GRAVITY = 8;
const CONFETTI_MAX_FALL_SPEED = 1.5;
const CONFETTI_DRAG_PER_SECOND = 0.2;
const CONFETTI_SWAY = 1;
const CONFETTI_COLORS = [
  [255, 124, 107],
  [255, 209, 102],
  [6, 214, 160],
  [76, 201, 240],
  [199, 125, 255],
  [255, 158, 199],
];

let enabled = true;
let sizeCells = 4;
let framesPerSecond = 20;
let colors: CatLoaderColorOption[] = ["classic"];
let confetti = true;
let previewTimeout: NodeJS.Timeout | undefined;
let lastTui: TUI | undefined;
let activeCatLoader: AnimatedCatLoader | undefined;

export function isTmux(): boolean {
  return Boolean(process.env.TMUX) || (process.env.TERM ?? "").startsWith("tmux");
}

export function configureCatLoader(settings: CatLoaderSettings): void {
  enabled = settings.enabled;
  sizeCells = settings.sizeCells;
  framesPerSecond = settings.framesPerSecond;
  colors = [...settings.colors];
  confetti = settings.confetti;
}

export function getCatLoaderEnabled(): boolean {
  return enabled;
}

export function setCatLoaderEnabled(value: boolean): void {
  enabled = value;
}

export function getCatLoaderSize(): number {
  return sizeCells;
}

export function setCatLoaderSize(value: number): void {
  sizeCells = value;
}

export function getCatLoaderFramesPerSecond(): number {
  return framesPerSecond;
}

export function setCatLoaderFramesPerSecond(value: number): void {
  framesPerSecond = value;
  disposeActiveCatLoader();
}

export function getCatLoaderColors(): CatLoaderColorOption[] {
  return [...colors];
}

export function setCatLoaderColors(value: CatLoaderColorOption[]): void {
  colors = [...value];
}

export function getCatLoaderConfetti(): boolean {
  return confetti;
}

export function setCatLoaderConfetti(value: boolean): void {
  confetti = value;
}

function getSquareImageRows(widthCells: number): number {
  const cellDimensions = getCellDimensions();
  const targetWidthPx = widthCells * cellDimensions.widthPx;
  const targetHeightPx = targetWidthPx * (SOURCE_DIMENSIONS.heightPx / SOURCE_DIMENSIONS.widthPx);
  // Reserve enough rows for the full image; Kitty derives its height from c and the aspect ratio.
  return Math.max(1, Math.ceil(targetHeightPx / cellDimensions.heightPx));
}

function getImageRows(): number {
  return getSquareImageRows(sizeCells);
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

type ConfettiPiece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  spin: number;
  color: readonly number[];
};

// Kitty raw RGBA (f=32), zlib-compressed (o=z); mostly transparent, so it stays small.
function encodeKittyRgba(
  pixels: Uint8Array,
  widthPx: number,
  heightPx: number,
  options: { columns: number; rows: number; imageId: number },
): string {
  const data = deflateSync(pixels).toString("base64");
  const params = `a=T,f=32,o=z,s=${widthPx},v=${heightPx},q=2,C=1,c=${options.columns},r=${options.rows},i=${options.imageId},z=1`;
  const chunks = data.match(/.{1,4096}/g) ?? [""];
  return chunks
    .map((chunk, index) => {
      const more = index < chunks.length - 1 ? 1 : 0;
      return index === 0
        ? `\x1b_G${params},m=${more};${chunk}\x1b\\`
        : `\x1b_Gm=${more};${chunk}\x1b\\`;
    })
    .join("");
}

// Two party poppers fire once from the bottom corners of the cat area toward each other,
// then confetti rains from the top for a few seconds.
// Physics runs in cell units; pieces are drawn as small tumbling pixel rectangles.
class ConfettiPopper {
  private pieces: ConfettiPiece[] = [];
  private steps = 0;

  constructor(private lastFrame: number) {}

  render(frame: number, rows: number, columns: number, imageId: number): string {
    for (; this.lastFrame < frame; this.lastFrame++) this.step(rows, columns);
    if (this.pieces.length === 0) return "";

    const { widthPx: cellWidthPx, heightPx: cellHeightPx } = getCellDimensions();
    const widthPx = columns * cellWidthPx;
    const heightPx = rows * cellHeightPx;
    const pixels = new Uint8Array(widthPx * heightPx * 4);
    const pieceWidthPx = Math.max(2, cellWidthPx * CONFETTI_PIECE_WIDTH_CELLS);
    const pieceHeightPx = Math.max(1, cellWidthPx * CONFETTI_PIECE_HEIGHT_CELLS);
    for (const piece of this.pieces) {
      // Shrinking width with the spin phase makes each piece look like it flips.
      const halfWidth = Math.max(0.5, (pieceWidthPx * Math.abs(Math.cos(piece.phase))) / 2);
      const halfHeight = pieceHeightPx / 2;
      const centerX = piece.x * cellWidthPx;
      const centerY = piece.y * cellHeightPx;
      const left = Math.max(0, Math.round(centerX - halfWidth));
      const right = Math.min(widthPx, Math.round(centerX + halfWidth));
      const top = Math.max(0, Math.round(centerY - halfHeight));
      const bottom = Math.min(heightPx, Math.round(centerY + halfHeight));
      const rgba = [...piece.color, 255];
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          pixels.set(rgba, (y * widthPx + x) * 4);
        }
      }
    }
    return encodeKittyRgba(pixels, widthPx, heightPx, { columns, rows, imageId });
  }

  private step(rows: number, columns: number): void {
    const dt = 1 / framesPerSecond;
    const elapsed = this.steps++ * dt;
    if (elapsed === 0) this.pop(rows, columns);
    this.rain(elapsed, dt, columns);

    const drag = CONFETTI_DRAG_PER_SECOND ** dt;
    for (const piece of this.pieces) {
      piece.vy = Math.min(piece.vy + CONFETTI_GRAVITY * dt, CONFETTI_MAX_FALL_SPEED);
      piece.vx *= drag;
      piece.phase += piece.spin * dt;
      piece.x += (piece.vx + Math.sin(piece.phase) * CONFETTI_SWAY) * dt;
      piece.y += piece.vy * dt;
    }
    this.pieces = this.pieces.filter(
      (piece) => piece.y < rows + 1 && piece.x >= -1 && piece.x < columns + 1,
    );
  }

  private pop(rows: number, columns: number): void {
    for (const direction of [1, -1]) {
      for (let index = 0; index < CONFETTI_PIECES_PER_POPPER; index++) {
        this.addPiece(
          direction === 1 ? 0 : columns,
          rows,
          direction * (4 + Math.random() * 18),
          -(2 + Math.random() * 4),
        );
      }
    }
  }

  private rain(elapsed: number, dt: number, columns: number): void {
    if (elapsed >= CONFETTI_RAIN_SECONDS) return;

    // Spawn `expected` pieces on average, including a random fractional remainder.
    const expected = CONFETTI_RAIN_PIECES_PER_COLUMN_PER_SECOND * columns * dt;
    for (let remaining = expected; remaining > 0; remaining--) {
      if (Math.random() < remaining) {
        this.addPiece(Math.random() * columns, -0.2, Math.random() - 0.5, 0);
      }
    }
  }

  private addPiece(x: number, y: number, vx: number, vy: number): void {
    this.pieces.push({
      x,
      y,
      vx,
      vy,
      phase: Math.random() * Math.PI,
      spin: 6 + Math.random() * 10,
      color: pickRandom(CONFETTI_COLORS),
    });
  }
}

function isRandomJackpot(resolvedColors: CatLoaderColor[], count: number): boolean {
  return (
    confetti &&
    count >= CONFETTI_MIN_CATS &&
    colors.every((color) => color === "random") &&
    resolvedColors.slice(0, count).every((color) => color === resolvedColors[0])
  );
}

class DeleteAllCatLoaders implements Component {
  render(): string[] {
    const rows = getImageRows();
    return [...Array.from({ length: Math.max(0, rows - 1) }, () => ""), deleteAllKittyImages()];
  }

  invalidate(): void {}
}

class AnimatedCatLoader implements Component {
  private frame = 0;
  private readonly randomColors: CatLoaderColor[] = [];
  private readonly imageIds = Array.from({ length: MAX_CATS }, () => allocateImageId());
  private readonly confettiImageId = allocateImageId();
  private renderedImageIds: number[] = [];
  private confettiPopper: ConfettiPopper | undefined;
  private readonly interval: NodeJS.Timeout;

  constructor(
    private readonly tui: TUI,
    private readonly fallbackColor: (text: string) => string,
  ) {
    this.resolveColors();
    lastTui = this.tui;
    this.interval = setInterval(() => {
      this.frame += 1;
      this.tui.requestRender();
    }, 1000 / framesPerSecond);
  }

  private resolveColors(): CatLoaderColor[] {
    return colors.map((color, index) =>
      color === "random"
        ? (this.randomColors[index] ??=
            CAT_LOADER_COLORS[Math.floor(Math.random() * CAT_LOADER_COLORS.length)])
        : color,
    );
  }

  render(width: number): string[] {
    const resolvedColors = this.resolveColors();
    // Keep one cell at either edge. Only draw whole cats; never shrink or wrap.
    const count = Math.min(colors.length, Math.max(0, Math.floor((width - 1) / (sizeCells + 1))));
    const cleanup = this.renderedImageIds.map(deleteKittyImage).join("");
    this.renderedImageIds = [];
    if (count === 0) return [cleanup];

    const protocol = getCapabilities().images;
    if (!protocol) {
      const frames = CAT_LOADER_FRAMES_BY_COLOR[resolvedColors[0]];
      return new Image(
        frames[this.frame % frames.length],
        "image/png",
        { fallbackColor: this.fallbackColor },
        { maxWidthCells: sizeCells },
        SOURCE_DIMENSIONS,
      ).render(width);
    }

    const cellDimensions = getCellDimensions();
    const rows =
      protocol === "kitty"
        ? getSquareImageRows(sizeCells)
        : Math.max(1, Math.ceil((sizeCells * cellDimensions.widthPx) / cellDimensions.heightPx));
    const moveUp = rows > 1 ? `\x1b[${rows - 1}A` : "";
    const confetti =
      protocol === "kitty" && isRandomJackpot(resolvedColors, count)
        ? (this.confettiPopper ??= new ConfettiPopper(this.frame)).render(
            this.frame,
            rows,
            IMAGE_LEFT_MARGIN_CELLS + count * (sizeCells + 1),
            this.confettiImageId,
          )
        : "";
    if (confetti) this.renderedImageIds.push(this.confettiImageId);

    // Confetti covers the whole cat area from column 0, layered above cats (z=1).
    let line = cleanup + (confetti ? `\x1b7${moveUp}${confetti}\x1b8` : "");
    line += " ".repeat(IMAGE_LEFT_MARGIN_CELLS);
    for (let index = 0; index < count; index++) {
      const frames = CAT_LOADER_FRAMES_BY_COLOR[resolvedColors[index]];
      const frame = frames[this.frame % frames.length];
      const imageId = this.imageIds[index];
      const sequence =
        protocol === "kitty"
          ? encodeKitty(frame, { columns: sizeCells, imageId, moveCursor: false })
          : encodeITerm2(frame, { width: sizeCells, height: "auto" });
      if (protocol === "kitty") this.renderedImageIds.push(imageId);

      // Anchor each image to the same baseline, independent of the protocol's
      // cursor movement. Restore it so both the next cat and TUI stay aligned.
      const moveRight = index > 0 ? `\x1b[${index * (sizeCells + 1)}C` : "";
      line += `\x1b7${moveUp}${moveRight}${sequence}\x1b8`;
    }
    return [...Array.from({ length: rows - 1 }, () => ""), line];
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.interval);
    if (this.renderedImageIds.length > 0) {
      this.tui.terminal.write(this.renderedImageIds.map(deleteKittyImage).join(""));
      this.renderedImageIds = [];
    }
  }
}

export function resetInlineSpinner(ctx: ExtensionContext): void {
  ctx.ui.setWorkingMessage();
  ctx.ui.setWorkingIndicator();
}

function disposeActiveCatLoader(): void {
  activeCatLoader?.dispose();
  activeCatLoader = undefined;
}

function hideCatLoaderWithUi(ui: ExtensionUi): void {
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = undefined;
  }
  disposeActiveCatLoader();

  ui.setWidget(WIDGET_KEY, undefined);
  lastTui?.requestRender(true);
  lastTui = undefined;
  ui.setWorkingVisible(true);
}

export function clearAllKittyImages(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  const ui = ctx.ui;
  hideCatLoaderWithUi(ui);
  ui.setWidget(WIDGET_KEY, () => new DeleteAllCatLoaders(), {
    placement: "aboveEditor",
  });
  setTimeout(() => {
    try {
      ui.setWidget(WIDGET_KEY, undefined);
    } catch {
      // UI may be stale after session reload.
    }
  }, 100);
}

export function showCatLoader(ctx: ExtensionContext, force = false): void {
  if (ctx.mode !== "tui" || (!enabled && !force) || isTmux()) return;

  const ui = ctx.ui;
  hideCatLoaderWithUi(ui);
  ui.setWorkingVisible(false);

  ui.setWidget(
    WIDGET_KEY,
    (tui, theme) => {
      activeCatLoader = new AnimatedCatLoader(tui, (text: string) => theme.fg("muted", text));
      return activeCatLoader;
    },
    { placement: "aboveEditor" },
  );
}

export function hideCatLoader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  hideCatLoaderWithUi(ctx.ui);
}

export function previewCatLoader(ctx: ExtensionContext): void {
  showCatLoader(ctx, true);
  if (ctx.mode !== "tui") return;

  const ui = ctx.ui;
  previewTimeout = setTimeout(() => {
    try {
      hideCatLoaderWithUi(ui);
    } catch {
      // UI may be stale after session reload.
    }
  }, 5000);
}
