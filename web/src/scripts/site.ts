import { mountSections } from './sections';
import './header';
import { observeVisibility } from '@/lib/visibility';
import { mountPipelineExplorer } from './explorer';
import { mountSlidingToggle } from '@/lib/controls';
let cleanup: (() => void)[] = [];
let previousPageUrl = document.referrer;
let currentPageUrl = location.href;
function init() {
  cleanup.splice(0).forEach((fn) => fn());
  [...document.querySelectorAll<HTMLElement>('[data-sliding-toggle]')]
    .filter((root) => !root.closest('.site-header'))
    .forEach((root) => cleanup.push(mountSlidingToggle(root)));
  document
    .querySelectorAll<HTMLElement>('[data-pipeline-explorer]')
    .forEach((root) => cleanup.push(mountPipelineExplorer(root)));
}
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', () => {
  previousPageUrl = currentPageUrl;
  cleanup.splice(0).forEach((fn) => fn());
});
document.addEventListener('astro:page-load', () => {
  currentPageUrl = location.href;
});

function mountLevelPage() {
  const root = document.querySelector<HTMLElement>('[data-level-page]');
  if (!root) return;
  const links = [
      ...root.querySelectorAll<HTMLAnchorElement>('[data-view-link]'),
    ],
    panels = [...root.querySelectorAll<HTMLElement>('[data-view-panel]')];
  let version = 0,
    initialized = false;
  const show = () => {
    const how =
        new URL(location.href).searchParams.get('view') === 'how-it-works',
      view = how ? 'how-it-works' : 'try';
    root.dataset.levelView = view;
    const pending = ++version;
    links.forEach((link) => {
      if (link.dataset.viewLink === view)
        link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const holder = root.querySelector<HTMLElement>('.level-panels')!,
      before = holder.getBoundingClientRect().height;
    holder.style.minHeight = `${Math.min(before, innerHeight)}px`;
    const previous = panels.find(
      (panel) => !panel.hidden && !panel.hasAttribute('data-view-leaving'),
    );
    const reduced =
      !initialized ||
      document.hidden ||
      matchMedia('(prefers-reduced-motion:reduce)').matches;
    initialized = true;
    panels.forEach((panel) => {
      panel.getAnimations().forEach((animation) => animation.cancel());
      panel.removeAttribute('data-view-leaving');
      panel.style.removeProperty('position');
      panel.style.removeProperty('inset');
      panel.style.removeProperty('width');
      panel.inert = false;
      panel.hidden = panel.dataset.viewPanel !== view;
      if (!panel.hidden && !reduced)
        panel.animate(
          [
            { opacity: 0, transform: `translateX(${how ? 18 : -18}px)` },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          { duration: 300, easing: 'ease-out' },
        );
    });
    if (previous && previous.dataset.viewPanel !== view && !reduced) {
      previous.hidden = false;
      previous.inert = true;
      previous.dataset.viewLeaving = '';
      Object.assign(previous.style, {
        position: 'absolute',
        inset: '0 0 auto',
        width: '100%',
      });
      previous
        .animate(
          [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: `translateX(${how ? -18 : 18}px)` },
          ],
          { duration: 300, easing: 'ease-out' },
        )
        .finished.then(() => {
          if (pending !== version) return;
          previous.hidden = true;
          previous.inert = false;
          previous.removeAttribute('style');
          previous.removeAttribute('data-view-leaving');
        })
        .catch(() => {});
    }
    document.title = `${root.dataset.levelName} · ${how ? 'How it works' : root.dataset.levelName === 'Advanced' ? 'Run locally' : 'Try it'} · RAG-Ladder`;
    window.dispatchEvent(new Event('rag:level-view'));
  };
  const handlers = links.map((link) => {
    const handler = (event: MouseEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      event.preventDefault();
      history.replaceState(history.state, '', link.href);
      show();
    };
    link.addEventListener('click', handler);
    return () => link.removeEventListener('click', handler);
  });
  const back = root.querySelector<HTMLAnchorElement>('[data-back-compare]')!;
  const goBack = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const previous = previousPageUrl;
    try {
      if (
        previous &&
        new URL(previous).origin === location.origin &&
        history.length > 1
      ) {
        event.preventDefault();
        history.back();
      }
    } catch {
      /* Compare is the fallback. */
    }
  };
  back.addEventListener('click', goBack);
  window.addEventListener('popstate', show);
  show();
  cleanup.push(() => {
    version++;
    handlers.forEach((fn) => fn());
    back.removeEventListener('click', goBack);
    window.removeEventListener('popstate', show);
  });
}
document.addEventListener('astro:page-load', mountLevelPage);

function mountMetrics() {
  const seen = new WeakSet<Element>(),
    startedKeys = new Set<string>(),
    disposers: (() => void)[] = [];
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  function add(element: HTMLElement) {
    if (seen.has(element)) return;
    seen.add(element);
    const target = Number(element.dataset.countup);
    if (!Number.isFinite(target)) return;
    let frame = 0,
      last = 0,
      elapsed = 0,
      done = false,
      started = false;
    const tick = (now: number) => {
      elapsed += last ? now - last : 0;
      last = now;
      const progress = Math.min(1, elapsed / 1400);
      element.textContent = (target * (1 - Math.pow(1 - progress, 3))).toFixed(
        1,
      );
      if (progress < 1 && !reduced.matches) frame = requestAnimationFrame(tick);
      else {
        element.textContent = target.toFixed(1);
        done = true;
        frame = 0;
      }
    };
    const stop = observeVisibility(element, (visible, entry) => {
      if (done) return;
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
        return;
      }
      if ((entry?.intersectionRatio || 0) < 0.2) return;
      if (!started) {
        const key = element.dataset.countupKey;
        if (reduced.matches || (key && startedKeys.has(key))) {
          element.textContent = target.toFixed(1);
          done = true;
          return;
        }
        if (key) startedKeys.add(key);
        started = true;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    });
    disposers.push(() => {
      stop();
      cancelAnimationFrame(frame);
    });
  }
  const scan = (root: ParentNode) =>
    root.querySelectorAll<HTMLElement>('[data-countup]').forEach(add);
  scan(document);
  const mutations = new MutationObserver((entries) =>
    entries.forEach((entry) =>
      entry.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node.matches('[data-countup]')) add(node);
          scan(node);
        }
      }),
    ),
  );
  mutations.observe(document.body, { childList: true, subtree: true });
  document
    .querySelectorAll<HTMLElement>('[data-visibility]')
    .forEach((element) => {
      let revealed = false;
      disposers.push(
        observeVisibility(element, (visible) => {
          element.dataset.inView = String(visible);
          if (visible && !revealed && !reduced.matches) {
            revealed = true;
            element.animate(
              [
                { transform: 'translateY(24px)' },
                { transform: 'translateY(0)' },
              ],
              { duration: 650, easing: 'ease-out' },
            );
          }
        }),
      );
    });
  cleanup.push(() => {
    mutations.disconnect();
    disposers.forEach((fn) => fn());
  });
}
function mountPointerCards() {
  const eligible = matchMedia(
    '(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)',
  );
  const visible = new WeakSet<Element>(),
    stops: (() => void)[] = [];
  document.querySelectorAll<HTMLElement>('[data-reactive]').forEach((card) =>
    stops.push(
      observeVisibility(card, (on) => {
        if (on) visible.add(card);
        else visible.delete(card);
      }),
    ),
  );
  let frame = 0,
    pointer: PointerEvent | null = null;
  const paint = () => {
    frame = 0;
    const event = pointer;
    if (!event || !eligible.matches || document.hidden) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-reactive]',
    );
    if (!card || !visible.has(card)) return;
    const rect = card.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    card.style.setProperty('--tilt-x', `${-(y / rect.height - 0.5) * 12}deg`);
    card.style.setProperty('--tilt-y', `${(x / rect.width - 0.5) * 12}deg`);
    card.style.setProperty('--spot-x', `${x}px`);
    card.style.setProperty('--spot-y', `${y}px`);
  };
  const move = (event: PointerEvent) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-reactive]',
    );
    if (!card || !visible.has(card)) return;
    pointer = event;
    if (!frame && eligible.matches && !document.hidden)
      frame = requestAnimationFrame(paint);
  };
  const out = (event: PointerEvent) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-reactive]',
    );
    if (card && !card.contains(event.relatedTarget as Node)) {
      pointer = null;
      card.style.removeProperty('--tilt-x');
      card.style.removeProperty('--tilt-y');
    }
  };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerout', out, { passive: true });
  cleanup.push(() => {
    cancelAnimationFrame(frame);
    stops.forEach((fn) => fn());
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerout', out);
  });
}
document.addEventListener('astro:page-load', () => {
  let stopSections = mountSections();
  const refreshSections = () => {
    stopSections();
    stopSections = mountSections();
  };
  window.addEventListener('rag:sections', refreshSections);
  window.addEventListener('rag:level-view', refreshSections);
  cleanup.push(() => {
    stopSections();
    window.removeEventListener('rag:sections', refreshSections);
    window.removeEventListener('rag:level-view', refreshSections);
  });
  mountMetrics();
  mountPointerCards();
  if (document.querySelector('#hero')) {
    let alive = true;
    import('./overview')
      .then(({ mountOverview }) => {
        if (!alive) return;
        const dispose = mountOverview();
        if (alive) cleanup.push(dispose);
        else dispose();
      })
      .catch(() => {});
    cleanup.push(() => {
      alive = false;
    });
  }
});
