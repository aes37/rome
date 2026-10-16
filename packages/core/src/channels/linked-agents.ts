// The agent linked to a channel, as the channel-message hook reads it.
// Vocabulary: docs/concepts/messaging.md#channels. Invariants:
// docs/architecture/channels.md#linked-agents.

import type { ChannelMessageHookDeps } from "@rome-os/app-runtime";
import { LINKABLE_SERVICES } from "@rome/api-types/linked-agents";
import { isCoreMainAgentId } from "../apps/artifact-id.js";
import type { ChannelRecordsRepository } from "../db/repositories/channel-records.js";
import { createLogger } from "../logger.js";

const log = createLogger("linked-agents");

/**
 * The hook's `linkedAgentOf`, reading the channel's record on each call, so a
 * relink, or a channel whose record lands after wiring, is right on the next
 * message. It answers undefined for a channel whose service is outside
 * `LINKABLE_SERVICES`, the stored agent for a linked one, and null for one with
 * no agent or whose agent is not loaded. An agent that is not loaded warns
 * once per channel and agent, until that agent loads again.
 */
export function linkedAgentResolver(
  records: Pick<ChannelRecordsRepository, "byId">,
  agents: { has(name: string): boolean },
): NonNullable<ChannelMessageHookDeps["linkedAgentOf"]> {
  const warned = new Map<string, string>();
  return (channelName) => {
    const record = records.byId(channelName);
    // A service's first channel carries the service's name, so a channel with
    // no record answers for its own service.
    if (!LINKABLE_SERVICES.has(record?.service ?? channelName)) return undefined;
    const agent = record?.agent ?? null;
    if (agent === null || isCoreMainAgentId(agent) || agents.has(agent)) {
      warned.delete(channelName);
      return agent;
    }
    if (warned.get(channelName) !== agent) {
      warned.set(channelName, agent);
      log.warn("linked agent is not loaded; the account stays silent", {
        channel: channelName,
        agent,
      });
    }
    return null;
  };
}
