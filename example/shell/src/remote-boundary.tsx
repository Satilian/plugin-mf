import { Component, Suspense, type ReactNode } from "react";
import { getRemote } from "plugin-mf/client";

type Props = { name: string; children: ReactNode; onRetry?: () => void };
type State = { failed: boolean };

class RemoteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <div role="alert">
        <p>{this.props.name} недоступен.</p>
        <button onClick={() => {
          this.props.onRetry?.();
          this.setState({ failed: false });
        }}>Повторить загрузку</button>
      </div>;
    }
    return this.props.children;
  }
}

export function RemoteBoundary({ name, children }: Props): ReactNode {
  const retry = () => {
    const [remote, ...expose] = name.split("/");
    getRemote(remote).retry(expose.join("/"));
  };
  return <RemoteErrorBoundary name={name} onRetry={retry}>
    <Suspense fallback={<div role="status">Загрузка {name}…</div>}>
      {children}
    </Suspense>
  </RemoteErrorBoundary>;
}
