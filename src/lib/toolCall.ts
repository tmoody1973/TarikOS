/* One door for every tool. Voice (GPT-Live) and text (Telegram) both run a
 * tool by POSTing to /api/tools/<name> with the shared secret, exactly as
 * ElevenLabs does, so the enable toggle, health marking, tracing and error
 * handling in that route apply to every channel. */

const MAX_RESULT_CHARS = 12_000;

export async function callTool(
  origin: string,
  name: string,
  input: unknown,
  secret: string,
): Promise<string> {
  const res = await fetch(new URL(`/api/tools/${name}`, origin), {
    method: "POST",
    headers: { "content-type": "application/json", "x-morpheus-secret": secret },
    body: JSON.stringify(input ?? {}),
  });
  // Handed to the model as-is: the route already answers with a spoken
  // `message` on failure, which is more useful than a status code.
  return (await res.text()).slice(0, MAX_RESULT_CHARS);
}
