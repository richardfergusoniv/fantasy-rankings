import { Component, type ReactNode } from "react";
import { SectionError } from "./dashboard-shared";

type FeatureErrorBoundaryProps = {
  children: ReactNode;
  /** Short title shown in the fallback, e.g. "This section didn’t load." */
  title: string;
  /** Extra retry action (e.g. refetch) run before the children remount. */
  onRetry?: () => void;
  /** When any key changes, a recorded crash is cleared — use the active tab so
   * navigating away and back remounts a crashed view. */
  resetKeys?: readonly unknown[];
};

/**
 * Feature-scoped error boundary: a render crash inside one view leaves the
 * shell (navigation, league picker, refresh) mounted so the user can switch
 * tabs or retry the section instead of losing the whole app. Also catches
 * lazy-chunk load failures.
 */
export class FeatureErrorBoundary extends Component<FeatureErrorBoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error("[error-boundary]", this.props.title, error);
  }

  override componentDidUpdate(prevProps: FeatureErrorBoundaryProps): void {
    if (!this.state.error) return;
    const prev = prevProps.resetKeys ?? [];
    const next = this.props.resetKeys ?? [];
    if (prev.length !== next.length || next.some((key, index) => key !== prev[index])) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <SectionError
          title={this.props.title}
          onRetry={() => {
            this.props.onRetry?.();
            this.setState({ error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}
