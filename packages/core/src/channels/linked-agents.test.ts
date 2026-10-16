import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import type { ChannelRecord } from "../db/repositories/channel-records.js";
import { withLinkedAgent } from "./linked-agents.js";

const warn = rs.hoisted(() => rs.fn());

rs.mock("../logger.js", () => ({
  createLogger: () => ({ debug: rs.fn(), info: rs.fn(), warn, error: rs.fn() }),
}));

type Linked = { name: string; linkedAgent?: string | null };

describe("withLinkedAgent", () => {
  let agent: string | null;
  let loaded: Set<string>;
  const services: Record<string, string> = { "feishu-2": "feishu", telegram: "telegram" };
  const records = {
    serviceOf: (id: string) => services[id] ?? id,
    byId: (id: string) =>
      id === "feishu-2" ? ({ id, service: "feishu", agent } as unknown as ChannelRecord) : null,
  };
  const agents = { has: (name: string) => loaded.has(name) };

  beforeEach(() => {
    agent = "sales:agent";
    loaded = new Set(["sales:agent", "support:agent"]);
    warn.mockClear();
  });

  it("reads a linkable channel's agent from its record on each access", () => {
    const channel: Linked = withLinkedAgent({ name: "feishu-2" }, records, agents);

    expect(channel.linkedAgent).toBe("sales:agent");
    agent = "support:agent";
    expect(channel.linkedAgent).toBe("support:agent");
    agent = "core:main";
    expect(channel.linkedAgent).toBe("core:main");
    agent = null;
    expect(channel.linkedAgent).toBeNull();
  });

  it("reads null for a linkable channel no record names", () => {
    const channel: Linked = withLinkedAgent({ name: "telegram" }, records, agents);

    expect(channel.linkedAgent).toBeNull();
  });

  it("reads null while the linked agent is not loaded, and warns once until it loads", () => {
    const channel: Linked = withLinkedAgent({ name: "feishu-2" }, records, agents);
    loaded.delete("sales:agent");

    expect(channel.linkedAgent).toBeNull();
    expect(channel.linkedAgent).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      channel: "feishu-2",
      agent: "sales:agent",
    });

    loaded.add("sales:agent");
    expect(channel.linkedAgent).toBe("sales:agent");
    loaded.delete("sales:agent");
    expect(channel.linkedAgent).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("leaves a channel of a service that takes no link without one", () => {
    for (const name of ["webchat", "email", "agents", "whatsapp"]) {
      const channel: Linked = withLinkedAgent({ name }, records, agents);

      expect("linkedAgent" in channel).toBe(false);
    }
  });
});
