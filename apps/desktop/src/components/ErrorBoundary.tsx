import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";

interface Props {
  children: ReactNode;
  /** Changing this value clears a previous error (e.g. the current page). */
  resetKey?: unknown;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-card border border-line bg-surface px-6 py-8">
        <h2 className="text-subtitle text-ink">Something went wrong on this page</h2>
        <p className="mt-1.5 max-w-[60ch] text-body text-muted">{this.state.error.message || "An unexpected error occurred."}</p>
        <div className="mt-5">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      </div>
    );
  }
}
