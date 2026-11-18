type Listener = (visible: boolean, entry?: IntersectionObserverEntry) => void;
const targets = new Map<
  Element,
  { entry?: IntersectionObserverEntry; listeners: Set<Listener> }
>();
let observer: IntersectionObserver | undefined;
export function observeVisibility(element: Element, listener: Listener) {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true);
    return () => {};
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = targets.get(entry.target);
          if (!target) continue;
          target.entry = entry;
          target.listeners.forEach((fn) =>
            fn(entry.isIntersecting && !document.hidden, entry),
          );
        }
      },
      { threshold: [0, 0.2] },
    );
    document.addEventListener('visibilitychange', () => {
      document.documentElement.toggleAttribute(
        'data-tab-hidden',
        document.hidden,
      );
      targets.forEach((target) =>
        target.listeners.forEach((fn) =>
          fn(!!target.entry?.isIntersecting && !document.hidden, target.entry),
        ),
      );
    });
  }
  let target = targets.get(element);
  if (!target) {
    target = { listeners: new Set() };
    targets.set(element, target);
    observer.observe(element);
  }
  target.listeners.add(listener);
  if (target.entry)
    listener(target.entry.isIntersecting && !document.hidden, target.entry);
  return () => {
    target!.listeners.delete(listener);
    if (!target!.listeners.size) {
      observer!.unobserve(element);
      targets.delete(element);
    }
  };
}
