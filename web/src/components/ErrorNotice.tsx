import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { explain, type Explanation } from '@/lib/errors';
export default function ErrorNotice({
  error,
  message,
  children,
}: {
  error?: Explanation;
  message?: string;
  children?: ReactNode;
}) {
  const detail =
    error ||
    (message
      ? {
          title: 'This step needs attention.',
          whatBroke: message,
          nextStep: '',
        }
      : explain(null, 'page'));
  return (
    <div className="notice error-notice" role="alert">
      <CircleAlert size={20} aria-hidden="true" />
      <div>
        <p className="font-semibold">{detail.title}</p>
        <p className="mt-2">{detail.whatBroke}</p>
        {detail.nextStep && <p className="mt-2">{detail.nextStep}</p>}
        {children}
      </div>
    </div>
  );
}
