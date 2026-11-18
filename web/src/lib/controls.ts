export const pillTravelDuration = (from: number, to: number) =>
  Math.min(650, 380 + 40 * Math.abs(to - from));

// Shared geometry and keyboard behavior for server-rendered and React controls.
export function mountSlidingToggle(root: HTMLElement) {
  const indicator = root.querySelector<HTMLElement>(
    ':scope > .sliding-indicator',
  );
  const ghost = root.querySelector<HTMLElement>(':scope > .sliding-ghost');
  let firstMeasure = true;
  let previousIndex = -1;
  let hovered: HTMLElement | null = null;
  const position = (element: HTMLElement, target: HTMLElement) => {
    const rect = target.getBoundingClientRect(),
      parent = root.getBoundingClientRect();
    const transform = new DOMMatrixReadOnly(getComputedStyle(target).transform);
    const width = rect.width / (transform.a || 1),
      height = rect.height / (transform.d || 1);
    element.style.width = `${pixel(width)}px`;
    element.style.height = `${pixel(height)}px`;
    element.style.transform = `translate(${pixel(rect.left - (width - rect.width) / 2 - parent.left + root.scrollLeft)}px, ${pixel(rect.top - (height - rect.height) / 2 - parent.top + root.scrollTop)}px)`;
  };
  const pixel = (value: number) =>
    Math.round(value * devicePixelRatio) / devicePixelRatio;
  const options = () => [
    ...root.querySelectorAll<HTMLElement>(':scope > [data-option]'),
  ];
  function measure() {
    const active = options().find((el) =>
      el.matches(
        '[aria-current="page"], [aria-pressed="true"], [aria-selected="true"]',
      ),
    );
    if (!active || !indicator) {
      if (indicator) indicator.hidden = true;
      return;
    }
    indicator.hidden = false;
    if (!active.getBoundingClientRect().width) return;
    const items = options(),
      index = items.indexOf(active);
    if (index !== previousIndex) {
      const duration = pillTravelDuration(Math.max(0, previousIndex), index);
      root.style.setProperty('--pill-duration', `${duration}ms`);
      items.forEach((item, i) =>
        item.style.setProperty(
          '--label-delay',
          !firstMeasure && i === index ? `${duration - 250}ms` : '0ms',
        ),
      );
      previousIndex = index;
    }
    if (firstMeasure) indicator.style.transition = 'none';
    position(indicator, active);
    if (ghost && hovered) position(ghost, hovered);
    root.dataset.ready = 'true';
    if (firstMeasure) {
      firstMeasure = false;
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          indicator.style.removeProperty('transition'),
        ),
      );
    }
  }
  function key(event: KeyboardEvent) {
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(event.key)
    )
      return;
    const items = options(),
      current = items.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current +
              (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
              items.length) %
            items.length;
    items[index].focus();
    if (items[index].tagName === 'BUTTON') items[index].click();
  }
  const hover = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !ghost) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-option]',
    );
    if (!target || target.parentElement !== root || hovered === target) return;
    const items = options();
    ghost.style.setProperty(
      '--pill-duration',
      `${pillTravelDuration(Math.max(0, items.indexOf(hovered!)), items.indexOf(target))}ms`,
    );
    if (!hovered) ghost.style.transition = 'opacity 150ms var(--ease-smooth)';
    hovered = target;
    position(ghost, target);
    ghost.style.opacity = '1';
    requestAnimationFrame(() => ghost.style.removeProperty('transition'));
  };
  const leave = () => {
    if (ghost) ghost.style.opacity = '0';
    hovered = null;
  };
  root.addEventListener('pointerover', hover);
  root.addEventListener('pointerleave', leave);
  const resize = new ResizeObserver(measure);
  resize.observe(root);
  const mutation = new MutationObserver(measure);
  mutation.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current', 'aria-pressed', 'aria-selected'],
  });
  root.addEventListener('keydown', key);
  root.addEventListener('sliding:measure', measure);
  document.fonts.ready.then(() => {
    if (root.isConnected) measure();
  });
  measure();
  return () => {
    root.removeEventListener('pointerover', hover);
    root.removeEventListener('pointerleave', leave);
    resize.disconnect();
    mutation.disconnect();
    root.removeEventListener('keydown', key);
    root.removeEventListener('sliding:measure', measure);
    delete root.dataset.ready;
  };
}
