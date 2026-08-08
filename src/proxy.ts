import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /api/tools uses its own shared-secret auth (ElevenLabs webhooks, not
// browsers); /api/browser/run is the server-to-server Stagehand runner,
// gated by the same x-morpheus-secret check inside the route.
// /api/elevenlabs is the post-call webhook, authenticated by ElevenLabs
// signature verification inside the route rather than a browser session.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/api/tools(.*)",
  "/api/browser/run",
  "/api/elevenlabs(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
