// Initialize RegPack configuration and global settings

// Default configuration values
export const DEFAULT_CONFIG = {
  beamWidth: 5,
  maxPatterns: 100,
  lookAheadDepth: 2,
  enabledOptimizations: true,
  compressionLevel: "medium", // 'low', 'medium', 'high'
  useWorkers: true,
  debugMode: false,
}

// Initialize the application
export function initRegPack() {
  // Check if we're running in the browser
  if (typeof window !== "undefined") {
    // Set up global configuration
    window.REGPACK_CONFIG = window.REGPACK_CONFIG || DEFAULT_CONFIG

    // Initialize web workers if enabled
    if (window.REGPACK_CONFIG.useWorkers) {
      preloadWorkers()
    }

    // Log initialization
    if (window.REGPACK_CONFIG.debugMode) {
      console.log("RegPack initialized with config:", window.REGPACK_CONFIG)
    }
  }

  return DEFAULT_CONFIG
}

// Preload web workers to improve performance
function preloadWorkers() {
  try {
    // Create a worker but don't use it yet - just to have it ready
    const worker = new Worker(new URL("../workers/branch-search.worker.ts", import.meta.url))

    // Send a simple message to initialize the worker
    worker.postMessage({ type: "INIT" })

    // Store the worker for later use
    if (typeof window !== "undefined") {
      window._regpackWorkers = window._regpackWorkers || []
      window._regpackWorkers.push(worker)
    }
  } catch (error) {
    console.error("Failed to preload workers:", error)
  }
}

// Add TypeScript declarations for global variables
declare global {
  interface Window {
    REGPACK_CONFIG: typeof DEFAULT_CONFIG
    _regpackWorkers?: Worker[]
  }
}

export default initRegPack
