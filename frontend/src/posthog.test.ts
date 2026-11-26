import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: fake }));

async function flush(): Promise<void> {
  // The module resolves its dynamic import and promise chain over a few
  // microtasks; two macrotask turns settle it deterministically.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("posthog client wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes against the first-party ingest path", async () => {
    const mod = await import("./posthog");
    mod.initPostHog();
    await flush();
    expect(fake.init).toHaveBeenCalledTimes(1);
    const [key, config] = fake.init.mock.calls[0];
    expect(key).toBe("phc_test_key");
    expect(config.api_host).toBe("/ingest");
    expect(config.ui_host).toBe("https://us.posthog.com");
    expect(config.opt_out_capturing_by_default).toBe(true);
    expect(config.person_profiles).toBe("identified_only");
  });

  it("opts in before identifying and sends one session heartbeat", async () => {
    const mod = await import("./posthog");
    mod.identifyPostHogUser("739931634849218560", "ninocharuti");
    await flush();
    expect(fake.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(fake.identify).toHaveBeenCalledWith("739931634849218560", {
      sleeper_username: "ninocharuti",
    });
    expect(fake.opt_in_capturing.mock.invocationCallOrder[0]).toBeLessThan(
      fake.identify.mock.invocationCallOrder[0],
    );
    expect(fake.capture).toHaveBeenCalledTimes(1);
    expect(fake.capture).toHaveBeenCalledWith("app_session_started");
    // AuthGate identifies twice per session (Supabase ID, then Sleeper ID);
    // the heartbeat must still fire only once per page load.
    mod.identifyPostHogUser("739931634849218560", "ninocharuti");
    await flush();
    expect(fake.capture).toHaveBeenCalledTimes(1);
  });

  it("reset opts back out after resetting", async () => {
    const mod = await import("./posthog");
    mod.resetPostHog();
    await flush();
    expect(fake.reset).toHaveBeenCalledTimes(1);
    expect(fake.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(fake.reset.mock.invocationCallOrder[0]).toBeLessThan(
      fake.opt_out_capturing.mock.invocationCallOrder[0],
    );
  });

  it("stays a no-op without a key", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const mod = await import("./posthog");
    mod.initPostHog();
    mod.identifyPostHogUser("123");
    await flush();
    expect(fake.init).not.toHaveBeenCalled();
    expect(fake.identify).not.toHaveBeenCalled();
  });
});
