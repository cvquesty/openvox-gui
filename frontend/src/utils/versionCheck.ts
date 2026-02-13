import { notifications } from '@mantine/notifications';

// Store the current version from build time
const BUILD_VERSION = import.meta.env.VITE_BUILD_VERSION || Date.now().toString();

// Check if error is due to module loading failure (usually after deployment)
export function isChunkLoadError(error: any): boolean {
  return (
    error?.message?.includes('Failed to fetch dynamically imported module') ||
    error?.message?.includes('Failed to import') ||
    error?.message?.includes('Loading chunk') ||
    error?.message?.includes('Loading CSS chunk') ||
    error?.name === 'ChunkLoadError'
  );
}

// Function to handle chunk load errors
export function handleChunkLoadError(): void {
  notifications.show({
    id: 'version-update',
    title: 'Application Updated',
    message: 'A new version is available. Please refresh the page to continue.',
    color: 'blue',
    autoClose: false,
    withCloseButton: false,
    onClose: () => window.location.reload(),
  });
}

// Version checker that periodically checks for updates
class VersionChecker {
  private checkInterval: number = 5 * 60 * 1000; // 5 minutes
  private intervalId: NodeJS.Timeout | null = null;
  private currentVersion: string = BUILD_VERSION;
  
  start() {
    // Don't start if already running
    if (this.intervalId) return;
    
    // Check immediately on start
    this.checkVersion();
    
    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkVersion();
    }, this.checkInterval);
  }
  
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  private async checkVersion() {
    try {
      // Fetch the main index.html to check for version changes
      const response = await fetch('/index.html', {
        method: 'HEAD',
        cache: 'no-cache',
      });
      
      // Check the etag or last-modified header
      const etag = response.headers.get('etag');
      const lastModified = response.headers.get('last-modified');
      const versionIndicator = etag || lastModified || '';
      
      // Store the initial version indicator
      if (!window.sessionStorage.getItem('app-version')) {
        window.sessionStorage.setItem('app-version', versionIndicator);
        return;
      }
      
      // Check if version has changed
      const storedVersion = window.sessionStorage.getItem('app-version');
      if (storedVersion && storedVersion !== versionIndicator && versionIndicator) {
        // Version has changed, notify user
        notifications.show({
          id: 'version-update-check',
          title: 'Update Available',
          message: 'A new version of the application is available. Refresh to get the latest features.',
          color: 'blue',
          autoClose: false,
          withCloseButton: true,
        });
        
        // Update stored version
        window.sessionStorage.setItem('app-version', versionIndicator);
        
        // Stop checking after detecting an update
        this.stop();
      }
    } catch (error) {
      // Silently fail - version checking is not critical
      console.debug('Version check failed:', error);
    }
  }
}

export const versionChecker = new VersionChecker();