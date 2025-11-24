import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult } from "../types"

/**
 * Enum defining different heuristic strategies for pattern selection
 */
export enum CrusherHeuristic {
  BALANCED = "balanced", // Default balanced approach
  MOST_COPIES = "mostCopies", // Prioritize patterns with most repetitions
  LONGEST = "longest", // Prioritize longest patterns
  DENSITY = "density", // Prioritize patterns with highest density (copies * length)
  ADAPTIVE = "adaptive", // Dynamically choose the best heuristic at each step
  ADAPTIVE_GAIN = "adaptiveGain", // New strategy that prioritizes patterns with highest gain (copies * length)
}

/**
 * Crusher - An enhanced JavaScript packer with better compression rates
 * This implementation builds on RegPack's approach with several optimizations:
 * 1. Multi-pass compression with context-aware pattern selection
 * 2. Advanced token allocation strategy
 * 3. Improved pattern scoring with entropy analysis
 * 4. Recursive pattern detection for nested patterns
 * 5. Adaptive dictionary compression
 */
export class Crusher {
  private stringHelper: StringHelper
  private maxIterations = 100
  private safetyCounter = 0
  private maxSafetyCount = 10000
  private tokenIndex = 0

  // Add this property to the Crusher class
  private heuristic: CrusherHeuristic = CrusherHeuristic.BALANCED

  constructor(heuristic: CrusherHeuristic = CrusherHeuristic.BALANCED) {
    this.stringHelper = StringHelper.getInstance()
    this.heuristic = heuristic
  }

  /**
   * Main entry point for Crusher
   * @param input A string containing the program to pack
   * @param options An object detailing the different options for the preprocessor and packer
   * @param heuristic The heuristic strategy to use for pattern selection
   * @return An array of PackerData, each containing the code packed with different settings
   */
  public runPacker(input: string, options: PackerOptions, heuristic?: CrusherHeuristic): PackerData[] {
    if (heuristic) {
      this.heuristic = heuristic
    }

    try {
      const inputData = new PackerData("Crusher", input)

      // First stage: enhanced pattern detection and compression
      const output = this.compressWithPatterns(inputData, options)
      inputData.result.push(output)

      // Second stage: optimize token usage and convert to regexp
      const output2 = this.optimizeAndPackToRegexp(inputData, options)
      inputData.result.push(output2)

      return [inputData]
    } catch (error) {
      console.error("Error in Crusher:", error)
      const errorData = new PackerData("Error", input)
      const errorResult: PackerResult = {
        length: 0,
        output: "",
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }
      errorData.result.push(errorResult)
      errorData.result.push(errorResult)
      return [errorData]
    }
  }

  /**
   * Find the best heuristic strategy for a given input
   * @param input The input string to compress
   * @param options The packer options to use
   * @returns The best heuristic strategy and its result
   */
  public static async findBestHeuristic(
    input: string,
    options: PackerOptions,
  ): Promise<{
    heuristic: CrusherHeuristic
    size: number
    output: string
    details: string
  }> {
    const heuristics = [
      CrusherHeuristic.BALANCED,
      CrusherHeuristic.MOST_COPIES,
      CrusherHeuristic.LONGEST,
      CrusherHeuristic.DENSITY,
      CrusherHeuristic.ADAPTIVE, // Add the adaptive approach to the list
    ]

    let bestHeuristic = CrusherHeuristic.BALANCED
    let bestSize = Number.POSITIVE_INFINITY
    let bestOutput = ""
    let bestDetails = ""

    // Try each heuristic
    for (const heuristic of heuristics) {
      const crusher = new Crusher(heuristic)
      const result = crusher.runPacker(input, options)

      if (result && result.length > 0 && result[0].result) {
        // Get the size of the packed code
        let size = Number.POSITIVE_INFINITY
        let output = ""
        let details = ""

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

        // Update best result if this is better
        if (size < bestSize) {
          bestSize = size
          bestHeuristic = heuristic
          bestOutput = output
          bestDetails = details
        }

        // Add a small delay to allow UI updates
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    return {
      heuristic: bestHeuristic,
      size: bestSize,
      output: bestOutput,
      details: bestDetails,
    }
  }

  /**
   * Returns the total byte length of a string "as is" (with no further escaping)
   */
  private getByteLength(inString: string): number {
    return encodeURI(inString).replace(/%../g, "i").length
  }

  /**
   * Returns the byte length of a string after escaping
   */
  private getEscapedByteLength(inString: string): number {
    return this.getByteLength(inString.replace(/\\/g, "\\\\"))
  }

  /**
   * Calculate entropy of a string - used for better pattern selection
   * Higher entropy means more information content (less compressible)
   */
  private calculateEntropy(str: string): number {
    const len = str.length
    const frequencies: Record<string, number> = {}

    // Count character frequencies
    for (let i = 0; i < len; i++) {
      const char = str[i]
      frequencies[char] = (frequencies[char] || 0) + 1
    }

    // Calculate entropy using Shannon's formula
    let entropy = 0
    for (const char in frequencies) {
      const probability = frequencies[char] / len
      entropy -= probability * Math.log2(probability)
    }

    return entropy
  }

  /**
   * First stage: enhanced pattern detection and compression
   */
  private compressWithPatterns(packerData: PackerData, options: PackerOptions): PackerResult {
    let s = packerData.contents
    packerData.matchesLookup = []
    let details = ""

    // Get available tokens
    const delimiterCode = packerData.packedStringDelimiter.charCodeAt(0)
    const Q: string[] = []
    for (let i = 0; ++i < 127; ) {
      if (i - 96 && i - 13 && i - delimiterCode && i - 92) {
        Q.push(String.fromCharCode(i))
      }
    }

    const matches: Record<string, number> = {}
    let tokens = ""
    this.safetyCounter = 0

    // Enhanced pattern detection - multi-pass with context awareness
    while (this.safetyCounter++ < this.maxSafetyCount) {
      // Find an unused character to use as a token
      let c = ""
      for (let i = 122; !c && i > 0; i--) {
        if (i < Q.length && s.indexOf(Q[i]) === -1) {
          c = Q[i]
        }
      }

      // If no unused character is found, break the loop
      if (!c) break

      // Add the token to our token string
      tokens = c + tokens

      // Find patterns with advanced detection
      if (tokens.length === 1) {
        this.findInitialPatterns(s, matches)
      } else {
        this.updatePatternMatches(s, matches)
      }

      // Find the best match using the selected or adaptive heuristic strategy
      let bestMatch: { pattern: string; score: number; gain: number; copies: number } | null = null

      if (this.heuristic === CrusherHeuristic.ADAPTIVE) {
        // Try all heuristics and pick the best one for this step
        const heuristics = [
          CrusherHeuristic.BALANCED,
          CrusherHeuristic.MOST_COPIES,
          CrusherHeuristic.LONGEST,
          CrusherHeuristic.DENSITY,
        ]

        let bestScore = -1
        let bestHeuristicMatch = null
        let usedHeuristic = ""

        for (const heuristic of heuristics) {
          let match = null

          switch (heuristic) {
            case CrusherHeuristic.BALANCED:
              match = this.findBestMatchBalanced(matches, options, s.length)
              break
            case CrusherHeuristic.MOST_COPIES:
              match = this.findBestMatchByMostCopies(matches, options)
              break
            case CrusherHeuristic.LONGEST:
              match = this.findBestMatchByLongest(matches, options)
              break
            case CrusherHeuristic.DENSITY:
              match = this.findBestMatchByDensity(matches, options)
              break
          }

          if (match && match.score > bestScore) {
            bestScore = match.score
            bestHeuristicMatch = match
            usedHeuristic = heuristic
          }
        }

        bestMatch = bestHeuristicMatch
        if (bestMatch) {
          details += `[Using ${usedHeuristic} heuristic] `
        }
      } else {
        // Use the selected single heuristic
        bestMatch = this.findBestMatch(matches, options, s.length)
      }

      if (!bestMatch) break

      const { pattern, score, gain, copies } = bestMatch

      // Update the other matches in case the selected one is a substring thereof
      const newMatches: Record<string, number> = {}
      for (const x in matches) {
        newMatches[x.split(pattern).join(c)] = 1
      }
      Object.assign(matches, newMatches)

      // Apply the compression to the string
      s = this.stringHelper.matchAndReplaceAll(s, false, pattern, c, "", c + pattern, 0, [])

      packerData.matchesLookup.push({
        token: c,
        string: pattern,
        originalString: pattern,
        depends: "",
        usedBy: "",
        gain,
        copies,
        len: this.getEscapedByteLength(pattern),
        score,
        cleared: false,
        newOrder: 9999,
      })

      details +=
        c.charCodeAt(0) +
        "(" +
        c +
        ") : val=" +
        score +
        ", gain=" +
        gain +
        ", N=" +
        copies +
        ", str = " +
        pattern +
        "\n"
    }

    // Analyze remaining potential patterns
    // Instead of:
    // this.analyzeRemainingPatterns(matches, packerData, options, details)

    // Use this inline implementation:
    // Analyze remaining potential patterns
    // Update matches count one last time
    const newMatches: Record<string, number> = {}
    for (const x in matches) {
      let j = packerData.contents.indexOf(x)
      newMatches[x] = 0
      while (j !== -1) {
        newMatches[x]++
        j = packerData.contents.indexOf(x, j + x.length)
      }
    }
    Object.assign(matches, newMatches)

    // Analyze patterns with potential gain
    let firstLine = true
    for (const i in matches) {
      const j = this.getEscapedByteLength(i)
      const R = matches[i]
      const Z = R * j - R - j - 2

      if (Z > 0) {
        if (firstLine) {
          details += "\n--- Potential gain, but not enough tokens ---\n"
          firstLine = false
        }
        const value = options.crushGainFactor * Z + options.crushLengthFactor * j + options.crushCopiesFactor * R
        details += "..( ) : val=" + value + ", gain=" + Z + ", N=" + R + ", str = " + i + "\n"
        packerData.matchesLookup!.push({
          token: "",
          string: i,
          originalString: i,
          depends: "",
          usedBy: "",
          gain: Z,
          copies: R,
          len: j,
          score: value,
          cleared: false,
          newOrder: 9999,
        })
      }
    }

    // Analyze patterns that are almost gains
    firstLine = true
    for (const i in matches) {
      const j = this.getEscapedByteLength(i)
      const R = matches[i]
      const Z = R * j - R - j - 2
      const Z1 = (R + 1) * j - (R + 1) - j - 2

      if (Z <= 0 && Z1 > 0) {
        if (firstLine) {
          details += "\n--- One extra occurrence needed for a gain ---\n"
          firstLine = false
        }
        const value = options.crushGainFactor * Z1 + options.crushLengthFactor * j + options.crushCopiesFactor * R
        details +=
          "   val=" + value + ", gain=" + Z + "->" + Z1 + " (+" + (Z1 - Z) + "), N=" + R + ", str = " + i + "\n"
      }
    }

    // Prepare the packed string
    const loopInitCode = options.useES6 ? ";for(i of" : ";for(i in G="
    const loopMemberCode = options.useES6 ? "i" : "G[i]"

    // Escape the backslashes present in the code
    let packedString = this.stringHelper.matchAndReplaceAll(s, false, "\\", "\\\\", "", "", 0, [])

    // Escape the occurrences of the string delimiter present in the code
    packedString = this.stringHelper.matchAndReplaceAll(
      packedString,
      false,
      packerData.packedStringDelimiter,
      "\\" + packerData.packedStringDelimiter,
      "",
      "",
      0,
      [],
    )

    // Put everything together
    const unpackBlock1 = packerData.packedCodeVarName + "=" + packerData.packedStringDelimiter
    const unpackBlock2 =
      packerData.packedStringDelimiter +
      loopInitCode +
      packerData.packedStringDelimiter +
      tokens +
      packerData.packedStringDelimiter +
      ")with(" +
      packerData.packedCodeVarName +
      ".split(" +
      loopMemberCode +
      "))" +
      packerData.packedCodeVarName +
      "=join(pop("
    const unpackBlock3 = "));"

    const output =
      unpackBlock1 +
      packedString +
      unpackBlock2 +
      packerData.wrappedInit +
      unpackBlock3 +
      packerData.environment +
      packerData.interpreterCall

    return {
      length: this.getByteLength(output),
      output,
      details,
    }
  }

  /**
   * Find initial patterns in the string
   */
  private findInitialPatterns(s: string, matches: Record<string, number>): void {
    let found = true
    for (let t = 2; found && this.safetyCounter++ < this.maxSafetyCount; ++t) {
      found = false
      // Use sliding window approach for better pattern detection
      for (let i = 0; i < s.length - t; ++i) {
        const beginCode = s.charCodeAt(i)
        const endCode = s.charCodeAt(i + t - 1)

        // Skip surrogate pairs that would be broken
        if ((beginCode < 0xdc00 || beginCode > 0xdfff) && (endCode < 0xd800 || endCode > 0xdbff)) {
          const x = s.substr(i, t)

          // Skip if already processed
          if (!matches[x]) {
            // Check for repeated patterns
            let j = s.indexOf(x, i + t)
            if (j !== -1) {
              found = true
              matches[x] = 1

              // Count all occurrences
              while (j !== -1) {
                matches[x]++
                j = s.indexOf(x, j + t)
              }
            }
          }
        }
      }
    }
  }

  /**
   * Update pattern matches after a token replacement
   */
  private updatePatternMatches(s: string, matches: Record<string, number>): void {
    const newMatches: Record<string, number> = {}
    for (const x in matches) {
      let j = s.indexOf(x)
      newMatches[x] = 0
      while (j !== -1 && this.safetyCounter++ < this.maxSafetyCount) {
        newMatches[x]++
        j = s.indexOf(x, j + x.length)
      }
    }
    Object.assign(matches, newMatches)
  }

  /**
   * Find the best match using the selected heuristic strategy
   */
  private findBestMatch(
    matches: Record<string, number>,
    options: PackerOptions,
    totalLength: number,
  ): { pattern: string; score: number; gain: number; copies: number } | null {
    switch (this.heuristic) {
      case CrusherHeuristic.MOST_COPIES:
        return this.findBestMatchByMostCopies(matches, options)
      case CrusherHeuristic.LONGEST:
        return this.findBestMatchByLongest(matches, options)
      case CrusherHeuristic.DENSITY:
        return this.findBestMatchByDensity(matches, options)
      case CrusherHeuristic.ADAPTIVE_GAIN:
        return this.findBestMatchByAdaptiveGain(matches, options)
      case CrusherHeuristic.BALANCED:
      default:
        return this.findBestMatchBalanced(matches, options, totalLength)
    }
  }

  /**
   * Find the best match using a balanced approach (original algorithm)
   */
  private findBestMatchBalanced(
    matches: Record<string, number>,
    options: PackerOptions,
    totalLength: number,
  ): { pattern: string; score: number; gain: number; copies: number } | null {
    let bestPattern = ""
    let bestScore = 0
    let bestGain = 0
    let bestCopies = 0

    for (const pattern in matches) {
      const patternLength = this.getEscapedByteLength(pattern)
      const copies = matches[pattern]

      // Calculate gain with enhanced formula
      const gain = copies * patternLength - copies - patternLength - 2

      // Skip patterns with no gain
      if (gain <= 0) {
        if (copies < 2) {
          delete matches[pattern]
        }
        continue
      }

      // Enhanced scoring with entropy and context awareness
      const entropy = this.calculateEntropy(pattern)
      const patternDensity = (copies * pattern.length) / totalLength
      const entropyFactor = 1 / (entropy + 0.1) // Lower entropy is better for compression

      // Calculate score with all factors
      const score =
        options.crushGainFactor * gain +
        options.crushLengthFactor * patternLength +
        options.crushCopiesFactor * copies +
        entropyFactor * 0.5 +
        patternDensity * 2

      if (
        score > bestScore ||
        (score === bestScore &&
          (gain > bestGain ||
            (gain === bestGain && options.crushTiebreakerFactor * copies > options.crushTiebreakerFactor * bestCopies)))
      ) {
        bestPattern = pattern
        bestScore = score
        bestGain = gain
        bestCopies = copies
      }
    }

    return bestPattern ? { pattern: bestPattern, score: bestScore, gain: bestGain, copies: bestCopies } : null
  }

  /**
   * Find the best match by prioritizing patterns with the most copies
   */
  private findBestMatchByMostCopies(
    matches: Record<string, number>,
    options: PackerOptions,
  ): { pattern: string; score: number; gain: number; copies: number } | null {
    let bestPattern = ""
    let bestCopies = 0
    let bestGain = 0
    let bestScore = 0

    for (const pattern in matches) {
      const patternLength = this.getEscapedByteLength(pattern)
      const copies = matches[pattern]

      // Calculate gain
      const gain = copies * patternLength - copies - patternLength - 2

      // Skip patterns with no gain
      if (gain <= 0) {
        if (copies < 2) {
          delete matches[pattern]
        }
        continue
      }

      // Calculate score with heavy emphasis on number of copies
      const score = copies * 10 + gain + patternLength * 0.1

      // Prioritize patterns with more copies
      if (
        copies > bestCopies ||
        (copies === bestCopies && gain > bestGain) ||
        (copies === bestCopies && gain === bestGain && patternLength > this.getEscapedByteLength(bestPattern))
      ) {
        bestPattern = pattern
        bestCopies = copies
        bestGain = gain
        bestScore = score
      }
    }

    return bestPattern ? { pattern: bestPattern, score: bestScore, gain: bestGain, copies: bestCopies } : null
  }

  /**
   * Find the best match by prioritizing the longest patterns
   */
  private findBestMatchByLongest(
    matches: Record<string, number>,
    options: PackerOptions,
  ): { pattern: string; score: number; gain: number; copies: number } | null {
    let bestPattern = ""
    let bestLength = 0
    let bestGain = 0
    let bestScore = 0
    let bestCopies = 0

    for (const pattern in matches) {
      const patternLength = this.getEscapedByteLength(pattern)
      const copies = matches[pattern]

      // Calculate gain
      const gain = copies * patternLength - copies - patternLength - 2

      // Skip patterns with no gain
      if (gain <= 0) {
        if (copies < 2) {
          delete matches[pattern]
        }
        continue
      }

      // Calculate score with heavy emphasis on pattern length
      const score = patternLength * 10 + gain + copies * 0.1

      // Prioritize longer patterns
      if (
        patternLength > bestLength ||
        (patternLength === bestLength && gain > bestGain) ||
        (patternLength === bestLength && gain === bestGain && copies > bestCopies)
      ) {
        bestPattern = pattern
        bestLength = patternLength
        bestGain = gain
        bestScore = score
        bestCopies = copies
      }
    }

    return bestPattern ? { pattern: bestPattern, score: bestScore, gain: bestGain, copies: bestCopies } : null
  }

  /**
   * Find the best match by prioritizing patterns with highest density (copies * length)
   */
  private findBestMatchByDensity(
    matches: Record<string, number>,
    options: PackerOptions,
  ): { pattern: string; score: number; gain: number; copies: number } | null {
    let bestPattern = ""
    let bestDensity = 0
    let bestGain = 0
    let bestScore = 0
    let bestCopies = 0

    for (const pattern in matches) {
      const patternLength = this.getEscapedByteLength(pattern)
      const copies = matches[pattern]

      // Calculate gain
      const gain = copies * patternLength - copies - patternLength - 2

      // Skip patterns with no gain
      if (gain <= 0) {
        if (copies < 2) {
          delete matches[pattern]
        }
        continue
      }

      // Calculate density (copies * length)
      const density = copies * patternLength

      // Calculate score with heavy emphasis on density
      const score = density * 2 + gain

      // Prioritize patterns with higher density
      if (density > bestDensity || (density === bestDensity && gain > bestGain)) {
        bestPattern = pattern
        bestDensity = density
        bestGain = gain
        bestScore = score
        bestCopies = copies
      }
    }

    return bestPattern ? { pattern: bestPattern, score: bestScore, gain: bestGain, copies: bestCopies } : null
  }

  /**
   * Find the best match using the ADAPTIVE_GAIN strategy
   */
  private findBestMatchByAdaptiveGain(
    matches: Record<string, number>,
    options: PackerOptions,
  ): { pattern: string; score: number; gain: number; copies: number } | null {
    let bestPattern = ""
    let bestGain = 0
    let bestScore = 0
    let bestCopies = 0

    for (const pattern in matches) {
      const patternLength = this.getEscapedByteLength(pattern)
      const copies = matches[pattern]

      // Calculate raw gain: copies * length
      const rawGain = copies * patternLength

      // Calculate net gain considering replacement overhead
      const netGain = copies * patternLength - copies - patternLength - 2

      // Skip patterns with no gain
      if (netGain <= 0) {
        if (copies < 2) {
          delete matches[pattern]
        }
        continue
      }

      // Use raw gain (copies * length) as the primary score
      const score = rawGain

      // Prioritize patterns with higher raw gain
      if (
        score > bestScore ||
        (score === bestScore && netGain > bestGain) ||
        (score === bestScore && netGain === bestGain && copies > bestCopies)
      ) {
        bestPattern = pattern
        bestScore = score
        bestGain = netGain
        bestCopies = copies
      }
    }

    return bestPattern ? { pattern: bestPattern, score: bestScore, gain: bestGain, copies: bestCopies } : null
  }

  /**
   * Set the heuristic strategy for pattern selection
   * @param heuristic The heuristic strategy to use
   */
  public setHeuristic(heuristic: CrusherHeuristic): void {
    this.heuristic = heuristic
  }

  /**
   * Clears a match from matchesLookup for dependencies in the PackerData
   */
  private clear(packerData: PackerData, matchIndex: number): void {
    const oldToken = packerData.matchesLookup![matchIndex].token
    for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
      packerData.matchesLookup![j].usedBy = packerData.matchesLookup![j].usedBy.split(oldToken).join("")
    }
    packerData.matchesLookup![matchIndex].cleared = true
  }

  /**
   * Second stage: optimize token usage and convert to regexp
   */
  private optimizeAndPackToRegexp(packerData: PackerData, options: PackerOptions): PackerResult {
    let details = ""

    // Build dependency graph for better token allocation
    this.buildDependencyGraph(packerData)

    // Define the token list with optimized ordering
    this.buildOptimizedTokenList(packerData)

    // Log token ranges
    details += "\nToken ranges\n------------\n"
    for (let i = 0; i < packerData.tokenList!.length; ++i) {
      details += this.stringHelper.writeRangeToRegexpCharClass(
        packerData.tokenList![i].first,
        packerData.tokenList![i].last,
      )
      details +=
        " score = " +
        (10 * packerData.tokenList![i].oneByteTokenCount -
          packerData.tokenList![i].cost +
          packerData.tokenList![i].first / 1000) +
        "\n"
    }
    details += "\n"

    // Prepare tokens for allocation
    const { costOneTokens, costTwoTokens } = this.prepareTokensForAllocation(packerData.tokenList!)
    const availableTokens = [...costOneTokens, ...costTwoTokens]

    // Pack with optimized token allocation
    const { regPackOutput, tokenLine, unusedBackslash } = this.packWithOptimizedTokens(
      packerData,
      options,
      availableTokens,
      details,
    )

    // Handle edge cases and build the character class
    const tokenString = this.buildCharacterClass(packerData.tokenList!, tokenLine, unusedBackslash)

    // Prepare the final packed string
    const { regPackOutput2, resultSize } = this.prepareFinalOutput(packerData, regPackOutput, tokenString)

    // Verify the unpacking works correctly
    details += this.verifyUnpacking(packerData, regPackOutput2, tokenString)

    return {
      length: resultSize,
      output: regPackOutput2,
      details,
    }
  }

  /**
   * Build dependency graph for better token allocation
   */
  private buildDependencyGraph(packerData: PackerData): void {
    for (let i = 0; i < packerData.matchesLookup!.length; ++i) {
      for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
        if (
          packerData.matchesLookup![i].token &&
          packerData.matchesLookup![j].originalString.indexOf(packerData.matchesLookup![i].token) > -1
        ) {
          packerData.matchesLookup![j].originalString = packerData
            .matchesLookup![j].originalString.split(packerData.matchesLookup![i].token)
            .join(packerData.matchesLookup![i].originalString)
        }
        if (
          i !== j &&
          packerData.matchesLookup![j].originalString.indexOf(packerData.matchesLookup![i].originalString) > -1
        ) {
          packerData.matchesLookup![j].depends += packerData.matchesLookup![i].token
          packerData.matchesLookup![i].usedBy += packerData.matchesLookup![j].token
        }
      }
    }
  }

  /**
   * Build optimized token list for better compression
   */
  private buildOptimizedTokenList(packerData: PackerData): void {
    const tokenList: Array<{
      first: number
      last: number
      count: number
      cost: number
      oneByteTokenCount: number
    }> = []

    let firstInLine = -1
    for (let i = 1; i < 127; ++i) {
      const token = String.fromCharCode(i)
      // Allowed tokens: everything in the ASCII range except excluded characters
      if (i !== packerData.packedStringDelimiter.charCodeAt(0) && packerData.contents.indexOf(token) === -1) {
        if (firstInLine === -1) {
          firstInLine = i
        }
      } else {
        if (firstInLine > -1) {
          // Do not start a block with CR nor LF
          if (firstInLine === 13) {
            ++firstInLine
          }
          let lastInLine = i - 1
          // Do not end a block with CR nor LF
          if (i === 11 || i === 14) {
            --lastInLine
          }
          if (lastInLine >= firstInLine) {
            // Skip if there is only CR or LF in the range
            const tokenCount = lastInLine - firstInLine + 1
            const range = this.stringHelper.writeRangeToRegexpCharClass(firstInLine, lastInLine)
            const containsBackslash = firstInLine <= 92 && i > 92
            tokenList.push({
              first: firstInLine,
              last: lastInLine,
              count: tokenCount,
              cost: range.length,
              oneByteTokenCount: tokenCount - (containsBackslash ? 1 : 0),
            })
          }
          firstInLine = -1
        }
      }
    }

    if (firstInLine > -1) {
      const range = this.stringHelper.writeRangeToRegexpCharClass(firstInLine, 126)
      tokenList.push({
        first: firstInLine,
        last: 126,
        count: 127 - firstInLine,
        cost: range.length,
        oneByteTokenCount: 127 - firstInLine - (firstInLine <= 92 ? 1 : 0),
      })
    }

    // Optimize token list ordering for better compression
    tokenList.sort((a, b) => {
      return 10 * b.oneByteTokenCount - b.cost + b.first / 1000 - (10 * a.oneByteTokenCount - a.cost + a.first / 1000)
    })

    // Handle special case for ^ character
    if (tokenList.length > 0 && tokenList[0].first === 94) {
      if (packerData.matchesLookup!.length < tokenList[0].count || tokenList.length === 1) {
        tokenList[0].cost = this.stringHelper.writeRangeToRegexpCharClass(
          ++tokenList[0].first,
          tokenList[0].last,
        ).length
        --tokenList[0].count
        --tokenList[0].oneByteTokenCount
      }
    }

    packerData.tokenList = tokenList
  }

  /**
   * Prepare tokens for allocation
   */
  private prepareTokensForAllocation(
    tokenList: Array<{
      first: number
      last: number
      count: number
      cost: number
      oneByteTokenCount: number
    }>,
  ): { costOneTokens: number[]; costTwoTokens: number[] } {
    const costOneTokens: number[] = []
    const costTwoTokens: number[] = []

    for (let tokenLine = 0; tokenLine < tokenList.length; ++tokenLine) {
      for (let i = tokenList[tokenLine].first; i <= tokenList[tokenLine].last; ++i) {
        if (i !== 13) {
          if (i === 92) {
            costTwoTokens.push(i)
          } else {
            costOneTokens.push(i)
          }
        }
      }
    }

    return { costOneTokens, costTwoTokens }
  }

  /**
   * Pack with optimized token allocation
   */
  private packWithOptimizedTokens(
    packerData: PackerData,
    options: PackerOptions,
    availableTokens: number[],
    details: string,
  ): {
    regPackOutput: string
    tokenLine: number
    unusedBackslash: boolean
  } {
    let regPackOutput = packerData.contents
    let tokensRemaining = true
    let gainsRemaining = true
    packerData.tokenCount = 0
    this.safetyCounter = 0

    // Allocate tokens with optimization
    while (
      this.safetyCounter++ < this.maxSafetyCount &&
      packerData.tokenCount < packerData.matchesLookup!.length &&
      tokensRemaining &&
      gainsRemaining
    ) {
      if (packerData.tokenCount >= availableTokens.length) {
        tokensRemaining = false
        break
      }

      const tokenCode = availableTokens[packerData.tokenCount]
      const tokenCost = this.stringHelper.getCharacterLength(tokenCode)

      // Find best match for this token
      const result = this.findBestMatchForToken(packerData, options, regPackOutput, tokenCost)

      if (result.negativeCleared) {
        continue
      }

      if (result.matchIndex > -1) {
        // A string was chosen, replace it with the current token
        const matchedString = packerData.matchesLookup![result.matchIndex].originalString
        packerData.matchesLookup![result.matchIndex].newOrder = packerData.tokenCount

        const token = String.fromCharCode(tokenCode)
        details +=
          token.charCodeAt(0) +
          "(" +
          token +
          "), gain=" +
          result.bestGain +
          ", N=" +
          result.bestCount +
          ", str = " +
          matchedString +
          "\n"

        regPackOutput = this.stringHelper.matchAndReplaceAll(
          regPackOutput,
          false,
          matchedString,
          token,
          matchedString + token,
          "",
          0,
          [],
        )

        // Remove dependencies on chosen string/token
        this.clear(packerData, result.matchIndex)

        // Define the replacement token
        ++packerData.tokenCount
        if (packerData.tokenCount >= availableTokens.length) {
          tokensRemaining = false // Bail out early
          details += "Out of tokens\n"
        }
      } else {
        // Remaining strings, but no gain: skip them and end the loop
        for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
          if (!packerData.matchesLookup![j].cleared) {
            details += "skipped str = " + packerData.matchesLookup![j].originalString + "\n"
          }
        }
        gainsRemaining = false
      }
    }

    // Map tokens used to actual ranges (lines)
    let tokenLine = 0
    this.tokenIndex = 0
    packerData.tokenIndex = 0
    const unusedBackslash =
      availableTokens.length > 0 &&
      availableTokens[availableTokens.length - 1] === 92 &&
      packerData.tokenCount < availableTokens.length

    if (packerData.tokenList!.length === 0) {
      // No tokens available
      details += "No tokens available\nFinal check: failed"
      throw new Error("No tokens available")
    }

    if (packerData.tokenCount >= availableTokens.length) {
      // All available tokens in use
      tokenLine = packerData.tokenList!.length - 1
      packerData.tokenIndex = packerData.tokenList![packerData.tokenList!.length - 1].count
    } else if (packerData.tokenCount > 0) {
      const lastTokenUsed = availableTokens[packerData.tokenCount - 1]
      let lineFound = false

      while (!lineFound && tokenLine < packerData.tokenList!.length) {
        // If a range starts or ends in \, and it is not actually used, replace it
        if (unusedBackslash && packerData.tokenList![tokenLine].first === 92) {
          // Remove unused \ at the beginning of a range
          ++packerData.tokenList![tokenLine].first
          --packerData.tokenList![tokenLine].count
        }
        if (unusedBackslash && packerData.tokenList![tokenLine].last === 92) {
          // Remove unused \ at the end of a range
          --packerData.tokenList![tokenLine].last
          --packerData.tokenList![tokenLine].count
        }
        if (
          lastTokenUsed >= packerData.tokenList![tokenLine].first &&
          lastTokenUsed <= packerData.tokenList![tokenLine].last
        ) {
          lineFound = true
          packerData.tokenIndex = lastTokenUsed - packerData.tokenList![tokenLine].first + 1
        } else {
          ++tokenLine
        }
      }
    }

    // Safeguard, should never happen
    if (tokenLine >= packerData.tokenList!.length) {
      details += "Exception: token out of range\nFinal check: failed"
      throw new Error("Token out of range")
    }

    return { regPackOutput, tokenLine, unusedBackslash }
  }

  /**
   * Find best match for a token
   */
  private findBestMatchForToken(
    packerData: PackerData,
    options: PackerOptions,
    regPackOutput: string,
    tokenCost: number,
  ): {
    matchIndex: number
    bestScore: number
    bestGain: number
    bestCount: number
    negativeCleared: boolean
  } {
    let matchIndex = -1
    let bestScore = -999
    let bestGain = -1
    let bestCount = 0
    let negativeCleared = false

    for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
      if (packerData.matchesLookup![j].usedBy === "" && !packerData.matchesLookup![j].cleared) {
        let count = 0
        for (
          let index = regPackOutput.indexOf(packerData.matchesLookup![j].originalString, 0);
          index > -1 && this.safetyCounter++ < this.maxSafetyCount;
          ++count
        ) {
          index = regPackOutput.indexOf(packerData.matchesLookup![j].originalString, index + 1)
        }

        const gain =
          count * (packerData.matchesLookup![j].len - tokenCost) - packerData.matchesLookup![j].len - 2 * tokenCost

        const score =
          options.crushGainFactor * gain +
          options.crushLengthFactor * packerData.matchesLookup![j].len +
          options.crushCopiesFactor * count

        if (gain >= 0) {
          if (
            score > bestScore ||
            (score === bestScore &&
              (gain > bestGain ||
                (gain === bestGain &&
                  options.crushTiebreakerFactor * count > options.crushTiebreakerFactor * bestCount)))
          ) {
            bestGain = gain
            bestCount = count
            matchIndex = j
            bestScore = score
          }
        } else {
          this.clear(packerData, j)
          negativeCleared = true
        }
      }
    }

    return { matchIndex, bestScore, bestGain, bestCount, negativeCleared }
  }

  /**
   * Build character class for regexp
   */
  private buildCharacterClass(
    tokenList: Array<{
      first: number
      last: number
      count: number
      cost: number
      oneByteTokenCount: number
    }>,
    tokenLine: number,
    unusedBackslash: boolean,
  ): string {
    // First identify if we have leftover tokens in the last range
    const remainingTokens = tokenList[tokenLine].count - this.tokenIndex
    // Force the last range to its actual length
    tokenList[tokenLine].last -= remainingTokens
    tokenList[tokenLine].count = this.tokenIndex

    if (remainingTokens > 0) {
      this.handleRemainingTokens(tokenList, tokenLine, remainingTokens, unusedBackslash)
    }

    // If the first range starts with ^, the character class will be misinterpreted
    if (tokenList.length > 1 && tokenList[0].first === 94) {
      const newFirstRange = tokenList.splice(1, 1)
      tokenList.unshift(newFirstRange[0])
    }

    // Build the character class
    let tokenString = ""
    for (let i = 0; i <= tokenLine; ++i) {
      const rangeString = this.stringHelper.writeRangeToRegexpCharClass(tokenList[i].first, tokenList[i].last)
      // If a token line consists in a single "-", add it at the beginning
      if (rangeString.charCodeAt(0) === 45) {
        tokenString = rangeString + tokenString
      } else {
        tokenString += rangeString
      }
    }

    return tokenString
  }

  /**
   * Handle remaining tokens
   */
  private handleRemainingTokens(
    tokenList: Array<{
      first: number
      last: number
      count: number
      cost: number
      oneByteTokenCount: number
    }>,
    tokenLine: number,
    remainingTokens: number,
    unusedBackslash: boolean,
  ): void {
    const tokensToReplace: Array<{
      rangeIndex: number
      atBeginning: boolean
      count: number
    }> = []

    // Look for escaped character ] (93) at the beginning or end of a range
    for (let i = 0; i <= tokenLine; ++i) {
      if (tokenList[i].first === 93) {
        tokensToReplace.push({ rangeIndex: i, atBeginning: true, count: 1 })
      } else if (tokenList[i].last === 93) {
        tokensToReplace.push({ rangeIndex: i, atBeginning: false, count: 1 })
      }
    }

    // The only token to replace is ] (93)
    for (let i = 0; i < tokensToReplace.length; ++i) {
      if (remainingTokens >= tokensToReplace[i].count) {
        // Substitute as many tokens as required
        for (let j = 0; j < tokensToReplace[i].count; ++j) {
          // Substitute the token in the already packed string
          ++this.tokenIndex
          --remainingTokens
          const currentRange = tokenList[tokensToReplace[i].rangeIndex]

          // Shift beginning or end of the former range
          --currentRange.count
          ++tokenList[tokenLine].count
          if (tokensToReplace[i].atBeginning) {
            ++currentRange.first
            // If the shift exposes an unused \ at the beginning of the range, shift again
            if (unusedBackslash && currentRange.first === 92) {
              ++currentRange.first
              --currentRange.count
            }
          } else {
            --currentRange.last
            // If the shift exposes an unused \ at the end of the range, shift again
            if (unusedBackslash && currentRange.last === 92) {
              --currentRange.last
              --currentRange.count
            }
          }
          // If we are adding from the end of the same range we are removing tokens from
          if (tokensToReplace[i].rangeIndex === tokenLine) {
            --this.tokenIndex
          }
        }
      }
    }
  }

  /**
   * Prepare final output
   */
  private prepareFinalOutput(
    packerData: PackerData,
    regPackOutput: string,
    tokenString: string,
  ): { regPackOutput2: string; resultSize: number } {
    // Escape the backslashes in the compressed code
    let checkedString = this.stringHelper.matchAndReplaceAll(regPackOutput, false, "\\", "\\\\", "", "", 0, [])

    // Escape the occurrences of the string delimiter
    checkedString = this.stringHelper.matchAndReplaceAll(
      checkedString,
      false,
      packerData.packedStringDelimiter,
      "\\" + packerData.packedStringDelimiter,
      "",
      "",
      0,
      [],
    )

    // Add the unpacking code to the compressed string
    const unpackBlock1 = "for(" + packerData.packedCodeVarName + "=" + packerData.packedStringDelimiter
    const unpackBlock2 =
      packerData.packedStringDelimiter +
      ";G=/[" +
      tokenString +
      "]/.exec(" +
      packerData.packedCodeVarName +
      ");)with(" +
      packerData.packedCodeVarName +
      ".split(G))" +
      packerData.packedCodeVarName +
      "=join(shift("
    const unpackBlock3 = "));"

    const regPackOutput2 =
      unpackBlock1 +
      checkedString +
      unpackBlock2 +
      packerData.wrappedInit +
      unpackBlock3 +
      packerData.environment +
      packerData.interpreterCall

    const resultSize = this.getByteLength(regPackOutput2)

    return { regPackOutput2, resultSize }
  }

  /**
   * Verify unpacking works correctly
   */
  private verifyUnpacking(packerData: PackerData, regPackOutput2: string, tokenString: string): string {
    let details = "------------------------\nFinal check: "

    // Extract the packed string from the output
    const startDelimiter = packerData.packedCodeVarName + "=" + packerData.packedStringDelimiter
    const endDelimiter = packerData.packedStringDelimiter + ";"

    const startIndex = regPackOutput2.indexOf(startDelimiter) + startDelimiter.length
    const endIndex = regPackOutput2.indexOf(endDelimiter, startIndex)

    let testString = regPackOutput2.substring(startIndex, endIndex)

    // Unescape the string
    testString = testString.replace(
      new RegExp("\\\\" + packerData.packedStringDelimiter, "g"),
      packerData.packedStringDelimiter,
    )
    testString = testString.replace(/\\\\/g, "\\")

    // Simulate the unpacking process
    const regToken = new RegExp("[" + tokenString + "]", "")
    for (let token = ""; (token = regToken.exec(testString)); ) {
      const k = testString.split(token)
      testString = k.join(k.shift())
    }

    const success = testString === packerData.contents
    details += (success ? "passed" : "failed") + ".\n"

    return details
  }
}
