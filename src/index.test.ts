import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import extension from "./index.ts";
import { configureCatLoader, getCatLoaderColors } from "./cat-loader.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

describe("color command", () => {
  let directory: string;
  let ctx: ExtensionCommandContext;
  let command: Parameters<ExtensionAPI["registerCommand"]>[1];
  const notify = vi.fn();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-cat-loader-command-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    notify.mockClear();
    configureCatLoader(DEFAULT_SETTINGS);
    extension({
      on() {},
      registerCommand(_name, options) {
        command = options;
      },
    } as ExtensionAPI);
    ctx = {
      mode: "print",
      cwd: directory,
      ui: { notify },
    } as unknown as ExtensionCommandContext;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function savedColors() {
    return JSON.parse(await readFile(join(directory, "settings.json"), "utf8")).catLoader.colors;
  }

  it("persists the entire ordered lineup, then replaces it with a single color", async () => {
    await command.handler("  color white BLACK\tgrey white yellow  ", ctx);
    expect(await savedColors()).toEqual(["white", "black", "gray", "white", "yellow"]);
    expect(getCatLoaderColors()).toEqual(await savedColors());

    await command.handler("color black", ctx);
    expect(await savedColors()).toEqual(["black"]);
    expect(getCatLoaderColors()).toEqual(["black"]);
  });

  it("rejects a sixth cat without changing runtime or saved lineup", async () => {
    await command.handler("color white black", ctx);
    await command.handler("color white black gray white yellow classic", ctx);
    expect(notify).toHaveBeenLastCalledWith(expect.any(String), "error");
    expect(await savedColors()).toEqual(["white", "black"]);
    expect(getCatLoaderColors()).toEqual(["white", "black"]);
  });
});
