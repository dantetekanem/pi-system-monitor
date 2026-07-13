import assert from "node:assert/strict";
import test from "node:test";
import {
  getSystemStats,
  parseTemperatureText,
  readOptionalTemperature,
  type CommandRunner,
} from "../system-stats.ts";

test("parses macmon JSON and osx-cpu-temp text", () => {
  assert.equal(parseTemperatureText('{"temp":{"cpu_temp_avg":54.6}}'), "55");
  assert.equal(parseTemperatureText("61.2°C"), "61");
  assert.equal(parseTemperatureText("not a temperature"), null);
});

test("missing temperature commands are optional and non-fatal", async () => {
  const missingRunner: CommandRunner = async () => {
    throw new Error("ENOENT");
  };

  assert.equal(await readOptionalTemperature(missingRunner), null);
});

test("falls back to another optional temperature collector", async () => {
  const runner: CommandRunner = async (command) =>
    command.includes("osx-cpu-temp") ? "48.7°C" : "";

  assert.equal(await readOptionalTemperature(runner), "49");
});

test("collects and parses macOS stats with no temperature collector", async () => {
  const runner: CommandRunner = async (command) => {
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
    tempC: null,
  });
});
