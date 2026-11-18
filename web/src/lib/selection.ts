export const levelSlugs = ['naive', 'intermediate', 'advanced'] as const;
export function readSelection(search: string): string[] {
  const requested = new Set(
    (new URLSearchParams(search).get('levels') || '').split(','),
  );
  return levelSlugs.filter((slug) => requested.has(slug));
}
export function selectionUrl(href: string, selected: string[]) {
  const url = new URL(href);
  const ordered = levelSlugs.filter((slug) => selected.includes(slug));
  if (ordered.length) url.searchParams.set('levels', ordered.join(','));
  else url.searchParams.delete('levels');
  return url;
}
