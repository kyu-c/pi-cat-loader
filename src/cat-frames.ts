import { BLACK_CAT_LOADER_FRAMES } from "./cat-frame-sets/black.ts";
import { CLASSIC_CAT_LOADER_FRAMES } from "./cat-frame-sets/classic.ts";
import { GRAY_CAT_LOADER_FRAMES } from "./cat-frame-sets/gray.ts";
import { WHITE_CAT_LOADER_FRAMES } from "./cat-frame-sets/white.ts";
import { YELLOW_CAT_LOADER_FRAMES } from "./cat-frame-sets/yellow.ts";

export const CAT_LOADER_INTERVAL_MS = 100;
export const CAT_LOADER_COLORS = ["classic", "black", "gray", "white", "yellow"] as const;
export type CatLoaderColor = (typeof CAT_LOADER_COLORS)[number];

export const CAT_LOADER_FRAMES_BY_COLOR = {
  classic: CLASSIC_CAT_LOADER_FRAMES,
  black: BLACK_CAT_LOADER_FRAMES,
  gray: GRAY_CAT_LOADER_FRAMES,
  white: WHITE_CAT_LOADER_FRAMES,
  yellow: YELLOW_CAT_LOADER_FRAMES,
} as const satisfies Record<CatLoaderColor, readonly string[]>;
