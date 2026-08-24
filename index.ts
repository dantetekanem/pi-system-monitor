/** Compact macOS system metrics for Pi's shared footer. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  ExtensionStatusFooterRuntime,
  SystemMonitorRuntime,
} from "./monitor-runtime.ts";
import { formatSystemStatus, getSystemMetrics } from "./system-stats.ts";
import {
  isHerdrEnvironment,
  isSpawnedSystemMonitorProcess,
  shouldRunSystemMonitor,
} from "./temperature-monitor.ts";

export default function systemMonitorExtension(pi: ExtensionAPI): void {
  if (isSpawnedSystemMonitorProcess()) return;

  if (isHerdrEnvironment()) {
    const runtime = new ExtensionStatusFooterRuntime(truncateToWidth);

    pi.on("session_start", async (_event, context) => {
      runtime.start(context);
    });

    pi.on("session_shutdown", async () => {
      runtime.stop();
    });
    return;
  }

  if (!shouldRunSystemMonitor()) return;

  const runtime = new SystemMonitorRuntime({
    readMetrics: getSystemMetrics,
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
