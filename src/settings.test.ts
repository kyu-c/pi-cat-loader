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
      color: "classic",
    });
  });

  it("saves to global pi settings and preserves existing keys", async () => {
    const globalSettingsPath = join(home, ".pi", "agent", "settings.json");
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(globalSettingsPath, JSON.stringify({ theme: "dark" }));

    await saveSettings(cwd, { enabled: false, sizeCells: 8, color: "black" });

    await expect(readFile(globalSettingsPath, "utf8").then(JSON.parse)).resolves.toEqual({
      theme: "dark",
      catLoader: { enabled: false, sizeCells: 8, color: "black" },
    });
  });

  it("lets project settings override global settings", async () => {
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ catLoader: { enabled: false } }),
    );
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ catLoader: { enabled: true } }),
    );

    await expect(loadSettings(cwd)).resolves.toEqual({
      enabled: true,
      sizeCells: 4,
      color: "classic",
    });
  });

  it("ignores project settings when they are not trusted", async () => {
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ catLoader: { enabled: false } }),
    );
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ catLoader: { enabled: true } }),
    );

    await expect(loadSettings(cwd, { includeProjectSettings: false })).resolves.toEqual({
      enabled: false,
      sizeCells: 4,
      color: "classic",
    });
  });
});
