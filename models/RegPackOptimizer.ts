import { RegPack } from "./RegPack"
import type { PackerOptions } from "../types"

export interface OptimizationResult {
  bestOptions: PackerOptions
  bestSize: number
  bestOutput: string
  bestDetails: string
  allResults: Array<{
    options: PackerOptions
    size: number
  }>
  progress: number
  totalCombinations: number
}

export class RegPackOptimizer {
  private regPack: RegPack
  private input: string
  private onProgress?: (result: OptimizationResult) => void
  private bestResult: OptimizationResult
  private abortController: AbortController

  constructor(input: string, onProgress?: (result: OptimizationResult) => void) {
    this.regPack = new RegPack()
    this.input = input
    this.onProgress = onProgress
    this.abortController = new AbortController()

    // Initialize with default values
    this.bestResult = {
      bestOptions: {
        crushGainFactor: 2,
        crushLengthFactor: 1,
        crushCopiesFactor: 0,
        crushTiebreakerFactor: 1,
        useES6: true,
      },
      bestSize: Number.POSITIVE_INFINITY,
      bestOutput: "",
      bestDetails: "",
      allResults: [],
      progress: 0,
      totalCombinations: 0,
    }
  }

  public abort(): void {
    this.abortController.abort()
  }

  public async findBestOptions(): Promise<OptimizationResult> {
    // Define the ranges for each parameter
    const gainFactors = [0, 0.5, 1, 1.5, 2, 2.5, 3]
    const lengthFactors = [0, 0.5, 1, 1.5, 2, 2.5, 3]
    const copiesFactors = [0, 0.5, 1, 1.5, 2, 2.5, 3]
    const tiebreakerFactors = [0, 1, 2]
    const es6Options = [true, false]

    const totalCombinations =
      gainFactors.length * lengthFactors.length * copiesFactors.length * tiebreakerFactors.length * es6Options.length

    this.bestResult.totalCombinations = totalCombinations
    let processedCombinations = 0

    try {
      for (const crushGainFactor of gainFactors) {
        for (const crushLengthFactor of lengthFactors) {
          for (const crushCopiesFactor of copiesFactors) {
            for (const crushTiebreakerFactor of tiebreakerFactors) {
              for (const useES6 of es6Options) {
                // Check if optimization was aborted
                if (this.abortController.signal.aborted) {
                  throw new Error("Optimization aborted")
                }

                const options: PackerOptions = {
                  crushGainFactor,
                  crushLengthFactor,
                  crushCopiesFactor,
                  crushTiebreakerFactor,
                  useES6,
                }

                // Run the packer with these options
                const result = this.regPack.runPacker(this.input, options)

                // Get the size of the packed code
                let size = Number.POSITIVE_INFINITY
                let output = ""
                let details = ""

                if (result && result.length > 0 && result[0].result) {
                  // Prefer the second result (regexp version) if available
                  if (result[0].result.length >= 2 && result[0].result[1]) {
                    size = result[0].result[1].length
                    output = result[0].result[1].output || ""
                    details = result[0].result[1].details || ""
                  } else if (result[0].result.length >= 1 && result[0].result[0]) {
                    size = result[0].result[0].length
                    output = result[0].result[0].output || ""
                    details = result[0].result[0].details || ""
                  }
                }

                // Record this result
                this.bestResult.allResults.push({
                  options: { ...options },
                  size,
                })

                // Update best result if this is better
                if (size < this.bestResult.bestSize) {
                  this.bestResult.bestSize = size
                  this.bestResult.bestOptions = { ...options }
                  this.bestResult.bestOutput = output
                  this.bestResult.bestDetails = details
                }

                // Update progress
                processedCombinations++
                this.bestResult.progress = processedCombinations / totalCombinations

                // Call progress callback
                if (this.onProgress) {
                  this.onProgress({ ...this.bestResult })
                }

                // Add a small delay to allow UI updates
                await new Promise((resolve) => setTimeout(resolve, 0))
              }
            }
          }
        }
      }

      return this.bestResult
    } catch (error) {
      console.error("Optimization error:", error)
      throw error
    }
  }
}
