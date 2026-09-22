/* The switch for the voice cutover (phase 2 of
 * docs/new-feat-research/2026-09-22-gpt-live-migration-plan.md).
 *
 * NEXT_PUBLIC_ because the choice is made in the browser: which provider
 * wraps the app shell and which dock renders. Unset means ElevenLabs, so a
 * deploy that forgot the variable behaves exactly as before. It is read at
 * build time, so a flip needs a redeploy; the fast rollback is Vercel's
 * instant rollback to the previous deployment. Both code paths stay until
 * phase 4. */

export type VoiceProvider = "elevenlabs" | "openai";

export function voiceProvider(): VoiceProvider {
  return process.env.NEXT_PUBLIC_VOICE_PROVIDER === "openai" ? "openai" : "elevenlabs";
}
