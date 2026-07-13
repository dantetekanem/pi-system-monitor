import type { SystemStats } from "./system-stats.ts";

interface ScreenController {
  readonly isActive: boolean;
  enter(): boolean;
  leave(): boolean;
}

interface MonitorContext {
  mode: string;
  getContextUsage?: () => { tokens: number } | undefined;
  ui: {
    theme: unknown;
    setFooter(factory: unknown): void;
    setStatus(key: string, value: string): void;
  };
}

interface RuntimeDependencies {
  screen: ScreenController;
  getStats: () => Promise<SystemStats>;
  formatStatus: (stats: SystemStats, contextTokens?: number, theme?: unknown) => string;
  truncate: (text: string, width: number) => string;
  setInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval: (interval: ReturnType<typeof setInterval>) => void;
}

export class SystemMonitorRuntime {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private refreshInProgress = false;
  private currentContext: MonitorContext | null = null;
  private readonly dependencies: RuntimeDependencies;

  constructor(dependencies: RuntimeDependencies) {
    this.dependencies = dependencies;
  }

  start(context: MonitorContext): void {
    this.currentContext = context;
    context.ui.setFooter((tui: { requestRender(force?: boolean): void }, _theme: unknown, footerData: {
      getExtensionStatuses(): ReadonlyMap<string, string>;
    }) => {
      if (context.mode === "tui" && this.dependencies.screen.enter()) {
        queueMicrotask(() => {
          if (this.dependencies.screen.isActive) tui.requestRender(true);
        });
      }

      return {
        invalidate() {},
        render: (width: number): string[] => {
          const statuses = [...footerData.getExtensionStatuses().values()].filter(Boolean);
          if (statuses.length === 0) return [];
          return [this.dependencies.truncate(statuses.join(" │ "), width), ""];
        },
      };
    });

    void this.refreshStats();

    if (this.intervalId) this.dependencies.clearInterval(this.intervalId);
    this.intervalId = this.dependencies.setInterval(() => void this.refreshStats(), 5000);
  }

  stop(): void {
    if (this.intervalId) {
      this.dependencies.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.currentContext?.ui.setFooter(undefined);
    this.dependencies.screen.leave();
    this.currentContext = null;
  }

  private async refreshStats(): Promise<void> {
    if (this.refreshInProgress) return;
    this.refreshInProgress = true;

    try {
      const stats = await this.dependencies.getStats();
      const context = this.currentContext;
      if (!context) return;

      const tokens = context.getContextUsage?.()?.tokens;
      context.ui.setStatus("system-monitor", this.dependencies.formatStatus(stats, tokens, context.ui.theme));
    } catch {
      // Monitoring must never interrupt Pi.
    } finally {
      this.refreshInProgress = false;
    }
  }
}
