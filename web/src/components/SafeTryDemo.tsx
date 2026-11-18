import TryDemo from './TryDemo';
import IslandBoundary from './IslandBoundary';
import LockedDemo from './LockedDemo';
import type { Level } from '@/lib/api';

export const DEMO_LOCKED = true;

export default function SafeTryDemo({ level }: { level: Level }) {
  return (
    <IslandBoundary name="SafeTryDemo">
      {DEMO_LOCKED ? <LockedDemo level={level} /> : <TryDemo level={level} />}
    </IslandBoundary>
  );
}
