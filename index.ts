/** Compact macOS system metrics for Pi's shared footer. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { SystemMonitorRuntime } from "./monitor-runtime.ts";
import { formatSystemStatus, getSystemStats } from "./system-stats.ts";
import {
  readISMCTemperature,
  shouldRunSystemMonitor,
} from "./temperature-monitor.ts";

export default function systemMonitorExtension(pi: ExtensionAPI): void {
  if (!shouldRunSystemMonitor()) return;

  const runtime = new SystemMonitorRuntime({
    readMetrics: async () => {
      const [systemStats, tempC] = await Promise.all([
        getSystemStats(),
        readISMCTemperature(),
      ]);
      return { ...systemStats, tempC };
    },
    formatStatus: formatSystemStatus,
    truncate: truncateToWidth,
    now: Date.now,
  });

  pi.on("session_start", async (_event, context) => {
    runtime.start(context);
  });

  pi.on("agent_settled", async () => {
    runtime.refresh();
  });

  pi.on("session_shutdown", async () => {
    runtime.stop();
  });
}
