import { describe, expect, it } from "vitest";

import { getArgumentCompletions, parseColors, parseSpeed } from "./command.ts";

describe("cat lineups", () => {
  it.each(["", "white purple"])(
    "rejects invalid lineup %j instead of accepting a partial list",
    (value) => {
      expect(parseColors(value)).toBeUndefined();
    },
  );

  it("completes the current color without dropping earlier cats", () => {
    expect(getArgumentCompletions("color white black gr")?.map((item) => item.value)).toEqual([
      "color white black gray",
      "color white black grey",
    ]);
    expect(
      getArgumentCompletions("color white ")?.some((item) => item.value === "color white white"),
    ).toBe(true);
  });

  it("allows completing cat five but not adding cat six or continuing an invalid list", () => {
    expect(
      getArgumentCompletions("color white black gray white y")?.map((item) => item.value),
    ).toEqual(["color white black gray white yellow"]);
    expect(getArgumentCompletions("color white black gray white yellow ")).toBeNull();
    expect(getArgumentCompletions("color purple ")).toBeNull();
  });
});

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
