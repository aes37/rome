// The agent linked to a channel, as the channel-message hook reads it.
// Vocabulary: docs/concepts/messaging.md#channels. Invariants:
// docs/architecture/channels.md#linked-agents.

import { isMainAgent, LINKABLE_SERVICES } from "@rome/api-types/linked-agents";
import type { ChannelRecordsRepository } from "../db/repositories/channel-records.js";
import { createLogger } from "../logger.js";
import type { Channel } from "./channel.js";

const log = createLogger("linked-agents");

/**
 * Give `channel` a `linkedAgent` read from its record on each access, so a
 * relink takes effect on the next message. It reads null when no agent is
 * linked, and also when the linked agent is not loaded, which warns once per
 * channel and agent until that agent loads again. A channel of a service
 * outside `LINKABLE_SERVICES` is returned as is, with no `linkedAgent`, and
 * main keeps answering it. Mutates `channel`, so pass the hook's own copy.
 */
export function withLinkedAgent<C extends Pick<Channel, "name">>(
  channel: C,
  records: Pick<ChannelRecordsRepository, "byId" | "serviceOf">,
  agents: { has(name: string): boolean },
): C {
  if (!LINKABLE_SERVICES.has(records.serviceOf(channel.name))) return channel;
  let warnedAbout: string | null = null;
  Object.defineProperty(channel, "linkedAgent", {
    get: () => {
      const agent = records.byId(channel.name)?.agent ?? null;
      if (agent === null || isMainAgent(agent) || agents.has(agent)) {
        warnedAbout = null;
        return agent;
      }
      if (warnedAbout !== agent) {
        warnedAbout = agent;
        log.warn("linked agent is not loaded; the account stays silent", {
          channel: channel.name,
          agent,
        });
      }
      return null;
    },
    enumerable: false,
    configurable: true,
  });
  return channel;
}
