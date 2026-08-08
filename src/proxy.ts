import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /api/tools uses its own shared-secret auth (ElevenLabs webhooks, not
// browsers); /api/browser/run is the server-to-server Stagehand runner,
// gated by the same x-morpheus-secret check inside the route.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/api/tools(.*)",
  "/api/browser/run",
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
