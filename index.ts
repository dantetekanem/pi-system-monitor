/**
 * Compact macOS system monitor for Pi.
 *
 * Shows CPU, memory, free disk space, and optional temperature metrics in a
 * compact footer alongside statuses from other extensions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { SystemMonitorRuntime } from "./monitor-runtime.ts";
import { getSystemStats, type SystemStats } from "./system-stats.ts";

function colorMetric(theme: any, severity: "normal" | "warning" | "error", text: string): string {
  if (!theme?.fg) return text;
  if (severity === "error") return theme.fg("error", text);
  if (severity === "warning") return theme.fg("warning", text);
  return theme.fg("success", text);
}

function formatDiskFree(diskFreeGB: string): string {
  const gb = Number.parseFloat(diskFreeGB);
  if (!Number.isFinite(gb)) return `${diskFreeGB}GB`;
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)}TB`;
  return `${gb.toFixed(0)}GB`;
}

export function buildStatusText(stats: SystemStats, contextTokens?: number, theme?: any): string {
  const parts: string[] = [];

  const cpu = Number.parseInt(stats.cpuPercent, 10) || 0;
  const cpuIcon = cpu > 80 ? "!! " : cpu > 50 ? "! " : "";
  parts.push(colorMetric(theme, cpu > 80 ? "error" : cpu > 50 ? "warning" : "normal", `${cpuIcon}CPU ${stats.cpuPercent}%`));

  const memory = Number.parseInt(stats.memPercent, 10) || 0;
  const memoryIcon = memory > 85 ? "!! " : memory > 70 ? "! " : "";
  parts.push(colorMetric(theme, memory > 85 ? "error" : memory > 70 ? "warning" : "normal", `${memoryIcon}MEM ${stats.memPercent}%`));

  const diskFree = Number.parseInt(stats.diskFreeGB, 10) || 0;
  const diskIcon = diskFree < 20 ? "!! " : diskFree < 50 ? "! " : "";
  parts.push(colorMetric(theme, diskFree < 20 ? "error" : diskFree < 50 ? "warning" : "normal", `${diskIcon}DSK ${formatDiskFree(stats.diskFreeGB)}`));

  if (stats.tempC) {
    const temperature = Number.parseInt(stats.tempC, 10) || 0;
    const temperatureIcon = temperature > 85 ? "!! " : temperature > 70 ? "! " : "";
    parts.push(colorMetric(theme, temperature > 85 ? "error" : temperature > 70 ? "warning" : "normal", `${temperatureIcon}${stats.tempC}°C`));
  }

  if (contextTokens !== undefined && contextTokens > 200_000) {
    parts.push(colorMetric(theme, contextTokens > 300_000 ? "error" : "warning", contextTokens > 300_000 ? "!! CONTEXT" : "! CONTEXT"));
  }

  return parts.join(" │ ");
}

export default function systemMonitorExtension(pi: ExtensionAPI): void {
  const runtime = new SystemMonitorRuntime({
    getStats: getSystemStats,
    formatStatus: buildStatusText,
    truncate: truncateToWidth,
    setInterval,
    clearInterval,
  });

  pi.on("session_start", async (_event, context) => {
    runtime.start(context);
  });

  pi.on("session_shutdown", async () => {
    runtime.stop();
  });
}
