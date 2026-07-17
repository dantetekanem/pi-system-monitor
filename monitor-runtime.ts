import type { SystemStats } from "./system-stats.ts";

interface MonitorContext {
  mode: string;
  getContextUsage?: () => { tokens: number } | undefined;
  ui: {
    theme: unknown;
    setFooter(factory: unknown): void;
    setStatus(key: string, value: string | undefined): void;
  };
}

interface RuntimeDependencies {
  getStats: () => Promise<SystemStats>;
  formatStatus: (stats: SystemStats, contextTokens?: number, theme?: unknown) => string;
  truncate: (text: string, width: number) => string;
  setInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval: (interval: ReturnType<typeof setInterval>) => void;
}

export class SystemMonitorRuntime {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private refreshGeneration: number | null = null;
  private lifecycleGeneration = 0;
  private currentContext: MonitorContext | null = null;
  private readonly dependencies: RuntimeDependencies;

  constructor(dependencies: RuntimeDependencies) {
    this.dependencies = dependencies;
  }

  start(context: MonitorContext): void {
    this.stop();
    this.currentContext = context;
    const generation = this.lifecycleGeneration;

    if (context.mode === "tui") {
      context.ui.setFooter((_tui: unknown, _theme: unknown, footerData: {
        getExtensionStatuses(): ReadonlyMap<string, string>;
      }) => ({
        invalidate() {},
        render: (width: number): string[] => {
          const statuses = [...footerData.getExtensionStatuses().values()].filter(Boolean);
          if (statuses.length === 0) return [];
          return [this.dependencies.truncate(statuses.join(" │ "), width), ""];
        },
      }));
    }

    void this.refreshStats(generation);
    this.intervalId = this.dependencies.setInterval(() => void this.refreshStats(generation), 5000);
  }

  stop(): void {
    this.lifecycleGeneration += 1;

    if (this.intervalId) {
      this.dependencies.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const context = this.currentContext;
    this.currentContext = null;
    if (!context) return;

    context.ui.setStatus("system-monitor", undefined);
    if (context.mode === "tui") context.ui.setFooter(undefined);
  }

  private async refreshStats(generation: number): Promise<void> {
    if (this.refreshGeneration === generation) return;
    this.refreshGeneration = generation;

    try {
      const stats = await this.dependencies.getStats();
      const context = this.currentContext;
      if (!context || generation !== this.lifecycleGeneration) return;

      const tokens = context.getContextUsage?.()?.tokens;
      context.ui.setStatus("system-monitor", this.dependencies.formatStatus(stats, tokens, context.ui.theme));
    } catch {
      // Monitoring must never interrupt Pi.
    } finally {
      if (this.refreshGeneration === generation) this.refreshGeneration = null;
    }
  }
}
