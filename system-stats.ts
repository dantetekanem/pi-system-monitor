import { execFile } from "node:child_process";

export interface SystemStats {
  cpuPercent: string;
  memPercent: string;
  diskFreeGB: string;
  tempC: string | null;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs?: number,
) => Promise<string>;

const TEMPERATURE_COMMANDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/opt/homebrew/bin/macmon", ["pipe", "--samples", "1", "--interval", "100"]],
  ["/usr/local/bin/macmon", ["pipe", "--samples", "1", "--interval", "100"]],
  ["macmon", ["pipe", "--samples", "1", "--interval", "100"]],
  ["/opt/homebrew/bin/osx-cpu-temp", []],
  ["/usr/local/bin/osx-cpu-temp", []],
  ["osx-cpu-temp", []],
];

export const runCommand: CommandRunner = (command, args, timeoutMs = 5000) =>
  new Promise((resolve) => {
    execFile(command, [...args], { timeout: timeoutMs }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });

export function parseTemperatureText(text: string): string | null {
  const tempText = text.trim();
  if (!tempText) return null;

  if (tempText.startsWith("{")) {
    try {
      const parsed = JSON.parse(tempText) as { temp?: { cpu_temp_avg?: number; gpu_temp_avg?: number } };
      const temp = parsed.temp?.cpu_temp_avg ?? parsed.temp?.gpu_temp_avg;
      if (Number.isFinite(temp) && temp! > 0) return temp!.toFixed(0);
    } catch {
      return null;
    }
  }

  const match = tempText.match(/([\d.]+)/);
  if (!match) return null;

  const temp = Number.parseFloat(match[1]!);
  return Number.isFinite(temp) && temp > 0 ? temp.toFixed(0) : null;
}

export async function readOptionalTemperature(run: CommandRunner = runCommand): Promise<string | null> {
  for (const [command, args] of TEMPERATURE_COMMANDS) {
    let output = "";
    try {
      output = await run(command, args, 3000);
    } catch {
      // Optional collectors must never make Pi fail.
    }

    const temperature = parseTemperatureText(output);
    if (temperature) return temperature;
  }

  return null;
}

function parseCpuPercent(topOutput: string): string {
  const match = topOutput.match(/CPU usage:\s+([\d.]+)%\s+user,\s+([\d.]+)%\s+sys/);
  if (!match) return "?";
  return (Number.parseFloat(match[1]!) + Number.parseFloat(match[2]!)).toFixed(0);
}

function parseMemoryPercent(vmOutput: string): string {
  const pageSize = 4096;
  const getPage = (key: string) => {
    const match = vmOutput.match(new RegExp(`${key}:\\s+(\\d+)`));
    return match ? Number.parseInt(match[1]!, 10) * pageSize : 0;
  };

  const active = getPage("Pages active");
  const wired = getPage("Pages wired down");
  const compressed = getPage("Pages occupied by compressor");
  const free = getPage("Pages free");
  const inactive = getPage("Pages inactive");
  const speculative = getPage("Pages speculative");
  const total = active + wired + compressed + free + inactive + speculative;

  if (total === 0) return "?";
  return (((active + wired + compressed) / total) * 100).toFixed(0);
}

function parseDiskFreeGB(dfOutput: string): string {
  const lines = dfOutput.trim().split("\n");
  if (lines.length < 2) return "?";

  const columns = lines[1]!.trim().split(/\s+/);
  const available = columns[3];
  if (!available) return "?";

  const match = available.match(/([\d.]+)([KMGT]?)i?/);
  if (!match) return "?";

  let value = Number.parseFloat(match[1]!);
  const unit = match[2] ?? "";
  if (unit === "T") value *= 1024;
  else if (unit === "M") value /= 1024;
  else if (unit === "K") value /= 1024 * 1024;

  return value.toFixed(0);
}

export async function getSystemStats(run: CommandRunner = runCommand): Promise<SystemStats> {
  const [topOutput, vmOutput, dfOutput, tempC] = await Promise.all([
    run("/usr/bin/top", ["-l", "1", "-n", "0"]),
    run("/usr/bin/vm_stat", []),
    run("/bin/df", ["-h", "/System/Volumes/Data"]),
    readOptionalTemperature(run),
  ]);

  return {
    cpuPercent: parseCpuPercent(topOutput),
    memPercent: parseMemoryPercent(vmOutput),
    diskFreeGB: parseDiskFreeGB(dfOutput),
    tempC,
  };
}
