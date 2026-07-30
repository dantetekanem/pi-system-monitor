import {
  runCommand,
  type TemperatureCommandRunner,
} from "./temperature-monitor.ts";

export interface SystemStats {
  cpuPercent: string;
  memPercent: string;
  diskFreeGB: string;
}

export interface SystemMetrics extends SystemStats {
  tempC: number | null;
}

export type CommandRunner = TemperatureCommandRunner;

interface StatusTheme {
  fg(color: "success" | "warning" | "error", text: string): string;
}

function isStatusTheme(theme: unknown): theme is StatusTheme {
  return typeof theme === "object"
    && theme !== null
    && typeof (theme as { fg?: unknown }).fg === "function";
}

function colorMetric(
  theme: unknown,
  severity: "success" | "warning" | "error",
  text: string,
): string {
  return isStatusTheme(theme) ? theme.fg(severity, text) : text;
}

function parseCpuPercent(topOutput: string): string {
  const match = topOutput.match(/CPU usage:\s+([\d.]+)%\s+user,\s+([\d.]+)%\s+sys/);
  if (!match) return "?";
  return (Number.parseFloat(match[1]!) + Number.parseFloat(match[2]!)).toFixed(0);
}

function parseMemoryPercent(vmOutput: string): string {
  const getPages = (key: string) => {
    const match = vmOutput.match(new RegExp(`${key}:\\s+(\\d+)`));
    return match ? Number.parseInt(match[1]!, 10) : 0;
  };

  const active = getPages("Pages active");
  const wired = getPages("Pages wired down");
  const compressed = getPages("Pages occupied by compressor");
  const free = getPages("Pages free");
  const inactive = getPages("Pages inactive");
  const speculative = getPages("Pages speculative");
  const total = active + wired + compressed + free + inactive + speculative;

  if (total === 0) return "?";
  return (((active + wired + compressed) / total) * 100).toFixed(0);
}

function parseDiskFreeGB(dfOutput: string): string {
  const lines = dfOutput.trim().split("\n");
  if (lines.length < 2) return "?";

  const available = lines[1]!.trim().split(/\s+/)[3];
  const match = available?.match(/([\d.]+)([KMGT]?)i?/);
  if (!match) return "?";

  let value = Number.parseFloat(match[1]!);
  const unit = match[2] ?? "";
  if (unit === "T") value *= 1024;
  else if (unit === "M") value /= 1024;
  else if (unit === "K") value /= 1024 * 1024;
  return value.toFixed(0);
}

function formatDiskFree(diskFreeGB: string): string {
  const gigabytes = Number.parseFloat(diskFreeGB);
  if (!Number.isFinite(gigabytes)) return `${diskFreeGB}GB`;
  return gigabytes >= 1000
    ? `${(gigabytes / 1000).toFixed(2)}TB`
    : `${gigabytes.toFixed(0)}GB`;
}

export async function getSystemStats(run: CommandRunner = runCommand): Promise<SystemStats> {
  const safeRun = async (command: string, args: readonly string[]): Promise<string> => {
    try {
      return await run(command, args, 2000);
    } catch {
      return "";
    }
  };

  const [topOutput, vmOutput, dfOutput] = await Promise.all([
    safeRun("/usr/bin/top", ["-l", "1", "-n", "0"]),
    safeRun("/usr/bin/vm_stat", []),
    safeRun("/bin/df", ["-h", "/System/Volumes/Data"]),
  ]);

  return {
    cpuPercent: parseCpuPercent(topOutput),
    memPercent: parseMemoryPercent(vmOutput),
    diskFreeGB: parseDiskFreeGB(dfOutput),
  };
}

export function formatSystemStatus(metrics: SystemMetrics, theme?: unknown): string {
  const cpu = Number.parseInt(metrics.cpuPercent, 10) || 0;
  const memory = Number.parseInt(metrics.memPercent, 10) || 0;
  const disk = Number.parseInt(metrics.diskFreeGB, 10) || 0;
  const parts = [
    colorMetric(
      theme,
      cpu > 80 ? "error" : cpu > 50 ? "warning" : "success",
      `${cpu > 80 ? "!! " : cpu > 50 ? "! " : ""}CPU ${metrics.cpuPercent}%`,
    ),
    colorMetric(
      theme,
      memory > 85 ? "error" : memory > 70 ? "warning" : "success",
      `${memory > 85 ? "!! " : memory > 70 ? "! " : ""}MEM ${metrics.memPercent}%`,
    ),
    colorMetric(
      theme,
      disk < 20 ? "error" : disk < 50 ? "warning" : "success",
      `${disk < 20 ? "!! " : disk < 50 ? "! " : ""}DSK ${formatDiskFree(metrics.diskFreeGB)}`,
    ),
  ];

  if (metrics.tempC !== null) {
    parts.push(colorMetric(
      theme,
      metrics.tempC > 85 ? "error" : metrics.tempC > 70 ? "warning" : "success",
      `${metrics.tempC > 85 ? "!! " : metrics.tempC > 70 ? "! " : ""}${metrics.tempC}°C`,
    ));
  }

  return parts.join(" │ ");
}
