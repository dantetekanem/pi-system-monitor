import assert from "node:assert/strict";
import test from "node:test";
import {
  ExtensionStatusFooterRuntime,
  SystemMonitorRuntime,
} from "../monitor-runtime.ts";
import type { SystemMetrics } from "../system-stats.ts";

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createContext(mode: string) {
  const state = {
    footerFactories: 0,
    footerClears: 0,
    statuses: [] as Array<{ key: string; value: string | undefined }>,
    renderFooter: null as ((width: number) => string[]) | null,
  };

  const context = {
    mode,
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
              ["system-monitor", "CPU 20% │ MEM 40% │ DSK 1.43TB │ 42°C"],
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

const initialMetrics: SystemMetrics = {
  cpuPercent: "20",
  memPercent: "40",
  diskFreeGB: "1434",
  tempC: 42,
};

function formatStatus(metrics: SystemMetrics): string {
  return `CPU ${metrics.cpuPercent}% │ MEM ${metrics.memPercent}% │ DSK 1.43TB │ ${metrics.tempC}°C`;
}

function createRuntime() {
  const monitorState = {
    now: 0,
    reads: 0,
    metrics: initialMetrics,
  };

  const runtime = new SystemMonitorRuntime({
    readMetrics: async () => {
      monitorState.reads += 1;
      return monitorState.metrics;
    },
    formatStatus,
    truncate: (text, width) => text.slice(0, width),
    now: () => monitorState.now,
  });

  return { runtime, monitorState };
}

test("TUI startup reads once, refreshes only after cooldown, and cleans up idempotently", async () => {
  const { runtime, monitorState } = createRuntime();
  const { context, state } = createContext("tui");

  runtime.start(context);
  assert.deepEqual(state.statuses, [{ key: "system-monitor", value: "" }]);
  await flush();

  assert.equal(state.footerFactories, 1);
  assert.deepEqual(state.renderFooter?.(100), [
    "CPU 20% │ MEM 40% │ DSK 1.43TB │ 42°C │ git:main",
    "",
  ]);
  assert.equal(monitorState.reads, 1);
  assert.deepEqual(state.statuses, [
    { key: "system-monitor", value: "" },
    {
      key: "system-monitor",
      value: "CPU 20% │ MEM 40% │ DSK 1.43TB │ 42°C",
    },
  ]);

  monitorState.now = 29_999;
  runtime.refresh();
  await flush();
  assert.equal(monitorState.reads, 1);

  monitorState.now = 30_000;
  monitorState.metrics = { ...initialMetrics, tempC: 43 };
  runtime.refresh();
  await flush();
  assert.equal(monitorState.reads, 2);
  assert.deepEqual(state.statuses.at(-1), {
    key: "system-monitor",
    value: "CPU 20% │ MEM 40% │ DSK 1.43TB │ 43°C",
  });

  runtime.stop();
  assert.equal(state.footerClears, 1);
  assert.deepEqual(state.statuses.at(-1), { key: "system-monitor", value: undefined });

  runtime.stop();
  assert.equal(state.footerClears, 1);
  assert.equal(state.statuses.length, 4);
});

test("Herdr footer hides local metrics but keeps other extension statuses", () => {
  const runtime = new ExtensionStatusFooterRuntime((text, width) => text.slice(0, width));
  const { context, state } = createContext("tui");

  runtime.start(context);

  assert.deepEqual(state.statuses, [
    { key: "system-monitor", value: undefined },
  ]);
  assert.equal(state.footerFactories, 1);
  assert.deepEqual(state.renderFooter?.(100), ["git:main", ""]);

  runtime.stop();
  assert.equal(state.footerClears, 1);
});

test("non-TUI startup never reads metrics or touches the footer", async () => {
  const { runtime, monitorState } = createRuntime();
  const { context, state } = createContext("print");

  runtime.start(context);
  runtime.refresh();
  await flush();
  runtime.stop();

  assert.equal(monitorState.reads, 0);
  assert.equal(state.footerFactories, 0);
  assert.equal(state.footerClears, 0);
  assert.deepEqual(state.statuses, []);
});

test("restarting ignores metrics from the previous lifecycle", async () => {
  const resolvers: Array<(metrics: SystemMetrics) => void> = [];
  const runtime = new SystemMonitorRuntime({
    readMetrics: () => new Promise((resolve) => resolvers.push(resolve)),
    formatStatus,
    truncate: (text) => text,
    now: () => 0,
  });
  const first = createContext("tui");
  const second = createContext("tui");

  runtime.start(first.context);
  runtime.start(second.context);
  assert.equal(resolvers.length, 2);

  resolvers[0]!(initialMetrics);
  await flush();
  assert.deepEqual(second.state.statuses, [
    { key: "system-monitor", value: "" },
  ]);

  resolvers[1]!(initialMetrics);
  await flush();
  assert.deepEqual(second.state.statuses, [
    { key: "system-monitor", value: "" },
    {
      key: "system-monitor",
      value: "CPU 20% │ MEM 40% │ DSK 1.43TB │ 42°C",
    },
  ]);

  runtime.stop();
});

test("metrics received after shutdown do not update stale UI", async () => {
  let resolveMetrics!: (metrics: SystemMetrics) => void;
  const pending = new Promise<SystemMetrics>((resolve) => {
    resolveMetrics = resolve;
  });
  const { context, state } = createContext("tui");
  const runtime = new SystemMonitorRuntime({
    readMetrics: () => pending,
    formatStatus,
    truncate: (text) => text,
    now: () => 0,
  });

  runtime.start(context);
  runtime.stop();
  resolveMetrics(initialMetrics);
  await flush();

  assert.deepEqual(state.statuses, [
    { key: "system-monitor", value: "" },
    { key: "system-monitor", value: undefined },
  ]);
});
