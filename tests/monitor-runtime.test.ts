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

function createContext(mode: string) {
  const state = {
    footerFactories: 0,
    footerClears: 0,
    statuses: [] as Array<{ key: string; value: string | undefined }>,
    renderFooter: null as ((width: number) => string[]) | null,
  };

  const context = {
    mode,
    getContextUsage: () => ({ tokens: 1234 }),
    ui: {
      theme: {},
      setFooter(factory: unknown) {
        if (factory === undefined) {
          state.footerClears += 1;
          state.renderFooter = null;
          return;
        }

        state.footerFactories += 1;
        const component = (factory as Function)(
          {},
          {},
          {
            getExtensionStatuses: () => new Map([
              ["system-monitor", "CPU 20%"],
              ["other-extension", "git:main"],
            ]),
          },
        );
        state.renderFooter = component.render;
      },
      setStatus(key: string, value: string | undefined) {
        state.statuses.push({ key, value });
      },
    },
  };

  return { context, state };
}

function createRuntime() {
  const timerState = {
    intervals: [] as number[],
    cleared: [] as unknown[],
  };

  const runtime = new SystemMonitorRuntime({
    getStats: async () => STATS,
    formatStatus: (stats) => `CPU ${stats.cpuPercent}%`,
    truncate: (text, width) => text.slice(0, width),
    setInterval: ((_: () => void, milliseconds: number) => {
      timerState.intervals.push(milliseconds);
      return { id: timerState.intervals.length };
    }) as any,
    clearInterval: (interval) => timerState.cleared.push(interval),
  });

  return { runtime, timerState };
}

test("TUI startup installs one aggregating footer, refreshes every five seconds, and cleans up idempotently", async () => {
  const { runtime, timerState } = createRuntime();
  const { context, state } = createContext("tui");

  runtime.start(context);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(state.footerFactories, 1);
  assert.deepEqual(state.renderFooter?.(80), ["CPU 20% │ git:main", ""]);
  assert.deepEqual(state.statuses, [{ key: "system-monitor", value: "CPU 20%" }]);
  assert.deepEqual(timerState.intervals, [5000]);

  runtime.stop();
  assert.equal(timerState.cleared.length, 1);
  assert.equal(state.footerClears, 1);
  assert.deepEqual(state.statuses.at(-1), { key: "system-monitor", value: undefined });

  runtime.stop();
  assert.equal(timerState.cleared.length, 1);
  assert.equal(state.footerClears, 1);
  assert.equal(state.statuses.length, 2);
});

test("non-TUI startup publishes metrics without installing or clearing a custom footer", async () => {
  const { runtime } = createRuntime();
  const { context, state } = createContext("print");

  runtime.start(context);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(state.footerFactories, 0);
  assert.deepEqual(state.statuses, [{ key: "system-monitor", value: "CPU 20%" }]);

  runtime.stop();
  assert.equal(state.footerClears, 0);
  assert.deepEqual(state.statuses.at(-1), { key: "system-monitor", value: undefined });
});

test("restarting transfers singleton footer ownership and clears the prior lifecycle", async () => {
  const { runtime, timerState } = createRuntime();
  const first = createContext("tui");
  const second = createContext("tui");

  runtime.start(first.context);
  runtime.start(second.context);

  assert.equal(first.state.footerFactories, 1);
  assert.equal(first.state.footerClears, 1);
  assert.deepEqual(first.state.statuses.at(-1), { key: "system-monitor", value: undefined });
  assert.equal(second.state.footerFactories, 1);
  assert.equal(timerState.cleared.length, 1);
  assert.deepEqual(timerState.intervals, [5000, 5000]);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(second.state.statuses, [{ key: "system-monitor", value: "CPU 20%" }]);

  runtime.stop();
});

test("a refresh that finishes after shutdown does not update stale UI", async () => {
  let resolveStats!: (stats: SystemStats) => void;
  const statsPromise = new Promise<SystemStats>((resolve) => { resolveStats = resolve; });
  const { context, state } = createContext("tui");
  const runtime = new SystemMonitorRuntime({
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

  assert.deepEqual(state.statuses, [{ key: "system-monitor", value: undefined }]);
});
