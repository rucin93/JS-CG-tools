import { SlowPack } from "../models/SlowPack"
import { PackerOptions } from "../types"

// Define message types for worker communication
interface WorkerInitMessage {
  type: "init"
  input: string
  options: PackerOptions
}

// Listen for messages from the main thread
self.onmessage = (event: MessageEvent) => {
  try {
    if (event.data.type === "init") {
      const { input, options } = event.data as WorkerInitMessage

      // Send an immediate acknowledgment
      self.postMessage({
        type: "progress",
        progress: {
          progress: 0.01,
          stage: "initialization",
          message: "Worker received input, starting analysis...",
          details: `Input length: ${input.length} characters`,
        },
      })

      const slowPack = new SlowPack()
      
      // Add progress callback to options
      const packerOptions: PackerOptions = {
        ...options,
        onProgress: (progressInfo) => {
          self.postMessage({
            type: "progress",
            progress: progressInfo,
          })
        }
      }

      const result = slowPack.runPacker(input, packerOptions)

      // Send the result back to the main thread
      self.postMessage({
        type: "result",
        data: result,
        searchGraph: slowPack.getSearchGraph()
      })
    }
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

