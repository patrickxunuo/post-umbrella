import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback" data-testid="error-boundary-fallback">
          <div className="error-boundary-card">
            <AlertTriangle size={48} className="error-boundary-icon" />
            <h1 className="error-boundary-heading">Something went wrong</h1>
            <p className="error-boundary-message">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              className="error-boundary-reload"
              data-testid="error-boundary-reload"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
