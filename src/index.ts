import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  clearAllKittyImages,
  configureCatLoader,
  getCatLoaderEnabled,
  getCatLoaderSize,
  hideCatLoader,
  isTmux,
  previewCatLoader,
  resetInlineSpinner,
  setCatLoaderEnabled,
  setCatLoaderSize,
  showCatLoader,
} from "./cat-loader.ts";
import {
  COMMAND_DESCRIPTION,
  COMMAND_USAGE,
  getArgumentCompletions,
  MAX_SIZE_CELLS,
  MIN_SIZE_CELLS,
  parseSize,
} from "./command.ts";
import { loadSettings, saveSettings } from "./settings.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    configureCatLoader(await loadSettings(ctx.cwd));
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
    description: COMMAND_DESCRIPTION,
    getArgumentCompletions,
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
        setCatLoaderEnabled(false);
        await saveSettings(ctx.cwd, {
          enabled: getCatLoaderEnabled(),
          sizeCells: getCatLoaderSize(),
        });
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
        setCatLoaderSize(size);
        await saveSettings(ctx.cwd, {
          enabled: getCatLoaderEnabled(),
          sizeCells: getCatLoaderSize(),
        });
        hideCatLoader(ctx);
        ctx.ui.notify(`Cat loader size set to ${getCatLoaderSize()} cells`, "info");
        return;
      }

      if (action === "preview" || action === "test") {
        if (isTmux()) {
          ctx.ui.notify("Cat loader disabled in tmux; using regular spinner", "info");
          return;
        }
        previewCatLoader(ctx);
        ctx.ui.notify("Showing cat loader preview", "info");
        return;
      }

      if (action !== "" && action !== "on") {
        ctx.ui.notify(COMMAND_USAGE, "error");
        return;
      }

      setCatLoaderEnabled(true);
      await saveSettings(ctx.cwd, {
        enabled: getCatLoaderEnabled(),
        sizeCells: getCatLoaderSize(),
      });
      ctx.ui.notify(
        isTmux() ? "Cat loader disabled in tmux; using regular spinner" : "Cat loader enabled",
        "info",
      );
    },
  });
}
