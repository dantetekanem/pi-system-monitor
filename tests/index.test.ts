import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-tui") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export const truncateToWidth = (value) => value",
      };
    }
    return nextResolve(specifier, context);
  },
});

const { default: systemMonitorExtension } = await import("../index.ts");

test("registers only the extension-status footer lifecycle inside Herdr", (t) => {
  const originalHerdrEnv = process.env.HERDR_ENV;
  process.env.HERDR_ENV = "1";
  t.after(() => {
    if (originalHerdrEnv === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = originalHerdrEnv;
  });

  const registeredEvents: string[] = [];
  systemMonitorExtension({
    on(event: string) {
      registeredEvents.push(event);
    },
  } as never);

  assert.deepEqual(registeredEvents, ["session_start", "session_shutdown"]);
});
