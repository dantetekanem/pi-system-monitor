import { formatSystemStatus, getSystemMetrics } from "./system-stats.ts";

try {
  process.stdout.write(`${formatSystemStatus(await getSystemMetrics())}\n`);
} catch {
  process.exitCode = 1;
}
