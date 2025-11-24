import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult, Match } from "../types"

// Add this interface to the top of the file
interface SearchGraphData {
  nodes: Array<{
    id: string
    text: string
    replacements: string[]
    size: number
    depth: number
    totalGain?: number
    isBestSolution?: boolean
    inBeam?: boolean // Added to track if node is in the beam
    beamRank?: number // Added to track node's rank in the beam
  }>
  edges: Array<{
    source: string
    target: string
    pattern: string
    gain: number
  }>
  maxDepth: number
  bestPath: string[]
}

/**
 * Replacer - A minimal JavaScript packer that uses digit-based token replacement
 *
 * This packer works by replacing common substrings with digits 0-9, then using a minimal
 * decoder: `.replace(/\d/g,i=>array[i])` to restore the original string.
 *
 * Limitations:
 * - Only works for strings that don't contain Arabic numerals (0-9)
 * - Limited to 10 replacements (digits 0-9)
 * - Best for strings with many repeated substrings
 */
export class Replacer {
  private stringHelper: StringHelper
  private maxReplacements = 10 // Limited to digits 0-9
  private worker: Worker | null = null

  constructor(maxInt = 10) {
    this.stringHelper = StringHelper.getInstance()
    this.maxReplacements = Math.min(Math.max(1, maxInt), 100) // Clamp between 1 and 100
  }

  /**
   * Main entry point for Replacer
   * @param input A string containing the program to pack
   * @param options An object detailing the different options for the preprocessor and packer
   * @return An array of PackerData, each containing the code packed with different settings
   */
  public runPacker(input: string, options: PackerOptions): PackerData[] {
    try {
      const inputData = new PackerData("Replacer", input)

      // Check if input contains digits
      if (/[0-9]/.test(input)) {
        throw new Error("Input contains digits (0-9) which are used as tokens by Replacer")
      }

      // Compress the input
      const output = options.useBranchSearch
        ? this.compressWithWorker(inputData, {
            ...options,
            waitingForTrigger: options.waitingForTrigger,
            onProgress: options.onProgress,
          })
        : this.compressWithDigitReplacements(inputData, options)

      inputData.result.push(output)

      return [inputData]
    } catch (error) {
      console.error("Error in Replacer:", error)
      const errorData = new PackerData("Error", input)
      const errorResult: PackerResult = {
        length: 0,
        output: "",
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        transform: [],
      }
      errorData.result.push(errorResult)
      return [errorData]
    }
  }

  /**
   * Terminate any running worker
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * Returns the total byte length of a string
   */
  private getByteLength(inString: string): number {
    return encodeURI(inString).replace(/%../g, "i").length
  }

  /**
   * Find all patterns in the string that could be replaced
   * Include all patterns that appear at least twice, even if they don't have positive gain
   */
  private findAllPatterns(s: string): Match[] {
    const patterns: Match[] = []
    const matches: Record<string, number> = {}

    // First pass: find all substrings that appear at least twice
    // Start with longer patterns for better compression
    for (let length = Math.min(100, Math.floor(s.length / 2)); length >= 2; length--) {
      for (let i = 0; i <= s.length - length; i++) {
        const pattern = s.substring(i, i + length)

        // Skip if already processed or if pattern contains digits
        const digitRegex = this.maxReplacements <= 10 ? /[0-9]/ : /\d/
        if (matches[pattern] !== undefined || digitRegex.test(pattern)) continue

        // Count occurrences
        let count = 0
        let pos = -1
        while ((pos = s.indexOf(pattern, pos + 1)) !== -1) {
          count++
        }

        if (count >= 2) {
          matches[pattern] = count

          // Calculate raw gain (length * copies)
          const rawGain = pattern.length * count

          // Calculate net gain (accounting for decoder overhead)
          const netGain = (pattern.length - 1) * count - pattern.length - 1

          // Add all patterns with at least 2 occurrences
          // This ensures we have enough patterns to make 10 replacements
          patterns.push({
            token: "",
            string: pattern,
            originalString: pattern,
            depends: "",
            usedBy: "",
            gain: netGain,
            copies: count,
            len: pattern.length,
            score: rawGain, // Use raw gain as score
            cleared: false,
            newOrder: 9999,
          })
        }
      }
    }

    return patterns
  }

  /**
   * Improved compression method that uses beam search to find optimal replacements
   * This algorithm explores multiple promising paths to find a better global solution
   */
  private compressWithDigitReplacements(packerData: PackerData, options: PackerOptions): PackerResult {
    let s = packerData.contents
    packerData.matchesLookup = []
    let details = ""

    // Find all patterns with their gain
    const initialPatterns = this.findAllPatterns(s)

    // Beam search parameters
    const beamWidth = options.beamWidth || 5 // Use provided beam width or default to 5
    const maxDepth = this.maxReplacements // Maximum depth of search

    // State representation
    interface State {
      text: string
      replacements: string[]
      patterns: Match[]
      totalGain: number
      score: number // Heuristic score for beam search
    }

    // Initialize beam with the starting state
    let beam: State[] = [
      {
        text: s,
        replacements: [],
        patterns: [...initialPatterns],
        totalGain: 0,
        score: 0,
      },
    ]

    // Keep track of the best solution found so far
    let bestSolution: State = beam[0]

    // Perform beam search
    for (let depth = 0; depth < maxDepth; depth++) {
      // Generate all possible next states from current beam
      const candidates: State[] = []

      for (const state of beam) {
        // Skip if we've already used all maxReplacements or no patterns remain
        if (state.replacements.length >= this.maxReplacements || state.patterns.length === 0) {
          candidates.push(state) // Keep this state as a candidate
          continue
        }

        // Update pattern statistics for current state
        this.updatePatternStats(state.patterns, state.text)

        // Sort patterns by gain (highest first)
        state.patterns.sort((a, b) => b.gain - a.gain)

        // Skip if no patterns with positive gain
        if (state.patterns.length === 0 || state.patterns[0].gain <= 0) {
          candidates.push(state) // Keep this state as a candidate
          continue
        }

        // Try the top N patterns as potential next steps
        const patternsToTry = Math.min(5, state.patterns.length)

        for (let i = 0; i < patternsToTry; i++) {
          const pattern = state.patterns[i]

          // Skip if pattern has no gain
          if (pattern.gain <= 0) continue

          // Apply this replacement
          const digit = state.replacements.length.toString()
          const newText = this.stringHelper.matchAndReplaceAll(state.text, false, pattern.string, digit, "", "", 0, [])

          // Create a deep copy of remaining patterns
          const remainingPatterns = JSON.parse(
            JSON.stringify(
              state.patterns.filter(
                (p) =>
                  !p.string.includes(digit) && !p.string.includes(pattern.string) && !pattern.string.includes(p.string),
              ),
            ),
          )

          // Calculate new total gain
          const newGain = state.totalGain + pattern.gain

          // Calculate score for beam search
          // Use a combination of current gain and potential future gain
          const potentialFutureGain = this.estimateFutureGain(remainingPatterns, newText)
          const score = newGain + potentialFutureGain * 0.5 // Weight future gain less

          // Create new state
          const newState: State = {
            text: newText,
            replacements: [...state.replacements, pattern.string],
            patterns: remainingPatterns,
            totalGain: newGain,
            score: score,
          }

          candidates.push(newState)
        }

        // Also consider not making any more replacements
        candidates.push(state)
      }

      // If no candidates were generated, we're done
      if (candidates.length === 0) break

      // Sort candidates by score and keep only the top beamWidth
      candidates.sort((a, b) => b.score - a.score)
      beam = candidates.slice(0, beamWidth)

      // Update best solution if we found a better one
      const currentBest = beam[0]
      if (currentBest.totalGain > bestSolution.totalGain) {
        bestSolution = currentBest
      }

      // If the best state has no more patterns with positive gain, we can stop
      if (beam[0].patterns.length === 0 || (beam[0].patterns.length > 0 && beam[0].patterns[0].gain <= 0)) {
        break
      }
    }

    // Use the best solution found
    s = bestSolution.text
    const replacements = bestSolution.replacements
    const totalGain = bestSolution.totalGain

    // Add to matchesLookup for visualization
    for (let i = 0; i < replacements.length; i++) {
      const pattern = replacements[i]

      const token = i.toString()

      // Count occurrences in the final text
      let count = 0
      for (let j = 0; j < s.length; j++) {
        if (s.substring(j, j + token.length) === token) {
          count++
        }
      }

      // Calculate gain for this pattern
      const patternGain = (pattern.length - 1) * count - pattern.length - 1

      packerData.matchesLookup.push({
        token: token,
        string: pattern,
        originalString: pattern,
        depends: "",
        usedBy: "",
        gain: patternGain,
        copies: count,
        len: pattern.length,
        score: pattern.length * count, // Raw gain as score
        cleared: false,
        newOrder: i,
      })

      details += `${i} : gain=${patternGain}, copies=${count}, length=${pattern.length}, str = ${pattern}\n`
    }

    const decoderArray = `\`${replacements.join("|")}\`.split\`|\``
    const decoderPattern = this.maxReplacements <= 10 ? "\\d" : "\\d+"
    const decoder = `.replace(/${decoderPattern}/g,i=>${decoderArray}[i])`

    // Create the final packed output
    const packedOutput = `\`${s}\`${decoder}`

    // Update the details section to include more information
    details += `\n------------------------\n`
    details += `Original size: ${packerData.contents.length} bytes\n`
    details += `Compressed size: ${s.length} bytes\n`
    details += `Decoder size: ${decoder.length} bytes\n`
    details += `Total size: ${packedOutput.length} bytes\n`
    details += `Total gain: ${totalGain} bytes\n`
    details += `Replacements used: ${replacements.length} of ${this.maxReplacements} possible\n`
    details += `Compression ratio: ${((packedOutput.length / packerData.contents.length) * 100).toFixed(2)}%\n`
    details += `Algorithm: Beam Search (width=${beamWidth})\n`

    // Verify the unpacking works correctly
    details += this.verifyUnpacking(packerData.contents, s, replacements)

    return {
      length: this.getByteLength(packedOutput),
      output: packedOutput,
      details,
      transform: [],
    }
  }

  /**
   * Estimate potential future gain from remaining patterns
   * This is a heuristic for beam search to evaluate states
   */
  private estimateFutureGain(patterns: Match[], text: string): number {
    // Make a copy and update stats
    const patternsCopy = JSON.parse(JSON.stringify(patterns))
    this.updatePatternStats(patternsCopy, text)

    // Sort by gain
    patternsCopy.sort((a, b) => b.gain - a.gain)

    // Estimate future gain by summing the top patterns' gains
    // with diminishing returns for each subsequent pattern
    let estimatedGain = 0
    const maxPatternsToConsider = Math.min(this.maxReplacements, patternsCopy.length)

    for (let i = 0; i < maxPatternsToConsider; i++) {
      if (patternsCopy[i].gain <= 0) break

      // Apply diminishing weight to each subsequent pattern
      // since we can't be sure we'll be able to use all of them
      const weight = Math.pow(0.8, i)
      estimatedGain += patternsCopy[i].gain * weight
    }

    return estimatedGain
  }

  /**
   * Update pattern statistics (occurrences and gain) based on current text
   * Improved to handle overlapping patterns more accurately
   */
  private updatePatternStats(patterns: Match[], text: string): void {
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i]

      // Count non-overlapping occurrences in current text
      let count = 0
      let pos = 0

      while ((pos = text.indexOf(pattern.string, pos)) !== -1) {
        count++
        pos += pattern.string.length // Move past this occurrence to avoid overlaps
      }

      // Also count overlapping occurrences with a small weight
      let overlapCount = 0
      pos = 0
      while ((pos = text.indexOf(pattern.string, pos + 1)) !== -1) {
        overlapCount++
      }

      // Adjust count to include some overlapping occurrences
      // but with diminished value
      const adjustedCount = count + (overlapCount - count) * 0.3

      // Update pattern data
      pattern.copies = Math.max(count, 1) // Ensure at least 1 copy

      // Calculate gain: (length-1)*copies - length - 1
      // This accounts for the replacement token (1 byte) and the overhead of storing the pattern
      pattern.gain = (pattern.len - 1) * adjustedCount - pattern.len - 1
      pattern.score = pattern.len * adjustedCount // Raw gain as score
    }

    // Remove patterns with fewer than 2 occurrences or negative gain
    for (let i = patterns.length - 1; i >= 0; i--) {
      if (patterns[i].copies < 2 || patterns[i].gain <= 0) {
        patterns.splice(i, 1)
      }
    }
  }

  /**
   * Compress using a Web Worker to run the branch search
   */
  private compressWithWorker(packerData: PackerData, options: PackerOptions): PackerResult {
    // If this is just a check without actually running the compression
    if (options.waitingForTrigger) {
      return {
        length: 0,
        output: "",
        details: "Maximum gain search is ready. Click 'Run Branch Search Compression' to start.",
        transform: [],
      }
    }

    // Create a placeholder result that will be updated when the worker completes
    const placeholderResult: PackerResult = {
      length: 0,
      output: "",
      details: "Maximum gain search is running in a Web Worker...",
      transform: [],
      isRunning: true, // Custom property to indicate the worker is running
    }

    // Terminate any existing worker
    this.terminate()

    try {
      // Create a worker from the branch-search.worker.ts file
      this.worker = new Worker(new URL("../workers/branch-search.worker.ts", import.meta.url))

      // Set up message handling
      this.worker.onmessage = (event) => {
        const message = event.data

        if (message.type === "progress" && options.onProgress) {
          // Forward progress updates
          options.onProgress(message.progress)
        } else if (message.type === "result") {
          // Process the final result
          const { text, replacements, size, totalGain, nodesExplored, timeTaken, matchesLookup, searchGraph } = message

          // Update the packer data with the results
          packerData.matchesLookup = matchesLookup || []

          // Store the search graph data for visualization
          if (searchGraph) {
            console.log("Received search graph with", searchGraph.nodes.length, "nodes and", searchGraph.edges.length)
            packerData.searchGraph = searchGraph
          }

          // Generate the decoder
          const decoderArray = replacements.length > 0 ? `\`${replacements.join("|")}\`.split\`|\`` : "[]"
          const decoder = replacements.length > 0 ? `.replace(/\\d/g,i=>${decoderArray}[i])` : ""

          // Build details string
          let details = ""
          for (let i = 0; i < replacements.length; i++) {
            const pattern = replacements[i]
            const match = matchesLookup?.find((m) => m.token === i.toString())
            if (match) {
              details += `${i} : str = ${pattern}, occurrences = ${match.copies}, raw gain = ${pattern.length * match.copies}, gain = ${match.gain}\n`
            }
          }

          details += `\n------------------------\n`
          details += `Maximum gain search statistics:\n`
          details += `Patterns analyzed: ${nodesExplored?.toLocaleString() || 0}\n`
          details += `Time taken: ${((timeTaken || 0) / 1000).toFixed(2)} seconds\n\n`

          details += `Original size: ${packerData.contents.length} bytes\n`
          details += `Compressed size: ${text?.length || 0} bytes\n`
          details += `Decoder size: ${decoder.length} bytes\n`
          const packedOutput = replacements.length > 0 ? `\`${text}\`${decoder}` : text || ""
          details += `Total size: ${packedOutput.length} bytes\n`
          details += `Total gain: ${totalGain || 0} bytes\n`
          details += `Replacements used: ${replacements?.length || 0} of ${this.maxReplacements} possible\n`
          details += `Compression ratio: ${((packedOutput.length / packerData.contents.length) * 100).toFixed(2)}%\n`
          details += `Search graph: ${packerData.searchGraph ? `${packerData.searchGraph.nodes.length} nodes, ${packerData.searchGraph.edges.length} edges` : "Not available"}\n`
          details += `Algorithm: Beam Search (width=${options.beamWidth || 5})\n`

          // Verify the unpacking works correctly
          details += this.verifyUnpacking(packerData.contents, text || "", replacements || [])

          // Update the placeholder result with the actual result
          placeholderResult.length = this.getByteLength(packedOutput)
          placeholderResult.output = packedOutput
          placeholderResult.details = details
          placeholderResult.isRunning = false

          // Clean up the worker
          this.terminate()

          // Notify that the result is ready
          if (options.onComplete) {
            options.onComplete(placeholderResult)
          }
        } else if (message.type === "error") {
          console.error("Worker error:", message.error)
          placeholderResult.details = `Error in Web Worker: ${message.error}`
          placeholderResult.isRunning = false

          // Clean up the worker
          this.terminate()

          // Notify that the result is ready
          if (options.onComplete) {
            options.onComplete(placeholderResult)
          }
        }
      }

      // Handle worker errors
      this.worker.onerror = (error) => {
        console.error("Worker error:", error)
        placeholderResult.details = `Error in Web Worker: ${error.message || "Unknown error"}`
        placeholderResult.isRunning = false

        // Clean up the worker
        this.terminate()

        // Notify that the result is ready
        if (options.onComplete) {
          options.onComplete(placeholderResult)
        }
      }

      // Start the worker with search options
      this.worker.postMessage({
        type: "init",
        input: packerData.contents,
        options: {
          maxStates: options.maxStates || 500000, // Significantly increased for maximum gain search
          timeLimit: options.timeLimit || 600000, // 10 minutes
          beamWidth: options.beamWidth || 5, // Pass beam width to worker
        },
      })
    } catch (error) {
      console.error("Error creating worker:", error)
      placeholderResult.details = `Error creating Web Worker: ${error instanceof Error ? error.message : String(error)}`
      placeholderResult.isRunning = false

      if (options.onComplete) {
        options.onComplete(placeholderResult)
      }
    }

    return placeholderResult
  }

  /**
   * Verify unpacking works correctly
   */
  private verifyUnpacking(original: string, compressed: string, replacements: string[]): string {
    let details = "Verification: "

    // Simulate the unpacking process
    let unpacked = compressed
    for (let i = 0; i < this.maxReplacements && i < replacements.length; i++) {
      const regex = new RegExp(i.toString().replace(/\d/g, "\\d"), "g")
      unpacked = unpacked.replace(regex, replacements[i])
    }

    const success = unpacked === original
    details += (success ? "passed" : "failed") + ".\n"

    return details
  }
}
