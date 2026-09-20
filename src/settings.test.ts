import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let home: string;

const { loadSettings, saveSettings } = await import("./settings.ts");

async function makeTempDir(name: string): Promise<string> {
  return await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), `${name}-`)),
  );
}

describe("settings", () => {
  let cwd: string;

  beforeEach(async () => {
    home = await makeTempDir("pi-cat-loader-home");
    cwd = await makeTempDir("pi-cat-loader-cwd");
    process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
  });

  it("defaults enabled when no settings exist", async () => {
    await expect(loadSettings(cwd)).resolves.toEqual({
      enabled: true,
      sizeCells: 4,
      framesPerSecond: 20,
      colors: ["classic"],
    });
  });

  it("saves to global pi settings and preserves existing keys", async () => {
    const globalSettingsPath = join(home, ".pi", "agent", "settings.json");
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(globalSettingsPath, JSON.stringify({ theme: "dark" }));

    await saveSettings(cwd, {
      enabled: false,
      sizeCells: 8,
      framesPerSecond: 20,
      colors: ["white", "black", "gray", "black", "yellow"],
    });

    await expect(readFile(globalSettingsPath, "utf8").then(JSON.parse)).resolves.toEqual({
      theme: "dark",
      catLoader: {
        enabled: false,
        sizeCells: 8,
        framesPerSecond: 20,
        colors: ["white", "black", "gray", "black", "yellow"],
      },
    });
  });

  it("migrates legacy color and saves only the new lineup", async () => {
    const path = join(home, ".pi", "agent", "settings.json");
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(path, JSON.stringify({ catLoader: { color: "grey" } }));

    const settings = await loadSettings(cwd);
    expect(settings.colors).toEqual(["gray"]);
    await saveSettings(cwd, settings);
    const saved = JSON.parse(await readFile(path, "utf8")).catLoader;
    expect(saved.colors).toEqual(["gray"]);
    expect(saved).not.toHaveProperty("color");
  });

  it("merges trusted project overrides, including legacy color, into global settings", async () => {
    await saveSettings(cwd, {
      enabled: false,
      sizeCells: 8,
      framesPerSecond: 20,
      colors: ["white", "black"],
    });
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ catLoader: { enabled: true, color: "yellow" } }),
    );

    expect(await loadSettings(cwd)).toMatchObject({
      enabled: true,
      sizeCells: 8,
      colors: ["yellow"],
    });
    expect(await loadSettings(cwd, { includeProjectSettings: false })).toMatchObject({
      enabled: false,
      sizeCells: 8,
      colors: ["white", "black"],
    });
  });

  it("prefers new lineup over legacy color in the same scope and normalizes grey", async () => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        catLoader: { color: "yellow", colors: ["white", "grey", "white"] },
      }),
    );
    expect((await loadSettings(cwd)).colors).toEqual(["white", "gray", "white"]);
  });

  it.each([[], Array(6).fill("black"), ["white", "purple"]])(
    "falls back to one classic cat for invalid lineup %j",
    async (colors) => {
      await mkdir(join(cwd, ".pi"), { recursive: true });
      await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ catLoader: { colors } }));
      expect((await loadSettings(cwd)).colors).toEqual(["classic"]);
    },
  );
});
