import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTemperatureStatus,
  parseISMCTemperature,
  readISMCTemperature,
  runCommand,
  shouldRunSystemMonitor,
  type TemperatureCommandRunner,
} from "../temperature-monitor.ts";

const ISMC_OUTPUT = JSON.stringify({
  "CPU Die Average": {
    key: "TCMb",
    type: "flt",
    value: "47.978127 °C",
    quantity: 47.978127,
    unit: "°C",
  },
  "PMU tcal": {
    key: "tcal",
    type: "hid",
    value: "51.820007 °C",
    quantity: 51.820007,
    unit: "°C",
  },
});

test("selects the CPU die average from iSMC JSON", () => {
  assert.equal(parseISMCTemperature(ISMC_OUTPUT), 48);
  assert.equal(parseISMCTemperature(JSON.stringify({
    "PMU tcal": { key: "tcal", quantity: 51.8, unit: "°C" },
  })), 52);
  assert.equal(parseISMCTemperature(JSON.stringify({
    "CPU Die Average": { key: "TCMb", quantity: 0, unit: "°C" },
  })), null);
  assert.equal(parseISMCTemperature("not JSON"), null);
});

test("runs one bounded iSMC temperature command", async () => {
  const calls: Array<{ command: string; args: readonly string[]; timeoutMs?: number }> = [];
  const runner: TemperatureCommandRunner = async (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs });
    return ISMC_OUTPUT;
  };

  assert.equal(
    await readISMCTemperature(runner, () => "/opt/homebrew/bin/iSMC"),
    48,
  );
  assert.deepEqual(calls, [{
    command: "/opt/homebrew/bin/iSMC",
    args: ["-o", "json", "temp"],
    timeoutMs: 2000,
  }]);
});

test("hard-kills a temperature command that exceeds its timeout", async () => {
  const startedAt = Date.now();
  const output = await runCommand(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    100,
  );

  assert.equal(output, "");
  assert.ok(Date.now() - startedAt < 3000);
});

test("does not run inside spawned Pi agent processes or Herdr", () => {
  assert.equal(shouldRunSystemMonitor({}), true);
  assert.equal(shouldRunSystemMonitor({ PI_AGENT_NAME: "writer" }), false);
  assert.equal(shouldRunSystemMonitor({ PI_TEAM_NAME: "team" }), false);
  assert.equal(shouldRunSystemMonitor({ PI_TEAM_ROLE: "reviewer" }), false);
  assert.equal(shouldRunSystemMonitor({ PI_LIFECYCLE_RUN_ID: "run-1" }), false);
  assert.equal(shouldRunSystemMonitor({ HERDR_ENV: "1" }), false);
});

test("temperature status keeps the existing severity colors", () => {
  const colors: string[] = [];
  const theme = {
    fg(color: string, text: string) {
      colors.push(color);
      return `<${color}>${text}</${color}>`;
    },
  };

  assert.equal(formatTemperatureStatus(42, theme), "<success>42°C</success>");
  assert.equal(formatTemperatureStatus(75, theme), "<warning>! 75°C</warning>");
  assert.equal(formatTemperatureStatus(90, theme), "<error>!! 90°C</error>");
  assert.deepEqual(colors, ["success", "warning", "error"]);
});
