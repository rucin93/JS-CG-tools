import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult, Match } from "../types"

/**
 * RegPack2 - An improved version of RegPack that uses beam search
 * instead of factor-based pattern selection for better compression
 */
export class RegPack2 {
  private stringHelper: StringHelper
  private maxBeamWidth = 5 // Default beam width
  private maxIterations = 100000 // Maximum iterations to prevent infinite loops
  private lookAheadDepth = 150 // Default look-ahead depth for multi-level gain predictions
  private searchGraph: {
    nodes: Array<{
      id: string
      text: string
      replacements: string[]
      size: number
      depth: number
      isBestSolution?: boolean
      predictedGain?: number
    }>
    edges: Array<{
      source: string
      target: string
      pattern: string
      gain: number
      predictedGain?: number
    }>
    maxDepth: number
    bestPath: string[]
  } = { nodes: [], edges: [], maxDepth: 0, bestPath: [] }

  constructor() {
    this.stringHelper = StringHelper.getInstance()
  }

  /**
   * Get the search graph data
   */
  public getSearchGraph() {
    return this.searchGraph
  }

  /**
   * Main entry point for RegPack2
   * @param input A string containing the program to pack
   * @param options An object detailing the different options for the preprocessor and packer
   * @return An array of PackerData, each containing the code packed with different settings
   */
  public runPacker(input: string, options: PackerOptions): PackerData[] {
    try {
      // Reset search graph
      this.searchGraph = { nodes: [], edges: [], maxDepth: 0, bestPath: [] }

      const inputData = new PackerData("RegPack2", input)

      // Set beam width from options if provided
      this.maxBeamWidth = options.beamWidth || this.maxBeamWidth

      // Set look-ahead depth from options if provided
      this.lookAheadDepth = options.lookAheadDepth || this.lookAheadDepth

      // First stage: use beam search to find optimal pattern replacements
      const output = this.findOptimalReplacements(inputData, options)
      inputData.result.push(output)

      // Second stage: convert token string to regexp (same as RegPack)
      const output2 = this.packToRegexpCharClass(inputData, options)
      inputData.result.push(output2)

      console.log(inputData)

      return [inputData]
    } catch (error) {
      console.error("Error in RegPack2:", error)
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
   * Find all potential patterns in the input string
   */
  private findAllPotentialPatterns(s: string): Match[] {
    const patterns: Match[] = []
    const matches: Record<string, number> = {}

    // Find all substrings that appear at least twice
    // Start with longer patterns for better compression
    for (let length = Math.min(100, Math.floor(s.length / 2)); length >= 2; length--) {
      for (let i = 0; i <= s.length - length; i++) {
        const beginCode = s.charCodeAt(i)
        const endCode = s.charCodeAt(i + length - 1)

        // Skip surrogate pairs that would be broken
        if ((beginCode < 0xdc00 || beginCode > 0xdfff) && (endCode < 0xd800 || endCode > 0xdbff)) {
          const pattern = s.substr(i, length)

          // Skip if already processed
          if (matches[pattern] !== undefined) continue

          // Count occurrences
          let count = 0
          let pos = -1
          while ((pos = s.indexOf(pattern, pos + 1)) !== -1) {
            count++
          }

          if (count >= 2) {
            matches[pattern] = count

            // Calculate gain (accounting for decoder overhead)
            const patternLength = this.getEscapedByteLength(pattern)
            const gain = count * patternLength - count - patternLength - 2

            patterns.push({
              token: "",
              string: pattern,
              originalString: pattern,
              depends: "",
              usedBy: "",
              gain,
              copies: count,
              len: patternLength,
              score: gain, // Use gain as score
              cleared: false,
              newOrder: 9999,
            })
          }
        }
      }
    }

    return patterns
  }

  /**
   * Update pattern statistics based on current text
   */
  private updatePatternStats(patterns: Match[], text: string): void {
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i]

      // Count occurrences in current text
      let count = 0
      let pos = 0
      while ((pos = text.indexOf(pattern.string, pos)) !== -1) {
        count++
        pos += pattern.string.length // Move past this occurrence to avoid overlaps
      }

      // Update pattern data
      pattern.copies = Math.max(count, 1) // Ensure at least 1 copy
      pattern.gain = count * pattern.len - count - pattern.len - 2
      pattern.score = pattern.gain // Use gain as score
    }

    // Remove patterns with fewer than 2 occurrences or negative gain
    for (let i = patterns.length - 1; i >= 0; i--) {
      if (patterns[i].copies < 2 || patterns[i].gain <= 0) {
        patterns.splice(i, 1)
      }
    }
  }

  /**
   * Predict multi-level gains by looking ahead multiple steps
   * @param text Current text state
   * @param availablePatterns Available patterns to choose from
   * @param depth Current look-ahead depth
   * @param maxDepth Maximum look-ahead depth
   * @param usedTokens Tokens already used in this prediction path
   * @returns Predicted total gain from this state
   */
  private predictMultiLevelGain(
    text: string,
    availablePatterns: Match[],
    depth = 0,
    maxDepth: number = this.lookAheadDepth,
    usedTokens: string[] = [],
  ): number {
    // Base case: reached maximum depth or no patterns available
    if (depth >= maxDepth || availablePatterns.length === 0) {
      return 0
    }

    // Update pattern statistics for current text
    const patterns = JSON.parse(JSON.stringify(availablePatterns))
    this.updatePatternStats(patterns, text)

    // Sort patterns by gain (highest first)
    patterns.sort((a, b) => b.gain - a.gain)

    // If no patterns with positive gain, return 0
    if (patterns.length === 0 || patterns[0].gain <= 0) {
      return 0
    }

    // Try the top pattern and predict future gains
    const pattern = patterns[0]

    // Find an unused character to use as a token
    let c = ""
    for (let i = 122; !c && i > 0; i--) {
      const token = String.fromCharCode(i)
      if (text.indexOf(token) === -1 && !usedTokens.includes(token)) {
        c = token
      }
    }

    // If no unused character is found, return current gain only
    if (!c) {
      return pattern.gain
    }

    // Apply this replacement
    const newText = this.stringHelper.matchAndReplaceAll(text, false, pattern.string, c, "", c + pattern.string, 0, [])

    // Create a deep copy of remaining patterns
    const remainingPatterns = patterns.filter((p) => p.string !== pattern.string)

    // Recursively predict gains for next levels
    const futureGain = this.predictMultiLevelGain(newText, remainingPatterns, depth + 1, maxDepth, [...usedTokens, c])

    // Return current gain plus discounted future gain
    // Apply a discount factor to prioritize immediate gains
    const discountFactor = 0.9
    return pattern.gain + discountFactor * futureGain
  }

  /**
   * First stage: use beam search to find optimal pattern replacements
   */
  private findOptimalReplacements(packerData: PackerData, options: PackerOptions): PackerResult {
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

    // Find all potential patterns
    const initialPatterns = this.findAllPotentialPatterns(s)

    // State representation for beam search
    interface State {
      id: string
      text: string
      tokens: string
      replacements: Match[]
      availablePatterns: Match[]
      score: number
      predictedScore?: number
      depth: number
      parent: string | null
      lastPattern: string | null
      lastGain: number
    }

    // Initialize beam with the starting state
    const startState: State = {
      id: "root",
      text: s,
      tokens: "",
      replacements: [],
      availablePatterns: [...initialPatterns],
      score: 0,
      depth: 0,
      parent: null,
      lastPattern: null,
      lastGain: 0,
    }

    // Calculate predicted score for the starting state
    startState.predictedScore = this.predictMultiLevelGain(startState.text, startState.availablePatterns)

    let beam: State[] = [startState]

    // Add root node to search graph
    this.searchGraph.nodes.push({
      id: startState.id,
      text: startState.text,
      replacements: [],
      size: startState.text.length,
      depth: 0,
      predictedGain: startState.predictedScore,
    })

    // Keep track of the best solution found
    let bestSolution = beam[0]
    let iteration = 0

    // Perform beam search
    while (iteration++ < this.maxIterations) {
      // Generate all possible next states from current beam
      const candidates: State[] = []

      for (const state of beam) {
        // Skip if no more tokens available
        if (state.tokens.length >= Q.length) {
          candidates.push(state) // Keep this state as a candidate
          continue
        }

        // Find new potential patterns at this step
        const newPatterns = this.findAllPotentialPatterns(state.text)

        // Merge with existing patterns, avoiding duplicates
        const mergedPatterns: Match[] = [...state.availablePatterns]
        for (const newPattern of newPatterns) {
          // Check if this pattern already exists
          const exists = mergedPatterns.some((p) => p.string === newPattern.string)
          if (!exists) {
            mergedPatterns.push(newPattern)
          }
        }

        // Update pattern statistics for current state
        this.updatePatternStats(mergedPatterns, state.text)

        // Sort patterns by gain (highest first)
        mergedPatterns.sort((a, b) => b.gain - a.gain)

        // Skip if no patterns with positive gain
        if (mergedPatterns.length === 0 || mergedPatterns[0].gain <= 0) {
          candidates.push(state) // Keep this state as a candidate
          continue
        }

        // Try the top N patterns as potential next steps
        const patternsToTry = Math.min(5, mergedPatterns.length)

        for (let i = 0; i < patternsToTry; i++) {
          const pattern = mergedPatterns[i]

          // Skip if pattern has no gain
          if (pattern.gain <= 0) continue

          // Find an unused character to use as a token
          let c = ""
          for (let j = 122; !c && j > 0; j--) {
            if (j < Q.length && state.text.indexOf(Q[j]) === -1) {
              c = Q[j]
            }
          }

          // If no unused character is found, skip this pattern
          if (!c) continue

          // Apply this replacement
          const newText = this.stringHelper.matchAndReplaceAll(
            state.text,
            false,
            pattern.string,
            c,
            "",
            c + pattern.string,
            0,
            [],
          )

          // Create a deep copy of remaining patterns
          const remainingPatterns = JSON.parse(
            JSON.stringify(mergedPatterns.filter((p) => p.string !== pattern.string)),
          )

          // Create new state ID
          const newStateId = `node_${this.searchGraph.nodes.length}`

          // Create new state
          const newState: State = {
            id: newStateId,
            text: newText,
            tokens: c + state.tokens,
            replacements: [...state.replacements, { ...pattern, token: c }],
            availablePatterns: remainingPatterns,
            score: state.score + pattern.gain,
            depth: state.depth + 1,
            parent: state.id,
            lastPattern: pattern.string,
            lastGain: pattern.gain,
          }

          // Calculate predicted future gains
          const predictedFutureGain = this.predictMultiLevelGain(newState.text, newState.availablePatterns)

          // Set predicted score (current score + predicted future gain)
          newState.predictedScore = newState.score + predictedFutureGain

          // Add node to search graph
          this.searchGraph.nodes.push({
            id: newStateId,
            text: newText,
            replacements: newState.replacements.map((r) => `${r.token}:${r.string}`),
            size: newText.length,
            depth: newState.depth,
            predictedGain: predictedFutureGain,
          })

          // Add edge to search graph
          this.searchGraph.edges.push({
            source: state.id,
            target: newStateId,
            pattern: pattern.string,
            gain: pattern.gain,
            predictedGain: predictedFutureGain,
          })

          // Update max depth
          if (newState.depth > this.searchGraph.maxDepth) {
            this.searchGraph.maxDepth = newState.depth
          }

          candidates.push(newState)
        }

        // Also consider not making any more replacements
        candidates.push(state)
      }

      // If no candidates were generated, we're done
      if (candidates.length === 0) break

      // Sort candidates by predicted score (if available) or actual score
      candidates.sort((a, b) => {
        if (a.predictedScore !== undefined && b.predictedScore !== undefined) {
          return b.predictedScore - a.predictedScore
        }
        return b.score - a.score
      })

      beam = candidates.slice(0, this.maxBeamWidth)

      // Update best solution if we found a better one (based on actual score, not predicted)
      if (beam[0].score > bestSolution.score) {
        bestSolution = beam[0]
      }

      // If the best state has no more patterns with positive gain, we can stop
      if (
        beam[0].availablePatterns.length === 0 ||
        (beam[0].availablePatterns.length > 0 && beam[0].availablePatterns[0].gain <= 0)
      ) {
        break
      }
    }

    // Mark the best solution in the search graph
    const bestNodeIndex = this.searchGraph.nodes.findIndex((node) => node.id === bestSolution.id)
    if (bestNodeIndex !== -1) {
      this.searchGraph.nodes[bestNodeIndex].isBestSolution = true
    }

    // Build the best path
    let currentNode = bestSolution
    const bestPath: string[] = [currentNode.id]

    while (currentNode.parent) {
      bestPath.unshift(currentNode.parent)
      const parentNode = beam.find((node) => node.id === currentNode.parent)
      if (!parentNode) {
        // Find in all nodes of the search graph
        const allNodes = this.searchGraph.nodes.map((node) => node.id)
        const nodeIndex = allNodes.indexOf(currentNode.parent)
        if (nodeIndex === -1) break
      }
      currentNode = parentNode || { ...currentNode, parent: null }
    }

    this.searchGraph.bestPath = bestPath

    // Use the best solution found
    s = bestSolution.text
    const tokens = bestSolution.tokens

    // Update matchesLookup for visualization and second stage
    packerData.matchesLookup = bestSolution.replacements

    // Add details for each replacement
    for (const match of bestSolution.replacements) {
      details += `${match.token.charCodeAt(0)}(${match.token}) : gain=${match.gain}, N=${match.copies}, str = ${match.string}\n`
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

    // Add summary to details
    details += "\n------------------------\n"
    details += `Original size: ${packerData.contents.length} bytes\n`
    details += `Compressed size: ${s.length} bytes\n`
    details += `Decoder size: ${unpackBlock1.length + unpackBlock2.length + unpackBlock3.length} bytes\n`
    details += `Total size: ${output.length} bytes\n`
    details += `Compression ratio: ${((output.length / packerData.contents.length) * 100).toFixed(2)}%\n`
    details += `Algorithm: Beam Search (width=${this.maxBeamWidth}, look-ahead=${this.lookAheadDepth}, dynamic pattern discovery)\n`
    details += `Search graph: ${this.searchGraph.nodes.length} nodes, ${this.searchGraph.edges.length} edges\n`

    return {
      length: this.getByteLength(output),
      output,
      details,
    }
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
   * Second stage: extra actions required to reduce the token string to a RegExp
   * This is the same as in RegPack to maintain compatibility
   */
  private packToRegexpCharClass(packerData: PackerData, options: PackerOptions): PackerResult {
    let details = ""

    // Re-expand the packed strings and establish a dependency graph
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

    // Define the token list that will be used by ordering blocks
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

    // Reorder the block list
    tokenList.sort((a, b) => {
      return 10 * b.oneByteTokenCount - b.cost + b.first / 1000 - (10 * a.oneByteTokenCount - a.cost + a.first / 1000)
    })

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

    // The first range must not start with ^, otherwise it will be interpreted as negated char class
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

    details += "\nToken ranges\n------------\n"
    for (let i = 0; i < tokenList.length; ++i) {
      details += this.stringHelper.writeRangeToRegexpCharClass(tokenList[i].first, tokenList[i].last)
      details +=
        " score = " + (10 * tokenList[i].oneByteTokenCount - tokenList[i].cost + tokenList[i].first / 1000) + "\n"
    }
    details += "\n"

    // Pack again by replacing the strings by the tokens, in the new compression order
    const availableTokens = [...costOneTokens, ...costTwoTokens]
    let tokensRemaining = true
    let gainsRemaining = true
    packerData.tokenCount = 0

    let regPackOutput = packerData.contents
    for (let i = 0; i < packerData.matchesLookup!.length && tokensRemaining && gainsRemaining; ++i) {
      if (packerData.tokenCount >= availableTokens.length) {
        tokensRemaining = false
        break
      }

      const tokenCode = availableTokens[packerData.tokenCount]
      const tokenCost = this.stringHelper.getCharacterLength(tokenCode)

      let matchIndex = -1,
        bestScore = -999,
        bestGain = -1,
        bestCount = 0,
        negativeCleared = false
      for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
        if (packerData.matchesLookup![j].usedBy === "" && !packerData.matchesLookup![j].cleared) {
          let count = 0
          for (let index = regPackOutput.indexOf(packerData.matchesLookup![j].originalString, 0); index > -1; ++count) {
            index = regPackOutput.indexOf(packerData.matchesLookup![j].originalString, index + 1)
          }
          const gain =
            count * (packerData.matchesLookup![j].len - tokenCost) - packerData.matchesLookup![j].len - 2 * tokenCost
          const score = gain // Use gain as score directly

          if (gain >= 0) {
            if (
              score > bestScore ||
              (score === bestScore && (gain > bestGain || (gain === bestGain && count > bestCount)))
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

      if (!negativeCleared) {
        if (matchIndex > -1) {
          // A string was chosen, replace it with the current token
          const matchedString = packerData.matchesLookup![matchIndex].originalString
          packerData.matchesLookup![matchIndex].newOrder = packerData.tokenCount

          const token = String.fromCharCode(tokenCode)
          details +=
            token.charCodeAt(0) +
            "(" +
            token +
            "), gain=" +
            bestGain +
            ", N=" +
            bestCount +
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
          this.clear(packerData, matchIndex)

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
    }

    // Map tokens used to actual ranges (lines)
    let tokenLine = 0
    let tokenIndex = 0
    const unusedBackslash =
      availableTokens.length > 0 &&
      availableTokens[availableTokens.length - 1] === 92 &&
      packerData.tokenCount < availableTokens.length

    if (tokenList.length === 0) {
      // No tokens available
      details += "No tokens available\nFinal check: failed"
      return {
        length: -1,
        output: "",
        details,
      }
    }

    if (packerData.tokenCount >= availableTokens.length) {
      // All available tokens in use
      tokenLine = tokenList.length - 1
      tokenIndex = tokenList[tokenList.length - 1].count
    } else if (packerData.tokenCount > 0) {
      const lastTokenUsed = availableTokens[packerData.tokenCount - 1]
      let lineFound = false

      while (!lineFound && tokenLine < tokenList.length) {
        // If a range starts or ends in \, and it is not actually used, replace it
        if (unusedBackslash && tokenList[tokenLine].first === 92) {
          // Remove unused \ at the beginning of a range
          ++tokenList[tokenLine].first
          --tokenList[tokenLine].count
        }
        if (unusedBackslash && tokenList[tokenLine].last === 92) {
          // Remove unused \ at the end of a range
          --tokenList[tokenLine].last
          --tokenList[tokenLine].count
        }
        if (lastTokenUsed >= tokenList[tokenLine].first && lastTokenUsed <= tokenList[tokenLine].last) {
          lineFound = true
          tokenIndex = lastTokenUsed - tokenList[tokenLine].first + 1
        } else {
          ++tokenLine
        }
      }
    }

    // Safeguard, should never happen
    if (tokenLine >= tokenList.length) {
      details += "Exception: token out of range\nFinal check: failed"
      return {
        length: -1,
        output: "",
        details,
      }
    }

    // First identify if we have leftover tokens in the last range
    let remainingTokens = tokenList[tokenLine].count - tokenIndex
    // Force the last range to its actual length
    tokenList[tokenLine].last -= remainingTokens
    tokenList[tokenLine].count = tokenIndex

    if (remainingTokens > 0) {
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
            ++tokenIndex
            --remainingTokens
            const currentRange = tokenList[tokensToReplace[i].rangeIndex]
            const oldToken = String.fromCharCode(
              tokensToReplace[i].atBeginning ? currentRange.first : currentRange.last,
            )
            const newToken = String.fromCharCode(++tokenList[tokenLine].last)
            regPackOutput = regPackOutput.split(oldToken).join(newToken)
            details +=
              oldToken.charCodeAt(0) +
              "(" +
              oldToken +
              ") replaced by " +
              newToken.charCodeAt(0) +
              "(" +
              newToken +
              ")\n"

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
              --tokenIndex
            }
          }
        }
      }
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

    // Check that unpacking the string yields the original code
    details += "------------------------\nFinal check: "
    let testString = checkedString.replace(
      new RegExp("\\\\" + packerData.packedStringDelimiter, "g"),
      packerData.packedStringDelimiter,
    )
    testString = testString.replace(/\\\\/g, "\\")
    const regToken = new RegExp("[" + tokenString + "]", "")
    for (let token = ""; (token = regToken.exec(testString)); ) {
      const k = testString.split(token)
      testString = k.join(k.shift())
    }
    const success = testString === packerData.contents
    details += (success ? "passed" : "failed") + ".\n"

    return {
      length: resultSize,
      output: regPackOutput2,
      details,
    }
  }
}
