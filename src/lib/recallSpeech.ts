/**
 * What Zola is told to say when recall comes back.
 *
 * A pure function rather than a template inline in the route, because the ORDER
 * of these two sentences is the whole rule and an order is worth a test.
 *
 * The rule (ticket 06): embeddings never return empty. Asked a question they
 * cannot answer, they hand back the nearest row regardless, and a near miss
 * delivered as an answer is noise wearing a citation — worse than silence,
 * because it teaches him to stop trusting recall. So: the no comes first,
 * always; anything close follows it, labelled as only close.
 */
export function recallMessage(count: number, near: readonly string[]): string {
  if (count > 0) return `Found ${count} matching item(s).`;
  const no = "Nothing in the second brain matches that.";
  if (near.length === 0) return `${no} Say so plainly.`;
  return `${no} Say that first. Only then, if it helps: the nearest thing is ${near.join("; ")} — and say it is only near, not an answer.`;
}
