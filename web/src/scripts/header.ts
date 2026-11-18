import { mountSlidingToggle } from '@/lib/controls';
let mounted: HTMLElement | null = null;
let dispose: (() => void)[] = [];
let revision = 0;
function active(path: string) {
  const route = path.replace(/\/$/, '') || '/';
  document
    .querySelectorAll<HTMLAnchorElement>('.site-header [data-option]')
    .forEach((link) => {
      const selected = (link.pathname.replace(/\/$/, '') || '/') === route;
      if (selected && link.getAttribute('aria-current') !== 'page')
        link.setAttribute('aria-current', 'page');
      if (!selected && link.hasAttribute('aria-current'))
        link.removeAttribute('aria-current');
    });
}
function mount() {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (header && mounted !== header) {
    dispose.forEach((fn) => fn());
    mounted = header;
    dispose = [
      ...header.querySelectorAll<HTMLElement>('[data-sliding-toggle]'),
    ].map(mountSlidingToggle);
  }
  active(location.pathname);
}
document.addEventListener(
  'click',
  (event) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      '.site-header a[data-option]',
    );
    if (!link || link.origin !== location.origin) return;
    // Current-page links return to the top without starting another route swap.
    if (
      link.pathname === location.pathname &&
      link.search === location.search
    ) {
      event.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: matchMedia('(prefers-reduced-motion:reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    }
    // Optimistic paint only. Astro remains the single navigation owner.
    active(link.pathname);
  },
  true,
);
document.addEventListener('astro:before-preparation', (event) => {
  const own = ++revision;
  active(event.to.pathname);
  const loader = event.loader;
  event.loader = async () => {
    try {
      await loader();
      if (event.defaultPrevented && own === revision) active(location.pathname);
    } catch (error) {
      if (own === revision) active(location.pathname);
      throw error;
    }
  };
  event.signal.addEventListener(
    'abort',
    () => {
      if (own === revision) active(location.pathname);
    },
    { once: true },
  );
});
document.addEventListener('astro:after-swap', mount);
document.addEventListener('astro:page-load', () => {
  mount();
  document
    .querySelector<HTMLDetailsElement>('.mobile-menu')
    ?.removeAttribute('open');
});
window.addEventListener('hashchange', () => active(location.pathname));
window.addEventListener('popstate', () => active(location.pathname));

// The header animates its own pill; document snapshots only delay hit-testing.
document.addEventListener('astro:before-swap', (event) => {
  event.viewTransition.ready.catch(() => {});
  event.viewTransition.skipTransition();
});

// Animate real content through Astro's transition lifecycle; snapshots block rapid clicks.
let pageChanging = false;
document.addEventListener('astro:before-preparation', () => {
  pageChanging = true;
  if (document.hidden || matchMedia('(prefers-reduced-motion:reduce)').matches)
    return;
  document.getElementById('main')?.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0.35, transform: 'translateY(-6px)' },
    ],
    {
      duration: 220,
      easing: getComputedStyle(document.documentElement)
        .getPropertyValue('--ease-smooth')
        .trim(),
    },
  );
});
document.addEventListener('astro:page-load', () => {
  if (!pageChanging) return;
  pageChanging = false;
  if (document.hidden || matchMedia('(prefers-reduced-motion:reduce)').matches)
    return;
  document.getElementById('main')?.animate(
    [
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: 240,
      easing: getComputedStyle(document.documentElement)
        .getPropertyValue('--ease-smooth')
        .trim(),
    },
  );
});

// Safari suspends animation clocks in background windows; never leave a frozen first frame.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  document.getAnimations().forEach((animation) => {
    if (
      animation.effect?.getTiming().iterations !== Infinity &&
      animation.playState === 'running'
    )
      animation.finish();
  });
});
