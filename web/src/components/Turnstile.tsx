import { useEffect, useRef, useState } from 'react';
import ErrorNotice from './ErrorNotice';
import { Skeleton } from './ui/skeleton';

type Widget = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  ready: (callback: () => void) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}
let scriptReady: Promise<void> | undefined;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  return (scriptReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptReady = undefined;
      script.remove();
      reject(new Error('Challenge could not load.'));
    };
    document.head.appendChild(script);
  }));
}
export default function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false,
      id: string | undefined;
    setReady(false);
    setError('');
    onToken('');
    loadScript()
      .then(() => {
        window.turnstile?.ready(() => {
          if (disposed || !element.current) return;
          id = window.turnstile!.render(element.current, {
            sitekey: siteKey,
            action,
            theme: 'light',
            size: 'compact',
            callback: (token: string) => {
              onToken(token);
              setError('');
            },
            'expired-callback': () => {
              onToken('');
              setError('The check expired. Run it again.');
            },
            'error-callback': () => {
              onToken('');
              setError('The check could not complete. Try again.');
            },
          });
          setReady(true);
        });
      })
      .catch(() => {
        if (!disposed)
          setError(
            'The security check could not load. Check your connection and try again.',
          );
      });
    return () => {
      disposed = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, action, onToken, attempt]);
  return (
    <div className="my-5 min-h-40" aria-label="Security check">
      {!ready && !error && (
        <div role="status" aria-busy="true">
          <Skeleton className="h-36 w-40 rounded-navigation" />
          <span className="sr-only">Loading security check</span>
        </div>
      )}
      <div ref={element} />
      {error && (
        <div className="mt-3 text-body">
          <ErrorNotice message={error} />
          <button
            className="mt-3 min-h-11 underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry security check
          </button>
        </div>
      )}
    </div>
  );
}
