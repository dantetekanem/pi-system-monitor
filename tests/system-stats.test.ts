import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSystemStatus,
  getSystemStats,
  type CommandRunner,
} from "../system-stats.ts";

test("collects CPU, memory, and disk stats without a temperature subprocess", async () => {
  const calls: Array<{ command: string; args: readonly string[]; timeoutMs?: number }> = [];
  const runner: CommandRunner = async (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs });
    if (command === "/usr/bin/top") return "CPU usage: 12.5% user, 7.5% sys, 80.0% idle";
    if (command === "/usr/bin/vm_stat") {
      return [
        "Pages active: 25.",
        "Pages wired down: 10.",
        "Pages occupied by compressor: 5.",
        "Pages free: 20.",
        "Pages inactive: 35.",
        "Pages speculative: 5.",
      ].join("\n");
    }
    if (command === "/bin/df") {
      return "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk 1.8Ti 400Gi 1.4Ti 23% /System/Volumes/Data";
    }
    return "";
  };

  assert.deepEqual(await getSystemStats(runner), {
    cpuPercent: "20",
    memPercent: "40",
    diskFreeGB: "1434",
  });
  assert.deepEqual(calls, [
    { command: "/usr/bin/top", args: ["-l", "1", "-n", "0"], timeoutMs: 2000 },
    { command: "/usr/bin/vm_stat", args: [], timeoutMs: 2000 },
    { command: "/bin/df", args: ["-h", "/System/Volumes/Data"], timeoutMs: 2000 },
  ]);
});

test("formats CPU, memory, disk, and temperature together", () => {
  const theme = {
    fg(color: string, text: string) {
      return `<${color}>${text}</${color}>`;
    },
  };

  assert.equal(
    formatSystemStatus({
      cpuPercent: "20",
      memPercent: "40",
      diskFreeGB: "1434",
      tempC: 42,
    }, theme),
    [
      "<success>CPU 20%</success>",
      "<success>MEM 40%</success>",
      "<success>DSK 1.43TB</success>",
      "<success>42°C</success>",
    ].join(" │ "),
  );
});
