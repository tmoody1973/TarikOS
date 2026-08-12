import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /api/tools uses its own shared-secret auth (ElevenLabs webhooks, not
// browsers); /api/browser/run is the server-to-server Stagehand runner,
// gated by the same x-morpheus-secret check inside the route.
// /api/elevenlabs is the post-call webhook, authenticated by ElevenLabs
// signature verification inside the route rather than a browser session.
// /f/<slug> is the shared-document route: no session by design, since the
// recipient isn't Tarik. Its access control is the slug plus the expiry,
// revocation and download-cap checks in convex/documentsLib.ts.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/api/tools(.*)",
  "/api/browser/run",
  "/api/elevenlabs(.*)",
  "/f/(.*)",
  // Telnyx inbound SMS: the caller is a carrier webhook, authenticated by an
  // Ed25519 signature inside the route rather than a browser session.
  "/api/sms(.*)",
  // Telegram bot webhook: same shape, authenticated by a shared secret header.
  "/api/telegram(.*)",
  // Mail arriving at zola@tarikos.app: the caller is AgentMail, not a browser.
  // Authenticated by a Svix signature checked against the raw body inside the
  // route, before anything is parsed.
  "/api/agentmail(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // `onnx` is the wake-word models in public/wake. They are weights, not
    // secrets, and without the exclusion 3.5MB of static asset takes a
    // middleware hop and comes back as an auth redirect — which is exactly how
    // it was found: the worklet served, the models 404'd.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|onnx|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
