// Minimal cn for vendored ElevenLabs UI components (no tailwind-merge:
// our usages never produce conflicting classes).
export function cn(
  ...inputs: (string | undefined | null | false)[]
): string {
  return inputs.filter(Boolean).join(" ");
}
