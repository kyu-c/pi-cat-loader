import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  deleteKittyImage,
  encodeKitty,
  encodeITerm2,
  setCapabilities,
  resetCapabilitiesCache,
  getCellDimensions,
  setCellDimensions,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAT_LOADER_FRAMES_BY_COLOR } from "./cat-frames.ts";
import {
  configureCatLoader,
  hideCatLoader,
  previewCatLoader,
  setCatLoaderColors,
  showCatLoader,
} from "./cat-loader.ts";

describe("cat lineup rendering", () => {
  let widget: Component | undefined;
  let writes: string[];
  let ctx: ExtensionContext;
  const originalCellDimensions = getCellDimensions();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("TMUX", "");
    vi.stubEnv("TERM", "xterm-256color");
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    writes = [];
    widget = undefined;
    const tui = {
      requestRender() {},
      terminal: { write: (data: string) => writes.push(data) },
    } as unknown as TUI;
    ctx = {
      mode: "tui",
      ui: {
        setWorkingVisible() {},
        setWidget(
          _key: string,
          factory?: (tui: TUI, theme: { fg: (color: string, text: string) => string }) => Component,
        ) {
          widget = factory?.(tui, { fg: (_color, text) => text });
        },
      },
    } as unknown as ExtensionContext;
    configureCatLoader({
      enabled: true,
      sizeCells: 4,
      framesPerSecond: 20,
      colors: ["white", "black", "gray", "white", "peach"],
    });
  });

  afterEach(() => {
    hideCatLoader(ctx);
    resetCapabilitiesCache();
    setCellDimensions(originalCellDimensions);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function imageIds(line: string): number[] {
    return [...line.matchAll(/\x1b_Ga=T[^;]*,i=(\d+)/g)].map((match) => Number(match[1]));
  }

  it("draws five ordered cats on one baseline with distinct IDs and synchronized frames", () => {
    showCatLoader(ctx);
    const lines = widget!.render(26);
    expect(lines).toHaveLength(2);
    const ids = imageIds(lines[1]);
    expect(new Set(ids).size).toBe(5);
    vi.advanceTimersByTime(50);
    const nextLine = widget!.render(26)[1];
    const colors = ["white", "black", "gray", "white", "peach"] as const;
    for (const [index, color] of colors.entries()) {
      const offset = index ? `\x1b[${index * 5}C` : "";
      expect(
        nextLine.includes(
          `\x1b7\x1b[1A${offset}${encodeKitty(CAT_LOADER_FRAMES_BY_COLOR[color][1], {
            columns: 4,
            rows: 2,
            imageId: ids[index],
            moveCursor: false,
          })}\x1b8`,
        ),
      ).toBe(true);
    }
  });

  it("holds random color while loading and rerolls on restart", () => {
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    setCatLoaderColors(["random"]);
    showCatLoader(ctx);
    const first = widget!.render(6);
    random.mockReturnValue(0.999);
    widget!.render(1);
    expect(widget!.render(6)).toEqual(first);
    vi.advanceTimersByTime(50);
    expect(
      widget!
        .render(6)[1]
        .includes(
          encodeITerm2(CAT_LOADER_FRAMES_BY_COLOR.classic[1], { width: 4, height: "auto" }),
        ),
    ).toBe(true);
    previewCatLoader(ctx);
    expect(widget!.render(6)).not.toEqual(first);
  });

  it("clips trailing cats without shrinking and deletes their old images on resize", () => {
    showCatLoader(ctx);
    const ids = imageIds(widget!.render(26)[1]);
    const narrow = widget!.render(10)[1];
    expect(imageIds(narrow)).toEqual(ids.slice(0, 1));
    expect(narrow).toContain("c=4,r=2");
    for (const id of ids) expect(narrow).toContain(deleteKittyImage(id));
    expect(imageIds(widget!.render(11)[1])).toEqual(ids.slice(0, 2));
    const hidden = widget!.render(5).join("");
    expect(imageIds(hidden)).toEqual([]);
    expect(hidden).toContain(deleteKittyImage(ids[0]));
    expect(hidden).toContain(deleteKittyImage(ids[1]));
    expect(imageIds(widget!.render(26)[1])).toEqual(ids);
  });

  it("cleans up every image and timer when hidden or replaced by a single cat", () => {
    showCatLoader(ctx);
    const ids = imageIds(widget!.render(26)[1]);
    setCatLoaderColors(["black"]);
    previewCatLoader(ctx);
    for (const id of ids) expect(writes.join("")).toContain(deleteKittyImage(id));
    const singleIds = imageIds(widget!.render(26)[1]);
    expect(singleIds).toHaveLength(1);
    hideCatLoader(ctx);
    expect(writes.join("")).toContain(deleteKittyImage(singleIds[0]));
    expect(widget).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("assigns IDs to added cats even if settings change before preview restarts", () => {
    setCatLoaderColors(["white"]);
    showCatLoader(ctx);
    widget!.render(26);
    setCatLoaderColors(["white", "black", "gray"]);
    const ids = imageIds(widget!.render(26)[1]);
    expect(new Set(ids).size).toBe(3);
    hideCatLoader(ctx);
    for (const id of ids) expect(writes.join("")).toContain(deleteKittyImage(id));
  });

  it("positions iTerm2 cats independently on the same baseline", () => {
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    showCatLoader(ctx);
    const lines = widget!.render(16);
    expect(lines).toHaveLength(2);
    const line = lines[1];
    for (const [index, color] of (["white", "black", "gray"] as const).entries()) {
      const offset = index ? `\x1b[${index * 5}C` : "";
      expect(
        line.includes(
          `\x1b7\x1b[1A${offset}${encodeITerm2(CAT_LOADER_FRAMES_BY_COLOR[color][0], {
            width: 4,
            height: "auto",
          })}\x1b8`,
        ),
      ).toBe(true);
    }
    expect(line.match(/\x1b\]1337;File=/g)).toHaveLength(3);
    hideCatLoader(ctx);
    expect(writes).toEqual([]);
  });
});
