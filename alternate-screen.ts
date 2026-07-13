const ENTER_ALTERNATE_SCREEN = "\x1b[?2026h\x1b[?1049h\x1b[2J\x1b[H\x1b[?2026l";
const LEAVE_ALTERNATE_SCREEN = "\x1b[?2026h\x1b[?25h\x1b[?1049l\x1b[?2026l";

interface TerminalOutput {
  readonly isTTY?: boolean;
  write(data: string): unknown;
}

interface ProcessLifecycle {
  once(event: "exit", listener: () => void): unknown;
  off(event: "exit", listener: () => void): unknown;
}

/**
 * Owns Pi's alternate-screen mode for the system-monitor extension.
 *
 * This intentionally manages only the screen buffer. It does not change mouse,
 * keyboard, scroll-region, raw-mode, or TUI rendering behavior.
 */
export class AlternateScreenController {
  private active = false;
  private readonly output: TerminalOutput;
  private readonly lifecycle: ProcessLifecycle;
  private readonly restoreOnExit = () => this.restoreBestEffort();

  constructor(output: TerminalOutput = process.stdout, lifecycle: ProcessLifecycle = process) {
    this.output = output;
    this.lifecycle = lifecycle;
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): boolean {
    if (this.active || !this.output.isTTY) return false;

    try {
      this.output.write(ENTER_ALTERNATE_SCREEN);
    } catch {
      return false;
    }

    this.active = true;
    this.lifecycle.once("exit", this.restoreOnExit);
    return true;
  }

  leave(): boolean {
    if (!this.active) return false;

    this.lifecycle.off("exit", this.restoreOnExit);
    this.active = false;
    try {
      this.output.write(LEAVE_ALTERNATE_SCREEN);
    } catch {
      // The terminal may already be unavailable during shutdown.
    }
    return true;
  }

  private restoreBestEffort(): void {
    if (!this.active) return;

    this.active = false;
    try {
      this.output.write(LEAVE_ALTERNATE_SCREEN);
    } catch {
      // Process-exit cleanup must never prevent shutdown.
    }
  }
}
