import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const CatLoaderSettingsSchema = Type.Object(
  {
    enabled: Type.Boolean({
      default: true,
      description: "Whether the cat loader is enabled.",
    }),
    sizeCells: Type.Integer({
      default: 4,
      minimum: 1,
      maximum: 20,
      description: "Width of the cat loader in terminal cells.",
    }),
    color: Type.Union(
      [
        Type.Literal("classic"),
        Type.Literal("black"),
        Type.Literal("gray"),
        Type.Literal("white"),
        Type.Literal("yellow"),
      ],
      { default: "classic", description: "Color of the cat loader." },
    ),
  },
  { additionalProperties: false },
);

export type CatLoaderSettings = Static<typeof CatLoaderSettingsSchema>;

const SETTINGS_KEY = "catLoader";
export const DEFAULT_SETTINGS: CatLoaderSettings = Value.Create(CatLoaderSettingsSchema);

function getGlobalSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function parseSettings(value: unknown): CatLoaderSettings {
  return Value.Parse(CatLoaderSettingsSchema, Value.Repair(CatLoaderSettingsSchema, value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readSettingsFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function loadSettings(cwd: string): Promise<CatLoaderSettings> {
  const globalSettings = await readSettingsFile(getGlobalSettingsPath());
  const projectSettings = await readSettingsFile(getProjectSettingsPath(cwd));
  const rawSettings = {
    ...(isObject(globalSettings[SETTINGS_KEY]) ? globalSettings[SETTINGS_KEY] : {}),
    ...(isObject(projectSettings[SETTINGS_KEY]) ? projectSettings[SETTINGS_KEY] : {}),
  };
  return parseSettings(rawSettings);
}

export async function saveSettings(_cwd: string, settings: CatLoaderSettings): Promise<void> {
  const settingsPath = getGlobalSettingsPath();
  const fileSettings = await readSettingsFile(settingsPath);

  fileSettings[SETTINGS_KEY] = settings;
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(fileSettings, null, 2)}\n`, "utf8");
}
