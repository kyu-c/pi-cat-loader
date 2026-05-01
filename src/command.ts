import type { AutocompleteItem } from "@mariozechner/pi-tui";

export const MIN_SIZE_CELLS = 1;
export const MAX_SIZE_CELLS = 20;

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

export const COMMAND_DESCRIPTION =
  "Toggle PNG-frame cat loader animation. Args: on, off, preview, clear, size, help.";

export const COMMAND_USAGE = [
  "Usage: /cat-loader [on|off|preview|clear|size <cells|small|medium|large>]",
  "on      Enable cat loader",
  "off     Disable cat loader",
  "preview Show cat loader for 5 seconds",
  "clear   Clear terminal images",
  "size    Set cat loader width in cells (1-20) or alias (small, medium, large)",
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
  const completions = COMMAND_ACTIONS.filter((action) => action.value.startsWith(normalizedPrefix));
  return completions.length > 0 ? completions : null;
}

export function parseSize(value: string): number | undefined {
  if (value in SIZE_ALIASES) return SIZE_ALIASES[value as keyof typeof SIZE_ALIASES];
  const size = Number(value);
  if (!Number.isInteger(size) || size < MIN_SIZE_CELLS || size > MAX_SIZE_CELLS) return undefined;
  return size;
}
