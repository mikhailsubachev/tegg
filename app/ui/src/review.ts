// D-591 (inbox.md FR-INB-03 AC-7): which objects show the review toggle at the top of their page and get the palette's
// `Mark reviewed` / `Mark unreviewed`: a `review` of `unreviewed` or `reviewed`, a Quick Note or Daily Note (locked,
// R61, D-554), or a type whose review workflow is on, even without a value. Never templates or files without frontmatter.

export function reviewable(o: { path: string; type: string; hasFrontmatter: boolean; review: unknown; typeReview?: string | null }): boolean {
  if (!o.hasFrontmatter || o.path.normalize('NFC').startsWith('_templates/')) return false;
  const v = typeof o.review === 'string' ? o.review.normalize('NFC').trim() : null;
  return v === 'unreviewed' || v === 'reviewed' || o.type === 'quick-note' || o.type === 'daily-note' || o.typeReview === 'on' || o.typeReview === 'locked';
}
