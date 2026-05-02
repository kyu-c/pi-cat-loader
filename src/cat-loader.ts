import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  allocateImageId,
  deleteAllKittyImages,
  deleteKittyImage,
  encodeKitty,
  getCapabilities,
  getCellDimensions,
  Image,
  type Component,
  type TUI,
} from "@mariozechner/pi-tui";

import {
  CAT_LOADER_FRAMES_BY_COLOR,
  CAT_LOADER_INTERVAL_MS,
  type CatLoaderColor,
} from "./cat-frames.ts";
import type { CatLoaderSettings } from "./settings.ts";

interface WorkingUi {
  setWorkingIndicator?: (options?: { frames?: string[]; intervalMs?: number }) => void;
  setWorkingMessage?: (message?: string) => void;
  setWorkingVisible?: (visible: boolean) => void;
}

type ExtensionUi = ExtensionContext["ui"];

const WIDGET_KEY = "cat-loader";
const IMAGE_LEFT_MARGIN_CELLS = 1;
const SOURCE_DIMENSIONS = { widthPx: 112, heightPx: 112 };

let enabled = true;
let sizeCells = 4;
let color: CatLoaderColor = "classic";
let previewTimeout: NodeJS.Timeout | undefined;
let lastImageId: number | undefined;
let lastImageRows: number | undefined;
let lastTui: TUI | undefined;
let activeCatLoader: AnimatedCatLoader | undefined;

export function isTmux(): boolean {
  return Boolean(process.env.TMUX) || (process.env.TERM ?? "").startsWith("tmux");
}

export function configureCatLoader(settings: CatLoaderSettings): void {
  enabled = settings.enabled;
  sizeCells = settings.sizeCells;
  color = settings.color;
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

export function getCatLoaderColor(): CatLoaderColor {
  return color;
}

export function setCatLoaderColor(value: CatLoaderColor): void {
  color = value;
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

class DeleteCatLoader implements Component {
  constructor(
    private readonly imageId: number,
    private readonly rows: number,
  ) {}

  render(): string[] {
    return [
      ...Array.from({ length: Math.max(0, this.rows - 1) }, () => ""),
      deleteKittyImage(this.imageId),
    ];
  }

  invalidate(): void {}
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
  private readonly imageId = allocateImageId();
  private readonly interval: NodeJS.Timeout;

  constructor(
    private readonly tui: TUI,
    private readonly fallbackColor: (text: string) => string,
  ) {
    lastImageId = this.imageId;
    lastImageRows = getImageRows();
    lastTui = this.tui;
    this.interval = setInterval(() => {
      this.frame = (this.frame + 1) % CAT_LOADER_FRAMES_BY_COLOR[color].length;
      this.tui.requestRender();
    }, CAT_LOADER_INTERVAL_MS);
  }

  render(width: number): string[] {
    const frames = CAT_LOADER_FRAMES_BY_COLOR[color];
    const frame = frames[this.frame] ?? frames[0];
    const maxWidthCells = Math.min(sizeCells, Math.max(1, width - 2));
    const rows = getSquareImageRows(maxWidthCells);
    const lines =
      getCapabilities().images === "kitty"
        ? [
            ...Array.from({ length: Math.max(0, rows - 1) }, () => ""),
            `${rows > 1 ? `\x1b[${rows - 1}A` : ""}${encodeKitty(frame, {
              columns: maxWidthCells,
              rows,
              imageId: this.imageId,
            })}`,
          ]
        : new Image(
            frame,
            "image/png",
            { fallbackColor: this.fallbackColor },
            {
              maxWidthCells,
              imageId: this.imageId,
            },
            SOURCE_DIMENSIONS,
          ).render(width);

    const lastLine = lines[lines.length - 1];
    if (lastLine?.includes("\x1b_G")) {
      lines[lines.length - 1] = deleteKittyImage(this.imageId) + lastLine;
    }

    return lines.map((line) => " ".repeat(IMAGE_LEFT_MARGIN_CELLS) + line);
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.interval);
  }
}

function getWorkingUi(ui: ExtensionUi): WorkingUi {
  return ui as unknown as WorkingUi;
}

export function resetInlineSpinner(ctx: ExtensionContext): void {
  const ui = getWorkingUi(ctx.ui);
  ui.setWorkingMessage?.();
  ui.setWorkingIndicator?.();
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

  if (lastImageId !== undefined) {
    const imageId = lastImageId;
    const rows = lastImageRows ?? getImageRows();
    ui.setWidget(WIDGET_KEY, () => new DeleteCatLoader(imageId, rows), {
      placement: "aboveEditor",
    });
    setTimeout(() => {
      try {
        ui.setWidget(WIDGET_KEY, undefined);
        lastTui?.requestRender(true);
      } catch {
        // UI may be stale after session reload.
      }
    }, 100);
  } else {
    ui.setWidget(WIDGET_KEY, undefined);
    lastTui?.requestRender(true);
  }
  getWorkingUi(ui).setWorkingVisible?.(true);
}

export function clearAllKittyImages(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  const ui = ctx.ui;
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
  if (!ctx.hasUI || (!enabled && !force) || isTmux()) return;

  const ui = ctx.ui;
  const workingUi = getWorkingUi(ui);
  workingUi.setWorkingVisible?.(false);
  disposeActiveCatLoader();

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
  if (!ctx.hasUI) return;

  hideCatLoaderWithUi(ctx.ui);
}

export function previewCatLoader(ctx: ExtensionContext): void {
  showCatLoader(ctx, true);
  if (!ctx.hasUI) return;

  const ui = ctx.ui;
  previewTimeout = setTimeout(() => {
    try {
      hideCatLoaderWithUi(ui);
    } catch {
      // UI may be stale after session reload.
    }
  }, 5000);
}
