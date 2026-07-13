import assert from "node:assert/strict";
import test from "node:test";
import { SystemMonitorRuntime } from "../monitor-runtime.ts";
import type { SystemStats } from "../system-stats.ts";

const STATS: SystemStats = {
  cpuPercent: "20",
  memPercent: "40",
  diskFreeGB: "100",
  tempC: null,
};

function createScreen() {
  return {
    isActive: false,
    enterCalls: 0,
    leaveCalls: 0,
    enter() {
      this.enterCalls += 1;
      this.isActive = true;
      return true;
    },
    leave() {
      this.leaveCalls += 1;
      const wasActive = this.isActive;
      this.isActive = false;
      return wasActive;
    },
  };
}

function createContext(mode: string) {
  const state = {
    footerCleared: false,
    forceRenders: [] as Array<boolean | undefined>,
    statuses: [] as string[],
  };

  const context = {
    mode,
    getContextUsage: () => ({ tokens: 1234 }),
    ui: {
      theme: {},
      setFooter(factory: unknown) {
        if (factory === undefined) {
          state.footerCleared = true;
          return;
        }

        (factory as Function)(
          { requestRender: (force?: boolean) => state.forceRenders.push(force) },
          {},
          { getExtensionStatuses: () => new Map([["system-monitor", "CPU 20%"]]) },
        );
      },
      setStatus(_key: string, value: string) {
        state.statuses.push(value);
      },
    },
  };

  return { context, state };
}

function createRuntime(screen: ReturnType<typeof createScreen>, clearCalls: unknown[]) {
  return new SystemMonitorRuntime({
    screen,
    getStats: async () => STATS,
    formatStatus: (stats) => `CPU ${stats.cpuPercent}%`,
    truncate: (text) => text,
    setInterval: (() => ({ id: 1 })) as any,
    clearInterval: (interval) => clearCalls.push(interval),
  });
}

test("TUI startup enters alternate screen, forces redraw, publishes status, and cleans up", async () => {
  const screen = createScreen();
  const clearCalls: unknown[] = [];
  const runtime = createRuntime(screen, clearCalls);
  const { context, state } = createContext("tui");

  runtime.start(context);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(screen.enterCalls, 1);
  assert.deepEqual(state.forceRenders, [true]);
  assert.deepEqual(state.statuses, ["CPU 20%"]);

  runtime.stop();
  assert.equal(screen.leaveCalls, 1);
  assert.equal(clearCalls.length, 1);
  assert.equal(state.footerCleared, true);
});

test("non-TUI startup never enters alternate screen", () => {
  const screen = createScreen();
  const runtime = createRuntime(screen, []);
  const { context } = createContext("print");

  runtime.start(context);
  assert.equal(screen.enterCalls, 0);
  runtime.stop();
});

test("a refresh that finishes after shutdown does not update stale UI", async () => {
  const screen = createScreen();
  let resolveStats!: (stats: SystemStats) => void;
  const statsPromise = new Promise<SystemStats>((resolve) => { resolveStats = resolve; });
  const { context, state } = createContext("tui");
  const runtime = new SystemMonitorRuntime({
    screen,
    getStats: () => statsPromise,
    formatStatus: () => "late",
    truncate: (text) => text,
    setInterval: (() => ({ id: 1 })) as any,
    clearInterval: () => {},
  });

  runtime.start(context);
  runtime.stop();
  resolveStats(STATS);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(state.statuses, []);
});
