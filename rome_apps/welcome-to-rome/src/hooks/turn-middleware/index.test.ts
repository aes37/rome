import type {
  AgentMessage,
  AppLogger,
  RomeAppContext,
  TurnMiddlewareContext,
  TurnMiddlewareHookDeps,
  TurnOutcome,
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
    buildSessionId: null,
    completedAt: null,
  },
};
const repositoryOpened = rs.fn();
rs.mock("../../db/repositories/progress.js", () => ({
  createProgressRepository: () => ({
    opened: repositoryOpened(),
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
  const finished: TurnOutcome = { status: "completed", suspended: false };
  const IDEA = "Build me a launch tracker.";

  afterEach(() => {
    rs.clearAllMocks();
  });

  function startBuilding() {
    progress.row = { ...progress.row, node: "building", buildSessionId: null, completedAt: null };
  }

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

  it("posts the closing message as its own message once the build finishes", async () => {
    startBuilding();
    const calls: string[] = [];
    const { deps, runAction } = makeDeps(calls);
    const next = rs.fn(async () => {
      calls.push("model");
      return finished;
    });

    await createHook(deps).handle(makeContext("core:main", [], IDEA), next);

    expect(calls).toEqual(["model", "send_message"]);
    expect(runAction).toHaveBeenCalledWith("send_message", {
      channel: "webchat",
      threadId: "session-1",
      text: expect.stringContaining("App Store"),
    });
    expect(progress.row.node).toBe("done");
  });

  it("waits through a parked build turn and posts after a later turn finishes", async () => {
    startBuilding();
    const { deps, runAction } = makeDeps([]);
    const hook = createHook(deps);

    // The agent asks a question card, then the guardian answers in the same chat.
    await hook.handle(
      makeContext("core:main", [], IDEA),
      rs.fn(async () => ({ status: "completed", suspended: true }) as TurnOutcome),
    );
    expect(runAction).not.toHaveBeenCalled();
    expect(progress.row.node).toBe("building");

    await hook.handle(
      makeContext("core:main", [], "Use a kanban board."),
      rs.fn(async () => finished),
    );
    expect(runAction).toHaveBeenCalledOnce();
    expect(progress.row.node).toBe("done");
  });

  it("posts nothing when the guardian closes the handoff while the build runs", async () => {
    startBuilding();
    const { deps, runAction } = makeDeps([]);
    const next = rs.fn(async () => {
      // The welcome's `building` step closed onboarding with its own message.
      progress.row = { ...progress.row, node: "done", completedAt: "2026-10-15T00:00:00Z" };
      return finished;
    });

    await createHook(deps).handle(makeContext("core:main", [], IDEA), next);

    expect(runAction).not.toHaveBeenCalled();
  });

  it("leaves a restarted welcome alone when the old build finishes", async () => {
    startBuilding();
    const { deps, runAction } = makeDeps([]);
    const next = rs.fn(async () => {
      progress.row = { ...progress.row, node: "await_names", buildSessionId: null };
      return finished;
    });

    await createHook(deps).handle(makeContext("core:main", [], IDEA), next);

    expect(runAction).not.toHaveBeenCalled();
    expect(progress.row.node).toBe("await_names");
  });

  it("leaves the main agent's other turns alone", async () => {
    startBuilding();
    const { deps, runAction } = makeDeps([]);
    const next = rs.fn(async () => finished);

    await createHook(deps).handle(makeContext("core:main", [], "Add a dark mode."), next);

    expect(next).toHaveBeenCalledOnce();
    expect(runAction).not.toHaveBeenCalled();
    expect(progress.row.node).toBe("building");
  });

  it("reads nothing for another agent's turn", async () => {
    startBuilding();
    const { deps } = makeDeps([]);
    const next = rs.fn(async () => finished);

    await createHook(deps).handle(makeContext("notes:writer", [], IDEA), next);

    expect(next).toHaveBeenCalledOnce();
    expect(repositoryOpened).not.toHaveBeenCalled();
  });
});
