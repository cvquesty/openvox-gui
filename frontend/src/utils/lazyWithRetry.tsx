import { lazy, ComponentType, LazyExoticComponent } from 'react';
import { isChunkLoadError, handleChunkLoadError } from './versionCheck';

// Wrapper for React.lazy that handles chunk loading errors
export function lazyWithRetry<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() =>
    importFunc().catch(error => {
      // Check if this is a chunk loading error (usually from deployment)
      if (isChunkLoadError(error)) {
        // Show notification to user
        handleChunkLoadError();
        
        // Return a placeholder component that shows the reload message
        return {
          default: (() => {
            return (
              <div style={{ 
                padding: '2rem', 
                textAlign: 'center',
                marginTop: '4rem' 
              }}>
                <h3>Application Updated</h3>
                <p>A new version is available. Please refresh the page to continue.</p>
                <button 
                  onClick={() => window.location.reload()}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '1rem',
                    background: '#228be6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Refresh Page
                </button>
              </div>
            );
          }) as T
        };
      }
      
      // For other errors, re-throw
      throw error;
    })
  );
}