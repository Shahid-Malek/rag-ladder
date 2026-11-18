export function mountPipelineExplorer(root: HTMLElement) {
  const fixed = root.dataset.fixedLevel;
  const options = [
    ...root.querySelectorAll<HTMLButtonElement>('[data-level-choice]'),
  ];
  const panels = [
    ...root.querySelectorAll<HTMLElement>('[data-explorer-panel]'),
  ];
  const empty = root.querySelector<HTMLElement>('[data-explorer-empty]');
  const loading = root.querySelector<HTMLElement>('[data-explorer-loading]')!;
  const content = root.querySelector<HTMLElement>('.explorer-content')!;
  const media = matchMedia('(prefers-reduced-motion:no-preference)');
  let current = '',
    version = 0,
    dispose: (() => void) | undefined;
  function stop() {
    version++;
    dispose?.();
    dispose = undefined;
    loading.hidden = true;
    content.setAttribute('aria-busy', 'false');
  }
  async function start() {
    stop();
    const own = version;
    const panel = panels.find(
      (panel) => panel.dataset.explorerPanel === current,
    );
    if (!panel || root.closest('[hidden],[data-view-leaving]')) return;
    loading.hidden = !media.matches;
    content.setAttribute('aria-busy', 'true');
    try {
      const { mountPipeline } = await import('./pipeline');
      if (own !== version) return;
      const cleanup = await mountPipeline(
        panel.querySelector('[data-pipeline]')!,
      );
      if (own !== version) cleanup();
      else dispose = cleanup;
    } finally {
      if (own === version) {
        loading.hidden = true;
        content.setAttribute('aria-busy', 'false');
      }
    }
  }
  function scrollToPipeline() {
    panels
      .find((panel) => !panel.hidden)
      ?.querySelector('.pipeline-section')
      ?.scrollIntoView({
        block: 'start',
        behavior: matchMedia('(prefers-reduced-motion:reduce)').matches
          ? 'auto'
          : 'smooth',
      });
  }
  function select(slug: string, write = false) {
    stop();
    current = panels.some((panel) => panel.dataset.explorerPanel === slug)
      ? slug
      : '';
    options.forEach((option) =>
      option.setAttribute(
        'aria-pressed',
        String(option.dataset.levelChoice === current),
      ),
    );
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.explorerPanel !== current;
      if (
        !panel.hidden &&
        !document.hidden &&
        !matchMedia('(prefers-reduced-motion:reduce)').matches
      )
        panel.animate(
          [
            { opacity: 0, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 300, easing: 'ease-out' },
        );
    });
    if (empty) empty.hidden = !!current;
    window.dispatchEvent(new Event('rag:sections'));
    if (write) {
      const url = new URL(location.href);
      if (current) url.searchParams.set('level', current);
      else url.searchParams.delete('level');
      history.replaceState(history.state, '', url);
    }
    const selected = current;
    start()
      .catch(() => {
        /* The ordered stage cards remain usable if motion cannot load. */
      })
      .then(() => {
        if (write && current === selected && root.isConnected)
          scrollToPipeline();
      });
  }
  const click = (event: MouseEvent) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-level-choice]',
    );
    if (!option || !root.contains(option)) return;
    if (option.dataset.levelChoice === current) scrollToPipeline();
    else select(option.dataset.levelChoice!, true);
  };
  const restore = () =>
    select(fixed || new URL(location.href).searchParams.get('level') || '');
  const visibility = () => {
    if (root.closest('[hidden],[data-view-leaving]')) stop();
    else start().catch(() => {});
  };
  let width = innerWidth,
    height = innerHeight,
    resizeTimer = 0;
  const resize = () => {
    // Ignore mobile browser chrome changes; rebuild for layout and orientation changes.
    if (width === innerWidth && Math.abs(height - innerHeight) < 120) return;
    width = innerWidth;
    height = innerHeight;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(visibility, 150);
  };
  window.addEventListener('resize', resize, { passive: true });
  root.addEventListener('click', click);
  window.addEventListener('popstate', restore);
  window.addEventListener('rag:level-view', visibility);
  media.addEventListener('change', visibility);
  restore();
  return () => {
    stop();
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', resize);
    root.removeEventListener('click', click);
    window.removeEventListener('popstate', restore);
    window.removeEventListener('rag:level-view', visibility);
    media.removeEventListener('change', visibility);
  };
}
