import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  allocateImageId,
  calculateImageRows,
  deleteAllKittyImages,
  deleteKittyImage,
  getCellDimensions,
  Image,
  type AutocompleteItem,
  type Component,
  type TUI,
} from "@mariozechner/pi-tui";

import { CAT_LOADER_FRAMES, CAT_LOADER_INTERVAL_MS } from "./cat-frames.ts";
import { loadSettings, saveSettings } from "./settings.ts";

interface WorkingUi {
  setWorkingIndicator?: (options?: { frames?: string[]; intervalMs?: number }) => void;
  setWorkingMessage?: (message?: string) => void;
  setWorkingVisible?: (visible: boolean) => void;
}

const WIDGET_KEY = "cat-loader";
const IMAGE_LEFT_MARGIN_CELLS = 1;
const SOURCE_DIMENSIONS = { widthPx: 112, heightPx: 112 };
const MIN_SIZE_CELLS = 1;
const MAX_SIZE_CELLS = 20;
const SIZE_ALIASES = {
  small: 2,
  medium: 4,
  large: 6,
} as const;
const SIZE_COMPLETIONS: AutocompleteItem[] = [
  { value: "size small", label: "small", description: "2 cells wide" },
  { value: "size medium", label: "medium", description: "4 cells wide" },
  { value: "size large", label: "large", description: "6 cells wide" },
];
const COMMAND_ACTIONS: AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable cat loader" },
  { value: "off", label: "off", description: "Disable cat loader" },
  { value: "size", label: "size", description: "Set cat loader width in cells" },
  { value: "preview", label: "preview", description: "Show cat loader for 5 seconds" },
  { value: "clear", label: "clear", description: "Clear terminal images" },
  { value: "help", label: "help", description: "Show usage" },
];
const COMMAND_USAGE = [
  "Usage: /cat-loader [on|off|preview|clear|size <cells|small|medium|large>]",
  "on      Enable cat loader",
  "off     Disable cat loader",
  "preview Show cat loader for 5 seconds",
  "clear   Clear terminal images",
  "size    Set cat loader width in cells (1-20) or alias (small, medium, large)",
].join("\n");

function isTmux(): boolean {
  return Boolean(process.env.TMUX) || (process.env.TERM ?? "").startsWith("tmux");
}

let enabled = true;
let sizeCells = 4;
let previewTimeout: NodeJS.Timeout | undefined;
let lastImageId: number | undefined;
let lastImageRows: number | undefined;
let lastTui: TUI | undefined;
let activeCatLoader: AnimatedCatLoader | undefined;

function getImageRows(): number {
  return calculateImageRows(SOURCE_DIMENSIONS, sizeCells, getCellDimensions());
}

function parseSize(value: string): number | undefined {
  if (value in SIZE_ALIASES) return SIZE_ALIASES[value as keyof typeof SIZE_ALIASES];
  const size = Number(value);
  if (!Number.isInteger(size) || size < MIN_SIZE_CELLS || size > MAX_SIZE_CELLS) return undefined;
  return size;
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
      this.frame = (this.frame + 1) % CAT_LOADER_FRAMES.length;
      this.tui.requestRender();
    }, CAT_LOADER_INTERVAL_MS);
  }

  render(width: number): string[] {
    const frame = CAT_LOADER_FRAMES[this.frame] ?? CAT_LOADER_FRAMES[0];
    const lines = new Image(
      frame,
      "image/png",
      { fallbackColor: this.fallbackColor },
      {
        maxWidthCells: Math.min(sizeCells, Math.max(1, width - 2)),
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

function getWorkingUi(ctx: ExtensionContext): WorkingUi {
  return ctx.ui as unknown as WorkingUi;
}

function resetInlineSpinner(ctx: ExtensionContext): void {
  const ui = getWorkingUi(ctx);
  ui.setWorkingMessage?.();
  ui.setWorkingIndicator?.();
}

function disposeActiveCatLoader(): void {
  activeCatLoader?.dispose();
  activeCatLoader = undefined;
}

function clearAllKittyImages(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  ctx.ui.setWidget(WIDGET_KEY, () => new DeleteAllCatLoaders(), {
    placement: "aboveEditor",
  });
  setTimeout(() => {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  }, 100);
}

function showCatLoader(ctx: ExtensionContext, force = false): void {
  if (!ctx.hasUI || (!enabled && !force) || isTmux()) return;

  const ui = getWorkingUi(ctx);
  ui.setWorkingVisible?.(false);
  disposeActiveCatLoader();

  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui, theme) => {
      activeCatLoader = new AnimatedCatLoader(tui, (text: string) => theme.fg("muted", text));
      return activeCatLoader;
    },
    { placement: "aboveEditor" },
  );
}

function hideCatLoader(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = undefined;
  }
  disposeActiveCatLoader();

  if (lastImageId !== undefined) {
    const imageId = lastImageId;
    const rows = lastImageRows ?? getImageRows();
    ctx.ui.setWidget(WIDGET_KEY, () => new DeleteCatLoader(imageId, rows), {
      placement: "aboveEditor",
    });
    setTimeout(() => {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      lastTui?.requestRender(true);
    }, 100);
  } else {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    lastTui?.requestRender(true);
  }
  getWorkingUi(ctx).setWorkingVisible?.(true);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const settings = await loadSettings(ctx.cwd);
    enabled = settings.enabled;
    sizeCells = settings.sizeCells;
    resetInlineSpinner(ctx);
    if (isTmux()) hideCatLoader(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    showCatLoader(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    hideCatLoader(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    hideCatLoader(ctx);
  });

  pi.registerCommand("cat-loader", {
    description:
      "Toggle PNG-frame cat loader animation. Args: on, off, preview, clear, size, help.",
    getArgumentCompletions: (prefix: string) => {
      const normalizedPrefix = prefix.trimStart().toLowerCase();
      if (normalizedPrefix.startsWith("size ")) {
        const sizePrefix = normalizedPrefix.slice("size ".length).trimStart();
        const completions = SIZE_COMPLETIONS.filter(
          (size) =>
            size.value.slice("size ".length).startsWith(sizePrefix) ||
            size.description?.startsWith(sizePrefix),
        );
        return completions.length > 0 ? completions : null;
      }
      const completions = COMMAND_ACTIONS.filter((action) =>
        action.value.startsWith(normalizedPrefix),
      );
      return completions.length > 0 ? completions : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      const [command, value] = action.split(/\s+/, 2);

      if (action === "help" || action === "?") {
        ctx.ui.notify(COMMAND_USAGE, "info");
        return;
      }

      if (action === "clear") {
        clearAllKittyImages(ctx);
        ctx.ui.notify("Cleared terminal images", "info");
        return;
      }

      if (action === "off" || action === "reset") {
        enabled = false;
        await saveSettings(ctx.cwd, { enabled, sizeCells });
        hideCatLoader(ctx);
        resetInlineSpinner(ctx);
        ctx.ui.notify("Cat loader disabled", "info");
        return;
      }

      if (command === "size") {
        const size = parseSize(value ?? "");
        if (size === undefined) {
          ctx.ui.notify(
            `Size must be small, medium, large, or an integer from ${MIN_SIZE_CELLS} to ${MAX_SIZE_CELLS}`,
            "error",
          );
          return;
        }
        sizeCells = size;
        await saveSettings(ctx.cwd, { enabled, sizeCells });
        hideCatLoader(ctx);
        ctx.ui.notify(`Cat loader size set to ${sizeCells} cells`, "info");
        return;
      }

      if (action === "preview" || action === "test") {
        if (isTmux()) {
          ctx.ui.notify("Cat loader disabled in tmux; using regular spinner", "info");
          return;
        }
        showCatLoader(ctx, true);
        previewTimeout = setTimeout(() => hideCatLoader(ctx), 5000);
        ctx.ui.notify("Showing cat loader preview", "info");
        return;
      }

      if (action !== "" && action !== "on") {
        ctx.ui.notify(COMMAND_USAGE, "error");
        return;
      }

      enabled = true;
      await saveSettings(ctx.cwd, { enabled, sizeCells });
      ctx.ui.notify(
        isTmux() ? "Cat loader disabled in tmux; using regular spinner" : "Cat loader enabled",
        "info",
      );
    },
  });
}
