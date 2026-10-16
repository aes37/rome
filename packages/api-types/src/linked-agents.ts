/**
 * The services whose channels can be linked to an agent: the bots a guardian
 * adds to chats on behalf of an agent, and the signed-in Telegram user. A
 * channel that carries Rome's own traffic (the Cloud `agents` channel, webchat,
 * email) takes no link. Core checks it when it links an agent, and the
 * dashboard reads it to offer the picker. Invariants:
 * docs/architecture/channels.md#linked-agents.
 */
export const LINKABLE_SERVICES: ReadonlySet<string> = new Set([
  "feishu",
  "telegram",
  "discord",
  "telegram_user",
]);

/** The canonical id of main, the id core stores when main is linked. */
export const MAIN_AGENT_ID = "core:main";

/** The ids main answers to. Main is linked to an account like any agent, and
 *  stored by `MAIN_AGENT_ID`. Unlike any other agent, it may be linked to
 *  several accounts on one platform. */
export const MAIN_AGENT_IDS = ["main", MAIN_AGENT_ID] as const;

export function isMainAgent(id: string): boolean {
  return (MAIN_AGENT_IDS as readonly string[]).includes(id);
}
