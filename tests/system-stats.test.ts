import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSystemStatus,
  getSystemStats,
  readCpuPercent,
  type CommandRunner,
  type CpuTimesReader,
} from "../system-stats.ts";

test("collects CPU, memory, and disk stats without a temperature subprocess", async () => {
  const calls: Array<{ command: string; args: readonly string[]; timeoutMs?: number }> = [];
  const runner: CommandRunner = async (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs });
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

  assert.deepEqual(await getSystemStats(runner, async () => "20"), {
    cpuPercent: "20",
    memPercent: "40",
    diskFreeGB: "1434",
  });
  assert.deepEqual(calls, [
    { command: "/usr/bin/vm_stat", args: [], timeoutMs: 2000 },
    { command: "/bin/df", args: ["-h", "/System/Volumes/Data"], timeoutMs: 2000 },
  ]);
});

test("derives CPU percent from a bounded two-sample window", async () => {
  const snapshots = [
    [
      { times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 } },
      { times: { user: 50, nice: 0, sys: 50, idle: 900, irq: 0 } },
    ],
    [
      { times: { user: 400, nice: 0, sys: 300, idle: 1300, irq: 0 } },
      { times: { user: 100, nice: 0, sys: 100, idle: 1800, irq: 0 } },
    ],
  ];
  const read: CpuTimesReader = () => snapshots.shift()!;
  let waitedMs = 0;

  assert.equal(await readCpuPercent(read, async (milliseconds) => {
    waitedMs = milliseconds;
  }), "30");
  assert.equal(waitedMs, 200);
});

test("degrades safely when CPU samples are unavailable or invalid", async () => {
  const noDelay = async () => {};

  assert.equal(await readCpuPercent(() => [], noDelay), "?");
  assert.equal(await readCpuPercent(
    () => [{ times: { user: Number.NaN, nice: 0, sys: 0, idle: 100, irq: 0 } }],
    noDelay,
  ), "?");

  const coreCountChange = [
    [{ times: { user: 20, nice: 0, sys: 0, idle: 80, irq: 0 } }],
    [
      { times: { user: 40, nice: 0, sys: 0, idle: 160, irq: 0 } },
      { times: { user: 10, nice: 0, sys: 0, idle: 40, irq: 0 } },
    ],
  ];
  assert.equal(await readCpuPercent(() => coreCountChange.shift()!, noDelay), "?");
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
