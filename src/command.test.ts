import { describe, expect, it } from "vitest";

import { parseSpeed } from "./command.ts";

describe("parseSpeed", () => {
  it.each([
    ["slow", 10],
    ["normal", 20],
    ["fast", 30],
    ["1", 1],
    ["60", 60],
  ])("parses %s as %i FPS", (value, expected) => {
    expect(parseSpeed(value)).toBe(expected);
  });

  it.each(["", "0", "61", "10.5", "quick", "NaN"])("rejects %s", (value) => {
    expect(parseSpeed(value)).toBeUndefined();
  });
});
