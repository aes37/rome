/**
 * The services whose channels can be linked to an agent: the bots a guardian
 * adds to chats on behalf of an agent, and the signed-in Telegram user. A
 * channel that carries Rome's own traffic (the Cloud `agents` channel, webchat,
 * email) stays with main. Core checks it when it links an agent, and the
 * dashboard reads it to offer the picker. Invariants:
 * docs/architecture/channels.md#linked-agents.
 */
export const LINKABLE_SERVICES: ReadonlySet<string> = new Set([
  "feishu",
  "telegram",
  "discord",
  "telegram_user",
]);

/** The ids main answers to. Main answers wherever no agent is linked, so no
 *  account links to it: core refuses it, and the picker leaves it out. */
export const MAIN_AGENT_IDS = ["main", "core:main"] as const;

export function isMainAgent(id: string): boolean {
  return (MAIN_AGENT_IDS as readonly string[]).includes(id);
}
