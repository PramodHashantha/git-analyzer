import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'

// Polyfill ResizeObserver for Recharts testing
declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver
  }
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverPolyfill as any
}
