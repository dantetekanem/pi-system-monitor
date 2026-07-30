import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const ISMC_PATHS = [
  "/opt/homebrew/bin/iSMC",
  "/usr/local/bin/iSMC",
] as const;

const ISMC_ARGS = ["-o", "json", "temp"] as const;
const COMMAND_TIMEOUT_MS = 2000;

export type TemperatureCommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs?: number,
) => Promise<string>;

interface TemperatureTheme {
  fg(color: "success" | "warning" | "error", text: string): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validTemperature(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 150
    ? Math.round(value)
    : null;
}

function sensorQuantity(sensor: unknown): number | null {
  return isRecord(sensor) ? validTemperature(sensor.quantity) : null;
}

function sensorByKey(document: Record<string, unknown>, key: string): unknown {
  return Object.values(document).find((sensor) => isRecord(sensor) && sensor.key === key);
}

function isTemperatureTheme(theme: unknown): theme is TemperatureTheme {
  return isRecord(theme) && typeof theme.fg === "function";
}

export function shouldRunSystemMonitor(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return !(
    environment.PI_AGENT_NAME
    || environment.PI_TEAM_NAME
    || environment.PI_TEAM_ROLE
    || environment.PI_LIFECYCLE_RUN_ID
  );
}

export function formatTemperatureStatus(temperatureC: number, theme?: unknown): string {
  const severity = temperatureC > 85 ? "error" : temperatureC > 70 ? "warning" : "success";
  const prefix = temperatureC > 85 ? "!! " : temperatureC > 70 ? "! " : "";
  const text = `${prefix}${temperatureC}°C`;
  return isTemperatureTheme(theme) ? theme.fg(severity, text) : text;
}

export function parseISMCTemperature(text: string): number | null {
  try {
    const document: unknown = JSON.parse(text);
    if (!isRecord(document)) return null;

    const candidates = [
      sensorByKey(document, "TCMb"),
      document["CPU Die Average"],
      sensorByKey(document, "tcal"),
      document["PMU tcal"],
    ];

    for (const candidate of candidates) {
      const temperature = sensorQuantity(candidate);
      if (temperature !== null) return temperature;
    }

    return null;
  } catch {
    return null;
  }
}

export function resolveISMCCommand(fileExists: (path: string) => boolean = existsSync): string {
  return ISMC_PATHS.find(fileExists) ?? "iSMC";
}

export const runCommand: TemperatureCommandRunner = (command, args, timeoutMs = COMMAND_TIMEOUT_MS) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 512 * 1024,
      },
      (error, stdout) => resolve(error ? "" : stdout),
    );
  });

export async function readISMCTemperature(
  run: TemperatureCommandRunner = runCommand,
  resolveCommand: () => string = resolveISMCCommand,
): Promise<number | null> {
  try {
    const output = await run(resolveCommand(), ISMC_ARGS, COMMAND_TIMEOUT_MS);
    return parseISMCTemperature(output);
  } catch {
    return null;
  }
}
