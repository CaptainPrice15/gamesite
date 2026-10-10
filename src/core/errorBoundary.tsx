import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureError } from '../lib/monitoring'

interface Props {
  children: ReactNode
  label?: string
  onReset?: () => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[arcade] crashed:', error, info.componentStack)
    captureError(error, { label: this.props.label ?? 'page', stack: info.componentStack })
  }

  private reset = (): void => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fallback" role="alert">
          <h2>{this.props.label ?? 'Something'} crashed</h2>
          <p className="muted">{this.state.error.message}</p>
          <div className="row gap">
            <button className="btn" onClick={this.reset}>
              Try again
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              Back to arcade
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
