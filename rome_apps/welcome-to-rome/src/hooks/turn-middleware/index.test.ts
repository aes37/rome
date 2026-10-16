import type {
  AgentMessage,
  AppLogger,
  RomeAppContext,
  TurnMiddlewareContext,
  TurnMiddlewareHookDeps,
} from "@rome-os/app-runtime";
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import type { WelcomeProgress } from "../../db/repositories/progress.js";
import { createHook } from "./index.js";

// The welcome's progress row, held in memory in place of the app database.
const progress: { row: WelcomeProgress } = {
  row: {
    node: "building",
    introRawInput: null,
    introSummary: null,
    ideas: [{ title: "Launch tracker", prompt: "Build me a launch tracker." }],
    ideasGeneratedAt: null,
    aiConnected: true,
    completedAt: null,
  },
};
rs.mock("../../db/repositories/progress.js", () => ({
  createProgressRepository: () => ({
    get: () => progress.row,
    patch: (patch: Partial<WelcomeProgress>) => {
      progress.row = { ...progress.row, ...patch };
      return progress.row;
    },
  }),
}));

const logger: AppLogger = {
  debug: rs.fn(),
  info: rs.fn(),
  warn: rs.fn(),
  error: rs.fn(),
};

function makeContext(
  agentName: string,
  emitted: AgentMessage[],
  prompt = "hello",
): TurnMiddlewareContext {
  return {
    input: { prompt },
    session: { id: "session-1", agentName, channelThreadKey: "webchat:session-1" },
    emit: (event) => emitted.push(event),
    meta: {},
  };
}

describe("welcome-to-rome turn middleware routing", () => {
  afterEach(() => {
    rs.useRealTimers();
    rs.clearAllMocks();
  });

  it("intercepts the app-owned canonical agent id", async () => {
    rs.useFakeTimers();
    const emitted: AgentMessage[] = [];
    const next = rs.fn(async () => {});
    const deps: TurnMiddlewareHookDeps = { appId: "welcome-to-rome", logger };
    const promise = createHook(deps).handle(
      makeContext("welcome-to-rome:welcome-to-rome", emitted),
      next,
    );

    await rs.runAllTimersAsync();
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toMatchObject({ type: "result" });
  });

  it("does not intercept the same local name owned by another app", async () => {
    const emitted: AgentMessage[] = [];
    const next = rs.fn(async () => {});
    const deps: TurnMiddlewareHookDeps = { appId: "welcome-to-rome", logger };

    await createHook(deps).handle(makeContext("other-app:welcome-to-rome", emitted), next);

    expect(next).toHaveBeenCalledOnce();
    expect(emitted).toEqual([]);
  });
});

describe("welcome-to-rome turn middleware after the onboarding build", () => {
  function makeDeps(calls: string[]) {
    const runAction = rs.fn(async () => {
      calls.push("send_message");
      return { status: "ok" };
    });
    const appContext = {
      db: {},
      repositories: { settings: { get: async () => null, set: async () => {} } },
      runAction,
    } as unknown as RomeAppContext;
    const deps: TurnMiddlewareHookDeps = { appId: "welcome-to-rome", logger, appContext };
    return { deps, runAction };
  }

  it("posts the closing message as its own message once the build turn ends", async () => {
    progress.row = { ...progress.row, node: "building", completedAt: null };
    const calls: string[] = [];
    const { deps, runAction } = makeDeps(calls);
    const next = rs.fn(async () => {
      calls.push("model");
    });

    await createHook(deps).handle(makeContext("core:main", [], "Build me a launch tracker."), next);

    expect(calls).toEqual(["model", "send_message"]);
    expect(runAction).toHaveBeenCalledWith("send_message", {
      channel: "webchat",
      threadId: "session-1",
      text: expect.stringContaining("App Store"),
    });
    expect(progress.row.node).toBe("done");
  });

  it("leaves the main agent's other turns alone", async () => {
    progress.row = { ...progress.row, node: "building", completedAt: null };
    const { deps, runAction } = makeDeps([]);
    const next = rs.fn(async () => {});

    await createHook(deps).handle(makeContext("core:main", [], "Add a dark mode."), next);

    expect(next).toHaveBeenCalledOnce();
    expect(runAction).not.toHaveBeenCalled();
    expect(progress.row.node).toBe("building");
  });
});
