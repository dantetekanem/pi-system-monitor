import assert from "node:assert/strict";
import test from "node:test";
import { AlternateScreenController } from "../alternate-screen.ts";

class FakeOutput {
  isTTY = true;
  writes: string[] = [];
  shouldThrow = false;

  write(data: string): void {
    if (this.shouldThrow) throw new Error("terminal unavailable");
    this.writes.push(data);
  }
}

class FakeLifecycle {
  exitListener: (() => void) | null = null;

  once(_event: "exit", listener: () => void): void {
    this.exitListener = listener;
  }

  off(_event: "exit", listener: () => void): void {
    if (this.exitListener === listener) this.exitListener = null;
  }
}

test("enters and leaves the alternate screen exactly once", () => {
  const output = new FakeOutput();
  const lifecycle = new FakeLifecycle();
  const screen = new AlternateScreenController(output, lifecycle, {});

  assert.equal(screen.enter(), true);
  assert.equal(screen.enter(), false);
  assert.equal(screen.isActive, true);
  assert.equal(output.writes.length, 1);
  assert.match(output.writes[0]!, /\x1b\[\?1049h/);
  assert.ok(lifecycle.exitListener);

  assert.equal(screen.leave(), true);
  assert.equal(screen.leave(), false);
  assert.equal(screen.isActive, false);
  assert.equal(output.writes.length, 2);
  assert.match(output.writes[1]!, /\x1b\[\?1049l/);
  assert.equal(lifecycle.exitListener, null);
});

test("keeps tmux on its normal buffer while clearing the screen", () => {
  const output = new FakeOutput();
  const lifecycle = new FakeLifecycle();
  const screen = new AlternateScreenController(output, lifecycle, { TMUX: "/private/tmp/tmux/default" });

  assert.equal(screen.enter(), true);
  assert.doesNotMatch(output.writes[0]!, /\x1b\[\?1049h/);
  assert.match(output.writes[0]!, /\x1b\[2J\x1b\[H/);

  assert.equal(screen.leave(), true);
  assert.doesNotMatch(output.writes[1]!, /\x1b\[\?1049l/);
  assert.match(output.writes[1]!, /\x1b\[\?25h/);
});

test("does nothing when stdout is not a TTY", () => {
  const output = new FakeOutput();
  output.isTTY = false;
  const lifecycle = new FakeLifecycle();
  const screen = new AlternateScreenController(output, lifecycle, {});

  assert.equal(screen.enter(), false);
  assert.equal(output.writes.length, 0);
  assert.equal(lifecycle.exitListener, null);
});

test("restores the normal screen during process exit", () => {
  const output = new FakeOutput();
  const lifecycle = new FakeLifecycle();
  const screen = new AlternateScreenController(output, lifecycle, {});

  screen.enter();
  lifecycle.exitListener?.();

  assert.equal(screen.isActive, false);
  assert.equal(output.writes.length, 2);
  assert.match(output.writes[1]!, /\x1b\[\?1049l/);
});

test("failed terminal writes do not claim screen ownership", () => {
  const output = new FakeOutput();
  output.shouldThrow = true;
  const lifecycle = new FakeLifecycle();
  const screen = new AlternateScreenController(output, lifecycle, {});

  assert.equal(screen.enter(), false);
  assert.equal(screen.isActive, false);
  assert.equal(lifecycle.exitListener, null);
});
