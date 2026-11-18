import { useEffect, useRef, useState, type ComponentType } from 'react';
import { observeVisibility } from '@/lib/visibility';
import IslandBoundary from './IslandBoundary';
function Content() {
  const root = useRef<HTMLDivElement>(null);
  const [Swarm, setSwarm] = useState<ComponentType<any> | null>(null),
    [visible, setVisible] = useState(false),
    [colors, setColors] = useState({ color: '', accent: '' });
  useEffect(() => {
    const element = root.current!,
      eligible = matchMedia(
        '(pointer:fine) and (hover:hover) and (prefers-reduced-motion:no-preference)',
      );
    let disposed = false,
      disabled = false,
      seen = false,
      loaded = false,
      loading = false,
      idle = 0;
    const cancel = () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
      idle = 0;
    };
    const update = () => {
      const active = seen && eligible.matches && !document.hidden && !disabled;
      setVisible(active);
      if (!active) {
        cancel();
        return;
      }
      if (loaded || loading || idle) return;
      const load = () => {
        idle = 0;
        if (disposed || !seen || document.hidden) return;
        loading = true;
        import('./SwarmCursor.jsx')
          .then((module) => {
            loaded = true;
            if (!disposed) setSwarm(() => module.default);
          })
          .catch(() => {})
          .finally(() => {
            loading = false;
          });
      };
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(load, { timeout: 1800 })
        : window.setTimeout(load, 300);
    };
    const style = getComputedStyle(document.documentElement);
    setColors({
      color: style.getPropertyValue('--color-arctic-blue').trim(),
      accent: style.getPropertyValue('--color-arctic-navy').trim(),
    });
    const stop = observeVisibility(element, (value) => {
      seen = value;
      update();
    });
    const lowPower = () => {
      disabled = true;
      setVisible(false);
    };
    element.addEventListener('swarm:low-power', lowPower);
    eligible.addEventListener('change', update);
    return () => {
      disposed = true;
      cancel();
      stop();
      element.removeEventListener('swarm:low-power', lowPower);
      eligible.removeEventListener('change', update);
    };
  }, []);
  return (
    <div className="hero-swarm" ref={root} aria-hidden="true">
      {visible && Swarm && (
        <Swarm
          count={64}
          size={1.8}
          color={colors.color}
          accentColor={colors.accent}
          idle="hide"
          intro={false}
          dpr={1}
          lightMode
        />
      )}
    </div>
  );
}
export default function HeroSwarm() {
  return (
    <IslandBoundary>
      <Content />
    </IslandBoundary>
  );
}
