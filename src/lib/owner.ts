import { currentUser } from "@clerk/nextjs/server";

/* Single-user by design (PRODUCT.md): one instance serves one person.
 *
 * Clerk's dashboard Restrictions stop NEW sign-ups. This is the second lock:
 * it stops any account that already exists — or one created before
 * restrictions were switched on, or through a path the dashboard doesn't
 * cover — from reaching the dashboard.
 *
 * OWNER_EMAIL unset means this gate is off. That is deliberate: a forker who
 * hasn't set it should reach their own instance rather than a blank wall, and
 * Clerk's own auth still stands in front of every route. Set it. */
export async function isOwner(): Promise<boolean> {
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return true;

  const user = await currentUser();
  if (!user) return false;

  // Verified addresses only — an unverified one is just a claim.
  return user.emailAddresses.some(
    (e) =>
      e.emailAddress.trim().toLowerCase() === owner &&
      e.verification?.status === "verified"
  );
}
