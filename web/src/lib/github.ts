import { site } from '@/data/site';

let result: Promise<number | null> | undefined;
export function getBuildStarCount(): Promise<number | null> {
  if (site.repositoryPrivate) return Promise.resolve(null);
  return (result ??= fetch(site.repositoryApi, {
    signal: AbortSignal.timeout(4000),
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const data: unknown = await response.json();
      const count = (data as { stargazers_count?: unknown }).stargazers_count;
      return typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 0
        ? count
        : null;
    })
    .catch(() => site.starCountFallback));
}
