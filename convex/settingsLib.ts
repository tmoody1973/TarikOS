import type { MutationCtx, QueryCtx } from "./_generated/server";

// The one settings read/upsert pair — shared by the workflow seeder and the
// feed manager so the key-by-index query never drifts across copies.

export async function readSetting<T>(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<T | null> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return (row?.value as T) ?? null;
}

export async function upsertSetting(
  ctx: MutationCtx,
  key: string,
  value: unknown,
): Promise<void> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("settings", { key, value });
}

// For seed defaults on keys that users now edit at runtime (briefFeeds):
// never overwrite live data with hardcoded defaults.
export async function seedSettingIfAbsent(
  ctx: MutationCtx,
  key: string,
  value: unknown,
): Promise<void> {
  const existing = await readSetting(ctx, key);
  if (existing === null) await upsertSetting(ctx, key, value);
}
