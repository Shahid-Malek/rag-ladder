import { Component, type ErrorInfo, type ReactNode } from 'react';
import ErrorNotice from './ErrorNotice';
export default class IslandBoundary extends Component<
  { children: ReactNode; name: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[IslandBoundary] ${this.props.name} failed: ${error?.name}: ${error?.message}\n${error?.stack}`,
      info.componentStack,
    );
  }
  render() {
    return this.state.failed ? (
      <ErrorNotice>
        <a className="pill pill-secondary mt-4" href="" data-astro-reload>
          Reload to retry
        </a>
      </ErrorNotice>
    ) : (
      this.props.children
    );
  }
}
