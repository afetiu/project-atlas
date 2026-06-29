/**
 * Stable id generation shared by AI detection and the MCP server, so both
 * produce identical, collision-free ids from human-readable names. Keeping one
 * implementation prevents the two paths from drifting apart.
 */

/** Lowercase, hyphenate, and trim a name into an id-safe slug. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  );
}

/** Return `base`, or `base-2`, `base-3`, … until it doesn't collide with `used`. */
export function uniqueId(base: string, used: Iterable<string>): string {
  const taken = used instanceof Set ? used : new Set(used);
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

/** Slugify `name` and disambiguate against `used` in one step. */
export function uniqueSlug(name: string, used: Iterable<string>): string {
  return uniqueId(slugify(name), used);
}
