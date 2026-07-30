import type { SystemMetrics } from "./system-stats.ts";

const REFRESH_COOLDOWN_MS = 30_000;

interface MonitorContext {
  mode: string;
  ui: {
    theme: unknown;
    setFooter(factory: unknown): void;
    setStatus(key: string, value: string | undefined): void;
  };
}

interface RuntimeDependencies {
  readMetrics: () => Promise<SystemMetrics>;
  formatStatus: (metrics: SystemMetrics, theme?: unknown) => string;
  truncate: (text: string, width: number) => string;
  now: () => number;
}

export class SystemMonitorRuntime {
  private refreshGeneration: number | null = null;
  private lifecycleGeneration = 0;
  private lastRefreshStartedAt = Number.NEGATIVE_INFINITY;
  private currentContext: MonitorContext | null = null;
  private readonly dependencies: RuntimeDependencies;

  constructor(dependencies: RuntimeDependencies) {
    this.dependencies = dependencies;
  }

  start(context: MonitorContext): void {
    this.stop();
    if (context.mode !== "tui") return;

    this.currentContext = context;
    this.lastRefreshStartedAt = Number.NEGATIVE_INFINITY;

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

    this.refresh();
  }

  refresh(): void {
    const context = this.currentContext;
    if (!context) return;

    const generation = this.lifecycleGeneration;
    if (this.refreshGeneration === generation) return;

    const now = this.dependencies.now();
    if (now - this.lastRefreshStartedAt < REFRESH_COOLDOWN_MS) return;

    this.lastRefreshStartedAt = now;
    this.refreshGeneration = generation;
    void this.readAndPublish(context, generation);
  }

  stop(): void {
    this.lifecycleGeneration += 1;
    this.lastRefreshStartedAt = Number.NEGATIVE_INFINITY;

    const context = this.currentContext;
    this.currentContext = null;
    if (!context) return;

    context.ui.setStatus("system-monitor", undefined);
    context.ui.setFooter(undefined);
  }

  private async readAndPublish(context: MonitorContext, generation: number): Promise<void> {
    try {
      const metrics = await this.dependencies.readMetrics();
      if (context === this.currentContext && generation === this.lifecycleGeneration) {
        context.ui.setStatus(
          "system-monitor",
          this.dependencies.formatStatus(metrics, context.ui.theme),
        );
      }
    } catch {
      // Monitoring must never interrupt Pi.
    } finally {
      if (this.refreshGeneration === generation) this.refreshGeneration = null;
    }
  }
}
