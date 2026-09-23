import type { AutocompleteItem } from "@earendil-works/pi-tui";

import {
  CAT_LOADER_COLORS,
  MAX_CATS,
  type CatLoaderColor,
  type CatLoaderColorOption,
} from "./cat-frames.ts";

export const MIN_SIZE_CELLS = 1;
export const MAX_SIZE_CELLS = 20;
export const MIN_FRAMES_PER_SECOND = 1;
export const MAX_FRAMES_PER_SECOND = 60;

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

const SPEED_ALIASES = {
  slow: 10,
  normal: 20,
  fast: 30,
} as const;

const SPEED_COMPLETIONS: AutocompleteItem[] = [
  { value: "speed slow", label: "slow", description: "10 frames per second" },
  { value: "speed normal", label: "normal", description: "20 frames per second" },
  { value: "speed fast", label: "fast", description: "30 frames per second" },
];

const COMMAND_ACTIONS: AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable cat loader" },
  { value: "off", label: "off", description: "Disable cat loader" },
  { value: "size", label: "size", description: "Set each cat's width in cells" },
  { value: "speed", label: "speed", description: "Set cat loader frame rate" },
  { value: "color", label: "color", description: "Set ordered lineup of 1–5 cat colors" },
  { value: "preview", label: "preview", description: "Show cat loader for 5 seconds" },
  { value: "clear", label: "clear", description: "Clear terminal images" },
  { value: "help", label: "help", description: "Show usage" },
];

export const COMMAND_DESCRIPTION =
  "Toggle PNG-frame cat loader animation. Args: on, off, preview, clear, size, speed, color, help.";

export const COMMAND_USAGE = [
  "Usage: /cat-loader [on|off|preview|clear|size <cells|small|medium|large>|speed <fps|slow|normal|fast>|color <color> [color ...]]",
  "on      Enable cat loader",
  "off     Disable cat loader",
  "preview Show cat loader for 5 seconds",
  "clear   Clear terminal images",
  "size    Set each cat's width in cells (1-20) or alias (small, medium, large)",
  "speed   Set frame rate in FPS (1-60) or alias (slow, normal, fast)",
  "color   Set 1–5 ordered cat colors (classic, black, gray/grey, white, peach, random); repeats allowed",
].join("\n");

export function getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
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
  if (normalizedPrefix.startsWith("speed ")) {
    const speedPrefix = normalizedPrefix.slice("speed ".length).trimStart();
    const completions = SPEED_COMPLETIONS.filter(
      (speed) =>
        speed.value.slice("speed ".length).startsWith(speedPrefix) ||
        speed.description?.startsWith(speedPrefix),
    );
    return completions.length > 0 ? completions : null;
  }
  if (normalizedPrefix.startsWith("color ")) {
    const tokens = normalizedPrefix.slice("color ".length).trimStart().split(/\s+/);
    const colorPrefix = tokens.pop() ?? "";
    if (tokens.length >= MAX_CATS || tokens.some((token) => parseColor(token) === undefined)) {
      return null;
    }
    const completions = [...CAT_LOADER_COLORS, "grey", "random"]
      .filter((color) => color.startsWith(colorPrefix))
      .map((color) => ({
        value: ["color", ...tokens, color].join(" "),
        label: color,
        description: `Cat ${tokens.length + 1}: ${color}`,
      }));
    return completions.length > 0 ? completions : null;
  }
  const completions = COMMAND_ACTIONS.filter((action) => action.value.startsWith(normalizedPrefix));
  return completions.length > 0 ? completions : null;
}

export function parseSize(value: string): number | undefined {
  if (value in SIZE_ALIASES) return SIZE_ALIASES[value as keyof typeof SIZE_ALIASES];
  const size = Number(value);
  if (!Number.isInteger(size) || size < MIN_SIZE_CELLS || size > MAX_SIZE_CELLS) return undefined;
  return size;
}

export function parseSpeed(value: string): number | undefined {
  if (value in SPEED_ALIASES) return SPEED_ALIASES[value as keyof typeof SPEED_ALIASES];
  const framesPerSecond = Number(value);
  if (
    !Number.isInteger(framesPerSecond) ||
    framesPerSecond < MIN_FRAMES_PER_SECOND ||
    framesPerSecond > MAX_FRAMES_PER_SECOND
  ) {
    return undefined;
  }
  return framesPerSecond;
}

export function parseColor(value: string): CatLoaderColorOption | undefined {
  const color = value.toLowerCase() === "grey" ? "gray" : value.toLowerCase();
  if (color === "random") return color;
  return CAT_LOADER_COLORS.includes(color as CatLoaderColor)
    ? (color as CatLoaderColor)
    : undefined;
}

export function parseColors(value: string): CatLoaderColorOption[] | undefined {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length > MAX_CATS) return undefined;
  const colors = tokens.map(parseColor);
  return colors.every((color): color is CatLoaderColorOption => color !== undefined)
    ? colors
    : undefined;
}
