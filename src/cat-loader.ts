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

import { CAT_LOADER_FRAMES_BY_COLOR, MAX_CATS, type CatLoaderColor } from "./cat-frames.ts";
import type { CatLoaderSettings } from "./settings.ts";

type ExtensionUi = ExtensionContext["ui"];

const WIDGET_KEY = "cat-loader";
const IMAGE_LEFT_MARGIN_CELLS = 1;
const SOURCE_DIMENSIONS = { widthPx: 112, heightPx: 112 };

let enabled = true;
let sizeCells = 4;
let framesPerSecond = 20;
let colors: CatLoaderColor[] = ["classic"];
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

export function getCatLoaderColors(): CatLoaderColor[] {
  return [...colors];
}

export function setCatLoaderColors(value: CatLoaderColor[]): void {
  colors = [...value];
}

function getSquareImageRows(widthCells: number): number {
  const cellDimensions = getCellDimensions();
  const targetWidthPx = widthCells * cellDimensions.widthPx;
  const targetHeightPx = targetWidthPx * (SOURCE_DIMENSIONS.heightPx / SOURCE_DIMENSIONS.widthPx);
  return Math.max(1, Math.floor(targetHeightPx / cellDimensions.heightPx));
}

function getImageRows(): number {
  return getSquareImageRows(sizeCells);
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
  private readonly imageIds = Array.from({ length: MAX_CATS }, () => allocateImageId());
  private renderedImageIds: number[] = [];
  private readonly interval: NodeJS.Timeout;

  constructor(
    private readonly tui: TUI,
    private readonly fallbackColor: (text: string) => string,
  ) {
    lastTui = this.tui;
    this.interval = setInterval(() => {
      this.frame += 1;
      this.tui.requestRender();
    }, 1000 / framesPerSecond);
  }

  render(width: number): string[] {
    // Keep one cell at either edge. Only draw whole cats; never shrink or wrap.
    const count = Math.min(colors.length, Math.max(0, Math.floor((width - 1) / (sizeCells + 1))));
    const cleanup = this.renderedImageIds.map(deleteKittyImage).join("");
    this.renderedImageIds = [];
    if (count === 0) return [cleanup];

    const protocol = getCapabilities().images;
    if (!protocol) {
      const frames = CAT_LOADER_FRAMES_BY_COLOR[colors[0]];
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
    let line = " ".repeat(IMAGE_LEFT_MARGIN_CELLS) + cleanup;
    for (let index = 0; index < count; index++) {
      const frames = CAT_LOADER_FRAMES_BY_COLOR[colors[index]];
      const frame = frames[this.frame % frames.length];
      const imageId = this.imageIds[index];
      const sequence =
        protocol === "kitty"
          ? encodeKitty(frame, { columns: sizeCells, rows, imageId, moveCursor: false })
          : encodeITerm2(frame, { width: sizeCells, height: "auto" });
      if (protocol === "kitty") this.renderedImageIds.push(imageId);

      // Anchor each image to the same baseline, independent of the protocol's
      // cursor movement. Restore it so both the next cat and TUI stay aligned.
      const moveUp = rows > 1 ? `\x1b[${rows - 1}A` : "";
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
