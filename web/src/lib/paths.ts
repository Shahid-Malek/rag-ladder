export function withBase(path = '/') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (base && (path === base || path.startsWith(`${base}/`))) return path;
  return `${base}/${path.replace(/^\/+/, '')}`;
}
