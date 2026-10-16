// When the guardian resolves an inline card or a handoff in webchat, the calling
// agent is re-driven on a fresh turn whose prompt embeds the resolved artifact
// as a fenced JSON block (`interpretInteractionResult` in core's webchat route).
// A scripted turn reads the artifact back out of that prompt — these helpers are
// the one place that contract is parsed.

/** Parse the fenced ```json object out of a resolution prompt. Returns null
 *  when this turn is not an interaction resolution (e.g. plain typed text). */
export function readResolutionJson(prompt: string): Record<string, unknown> | null {
  const fence = prompt.match(/```json\s*([\s\S]*?)```/);
  if (!fence) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence[1]);
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Detect a dismissed interaction (the guardian closed the card/handoff without
 *  producing a result). */
export function isDismissedInteraction(prompt: string): boolean {
  return prompt.includes("dismissed the interaction");
}

/** Detect an interaction resolution: core's preamble followed by the fenced
 *  result, as opposed to a typed message that happens to contain JSON. */
export function isInteractionResult(prompt: string): boolean {
  return (
    prompt.startsWith("The interaction the guardian was working in resolved with this result:") &&
    readResolutionJson(prompt) !== null
  );
}
