import { cpus } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
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

export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export type CpuTimesReader = () => ReadonlyArray<{ readonly times: CpuTimes }>;
export type CpuSampleDelay = (milliseconds: number) => Promise<unknown>;
export type CpuPercentReader = () => Promise<string>;

const CPU_SAMPLE_WINDOW_MS = 200;

interface CpuSnapshot {
  busy: number;
  total: number;
  cores: number;
}

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

function cpuSnapshot(readCpuTimes: CpuTimesReader): CpuSnapshot | null {
  let samples: ReturnType<CpuTimesReader>;
  try {
    samples = readCpuTimes();
  } catch {
    return null;
  }
  if (samples.length === 0) return null;

  let busy = 0;
  let total = 0;
  for (const sample of samples) {
    const times = sample?.times;
    if (!times) return null;

    const values = [times.user, times.nice, times.sys, times.idle, times.irq];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;

    const sampleBusy = times.user + times.nice + times.sys + times.irq;
    busy += sampleBusy;
    total += sampleBusy + times.idle;
  }

  return total > 0 ? { busy, total, cores: samples.length } : null;
}

export async function readCpuPercent(
  readCpuTimes: CpuTimesReader = cpus,
  delay: CpuSampleDelay = sleep,
  windowMs = CPU_SAMPLE_WINDOW_MS,
): Promise<string> {
  const first = cpuSnapshot(readCpuTimes);
  if (!first) return "?";

  try {
    await delay(windowMs);
  } catch {
    return "?";
  }

  const second = cpuSnapshot(readCpuTimes);
  if (!second || first.cores !== second.cores) return "?";

  const busyDelta = second.busy - first.busy;
  const totalDelta = second.total - first.total;
  if (busyDelta < 0 || totalDelta <= 0 || busyDelta > totalDelta) return "?";

  return ((busyDelta / totalDelta) * 100).toFixed(0);
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

export async function getSystemStats(
  run: CommandRunner = runCommand,
  readCpu: CpuPercentReader = readCpuPercent,
): Promise<SystemStats> {
  const safeRun = async (command: string, args: readonly string[]): Promise<string> => {
    try {
      return await run(command, args, 2000);
    } catch {
      return "";
    }
  };

  const [cpuPercent, vmOutput, dfOutput] = await Promise.all([
    readCpu(),
    safeRun("/usr/bin/vm_stat", []),
    safeRun("/bin/df", ["-h", "/System/Volumes/Data"]),
  ]);

  return {
    cpuPercent,
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
