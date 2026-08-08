import { registerOTel } from "@vercel/otel";
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";

export const PHOENIX_PROJECT_NAME = "tarik-os";

// Next.js calls this once per runtime at startup.
//
// @vercel/otel reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS
// from the environment and — the part that matters — flushes spans before the
// serverless function freezes. A hand-rolled exporter silently records nothing
// on Vercel because the function returns before the batch is sent.
//
// openinference.project.name is what Phoenix routes spans by. serviceName alone
// is NOT enough: without this resource attribute every span lands in Phoenix's
// "default" project, and any eval querying project_name="tarik-os" finds
// nothing while appearing to be correctly configured.
export function register() {
  registerOTel({
    serviceName: PHOENIX_PROJECT_NAME,
    attributes: {
      [SEMRESATTRS_PROJECT_NAME]: PHOENIX_PROJECT_NAME,
    },
  });
}
