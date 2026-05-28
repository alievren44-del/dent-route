import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — React render hatalarını yakalar, beyaz ekran yerine
 * okunabilir mesaj + reload butonu gösterir.
 *
 * App'in tamamını sarmamak gerekir (sadece route içerikleri); login akışı
 * dışarıda kalmalı.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Debug overlay yakalasın diye console.error fırlat
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const msg = this.state.error?.message ?? 'Bilinmeyen hata';
    const stack = this.state.error?.stack ?? '';

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-amber-50 p-6">
        <div className="max-w-md rounded-xl border border-amber-300 bg-white p-5 shadow-md">
          <h1 className="mb-2 text-lg font-semibold text-red-700">Bir şey ters gitti</h1>
          <p className="mb-3 text-sm text-slate-700">
            Bu sayfa render edilemedi. Aşağıdaki hata bilgisini geliştiriciye gönder.
          </p>
          <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-[11px] text-slate-800">
            {msg}
            {'\n\n'}
            {stack.slice(0, 800)}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Geri
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Yenile
            </button>
          </div>
        </div>
      </div>
    );
  }
}
