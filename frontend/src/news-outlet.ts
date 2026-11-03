/**
 * Outlet label for news cards and the ticker modal.
 * X ingest stores the same @handle in sourceLabel and author, so joining them
 * verbatim rendered "@handle · @handle". Show the author only when it adds
 * information beyond the outlet label.
 */
export function newsOutletLabel(item: {
  sourceLabel?: string | null;
  author?: string | null;
  source?: string | null;
}): string {
  const label = (item.sourceLabel ?? "").trim();
  const author = (item.author ?? "").trim();
  if (item.source === "article" || !author) return label;
  if (!label) return author;
  return author === label ? label : `${label} · ${author}`;
}
