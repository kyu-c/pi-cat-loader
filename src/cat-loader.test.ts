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

  function getImageIds(line: string): number[] {
    return [...line.matchAll(/\x1b_Ga=p,i=(\d+)/g)].map((match) => Number(match[1]));
  }

  function deletePlacements(imageId: number): string {
    return `\x1b_Ga=d,d=i,i=${imageId},q=2\x1b\\`;
  }

  it("draws synchronized cats with separate placements and shared cached frames", () => {
    showCatLoader(ctx);
    const lines = widget!.render(26);

    expect(lines).toHaveLength(2);
    const ids = getImageIds(lines[1]);
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe(ids[3]);
    expect(writes).toHaveLength(4);

    vi.advanceTimersByTime(50);
    const nextLine = widget!.render(26)[1];
    const nextIds = getImageIds(nextLine);

    const colors = ["white", "black", "gray", "white", "peach"] as const;
    for (const [index, color] of colors.entries()) {
      const offset = index ? `\x1b[${index * 5}C` : "";
      expect(nextLine).toContain(
        `\x1b7\x1b[1A${offset}\x1b_Ga=p,i=${nextIds[index]},p=${index + 1},q=2,C=1,c=4,r=2\x1b\\\x1b8`,
      );
    }
    expect(nextIds[0]).toBe(nextIds[3]);
    expect(writes).toHaveLength(8);
    for (const [index, color] of colors.entries()) {
      if (index === 3) continue; // The second white cat shares the first one's upload.
      expect(writes).toContain(
        encodeKitty(CAT_LOADER_FRAMES_BY_COLOR[color][1], { imageId: nextIds[index] }).replace(
          "\x1b_Ga=T,",
          "\x1b_Ga=t,",
        ),
      );
    }
  });

  it("reuses frames across loops and redraws, then frees even unplaced frames", () => {
    setCatLoaderColors(["classic"]);
    showCatLoader(ctx);
    const firstIds = getImageIds(widget!.render(6)[1]);
    const allIds = new Set(firstIds);

    for (let frame = 1; frame < CAT_LOADER_FRAMES_BY_COLOR.classic.length; frame++) {
      vi.advanceTimersByTime(50);
      for (const id of getImageIds(widget!.render(6)[1])) allIds.add(id);
    }
    const uploadCount = writes.length;
    vi.advanceTimersByTime(50);
    widget!.invalidate();
    const looped = widget!.render(6)[1];
    widget!.render(6);

    expect(getImageIds(looped)).toEqual(firstIds);
    expect(writes).toHaveLength(uploadCount);
    expect(looped).not.toContain("a=t");
    expect(looped).not.toContain("a=T");

    widget!.render(1);
    hideCatLoader(ctx);

    for (const id of allIds) expect(writes.at(-1)).toContain(deleteKittyImage(id));
    expect(vi.getTimerCount()).toBe(0);
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

  it("clips trailing cats without freeing cached frames on resize", () => {
    showCatLoader(ctx);
    const ids = getImageIds(widget!.render(26)[1]);
    const uploadCount = writes.length;

    const narrow = widget!.render(10)[1];

    expect(getImageIds(narrow)).toEqual(ids.slice(0, 1));
    expect(narrow).toContain("c=4,r=2");
    for (const id of ids) expect(narrow).toContain(deletePlacements(id));
    expect(getImageIds(widget!.render(11)[1])).toEqual(ids.slice(0, 2));

    const hidden = widget!.render(5).join("");

    expect(getImageIds(hidden)).toEqual([]);
    expect(hidden).toContain(deletePlacements(ids[0]));
    expect(hidden).toContain(deletePlacements(ids[1]));
    expect(getImageIds(widget!.render(26)[1])).toEqual(ids);
    expect(writes).toHaveLength(uploadCount);
  });

  it("cleans up every image and timer when hidden or replaced by a single cat", () => {
    showCatLoader(ctx);
    const ids = getImageIds(widget!.render(26)[1]);
    setCatLoaderColors(["black"]);
    previewCatLoader(ctx);
    for (const id of ids) expect(writes.join("")).toContain(deleteKittyImage(id));
    const singleIds = getImageIds(widget!.render(26)[1]);
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
    const ids = getImageIds(widget!.render(26)[1]);
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
