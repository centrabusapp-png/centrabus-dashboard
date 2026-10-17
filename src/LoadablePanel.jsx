import { Component, lazy, Suspense, useMemo, useState } from 'react';

class PanelLoadBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="rounded-2xl bg-white p-6 text-center text-slate-700" role="alert">
          <p>Unable to load this view. Check your connection and try again.</p>
          <button type="button" className="mt-3 rounded-lg bg-[#8E1F2F] px-4 py-2 font-bold text-white" onClick={this.props.onRetry}>Retry loading</button>
        </section>
      );
    }
    return this.props.children;
  }
}

// Module imports are cached by the browser. Only download a view when needed;
// never cache authorization, GPS responses or timestamps in this loader.
export default function LoadablePanel({ load, loadingLabel, ...viewProps }) {
  const [attempt, setAttempt] = useState(0);
  const lazyView = useMemo(() => ({ attempt, View: lazy(load) }), [load, attempt]);
  const View = lazyView.View;
  return (
    <PanelLoadBoundary key={lazyView.attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Suspense fallback={
        <section className="grid min-h-[160px] place-items-center bg-[#F7F8FA] p-6 text-slate-700" role="status" aria-live="polite">
          <div>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[#E9C3C8] border-t-[#8E1F2F]" />
            <p className="mt-3 text-sm font-bold">{loadingLabel}</p>
          </div>
        </section>
      }>
        <View {...viewProps} />
      </Suspense>
    </PanelLoadBoundary>
  );
}
