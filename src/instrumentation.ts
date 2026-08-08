import { registerOTel } from "@vercel/otel";

// Next.js calls this once per runtime at startup.
//
// @vercel/otel reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS
// from the environment and — the part that matters — flushes spans before the
// serverless function freezes. A hand-rolled exporter silently records nothing
// on Vercel because the function returns before the batch is sent.
export function register() {
  registerOTel({ serviceName: "tarik-os" });
}
