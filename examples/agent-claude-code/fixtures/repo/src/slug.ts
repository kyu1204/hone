// Turn a title into a URL slug. Known bug: consecutive separators are not collapsed.
export function slugify(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}
