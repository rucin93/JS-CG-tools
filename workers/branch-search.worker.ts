// Define message types for worker communication
interface WorkerInitMessage {
  type: "init"
  input: string
  options: {
    maxStates: number
    timeLimit?: number
    beamWidth?: number // Added beam width parameter
  }
}

interface WorkerProgressMessage {
  type: "progress"
  progress: {
    progress: number
    stage: string
    message: string
    details?: string
  }
}

interface WorkerResultMessage {
  type: "result"
  text: string
  replacements: string[]
  size: number
  totalGain: number
  nodesExplored: number
  timeTaken: number
  matchesLookup: any[]
  searchGraph: SearchGraphData
}

// Graph data structure for visualization
interface SearchGraphNode {
  id: string
  text: string
  replacements: string[]
  size: number
  depth: number
  totalGain: number
  isBestSolution?: boolean
  inBeam?: boolean // Added to track if node is in the beam
  beamRank?: number // Added to track node's rank in the beam
}

interface SearchGraphEdge {
  source: string
  target: string
  pattern: string
  gain: number
}

interface SearchGraphData {
  nodes: SearchGraphNode[]
  edges: SearchGraphEdge[]
  maxDepth: number
  bestPath: string[] // IDs of nodes in the best path
}

// Pattern information
interface Pattern {
  string: string
  gain: number
  copies: number
  rawGain: number // Length * copies
}

// State representation for beam search
interface State {
  id: string
  text: string
  replacements: string[]
  patterns: Pattern[]
  totalGain: number
  score: number
  depth: number
  parentId: string | null
  patternUsed?: string
  patternGain?: number
}

// StringHelper implementation directly in the worker to avoid import issues
class StringHelper {
  public matchAndReplaceAll(
    input: string,
    matchExp: RegExp | false,
    originalText: string,
    replacementText: string,
    prefix = "",
    suffix = "",
    extraMapping: any = null,
    thermalMap: any[] = [],
  ): string {
    let output = prefix || ""
    let inputPointer = 0
    const originalTextLength = originalText.length
    let offset = -1

    if (matchExp) {
      const nextMatch = matchExp.exec(input)
      if (nextMatch) {
        const offsetInMatch = nextMatch[0].indexOf(originalText)
        offset = nextMatch.index + offsetInMatch
      }
    } else {
      offset = input.indexOf(originalText, inputPointer)
    }

    while (offset >= 0) {
      if (offset > inputPointer) {
        // There is an interval between two replaced blocks
        output += input.substring(inputPointer, offset)
      }

      // Add the replacement
      output += replacementText

      inputPointer = offset + originalTextLength
      if (matchExp) {
        const nextMatch = matchExp.exec(input)
        if (nextMatch) {
          const offsetInMatch = nextMatch[0].indexOf(originalText)
          offset = nextMatch.index + offsetInMatch
        } else {
          offset = -1
        }
      } else {
        offset = input.indexOf(originalText, inputPointer)
      }
    }

    // Text remaining at the end
    if (inputPointer < input.length) {
      output += input.substring(inputPointer)
    }

    output += suffix || ""

    return output
  }
}

// Listen for messages from the main thread
self.onmessage = (event: MessageEvent) => {
  try {
    if (event.data.type === "init") {
      const { input, options } = event.data

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

      // Run the beam search algorithm
      findBestReplacementsWithBeamSearch(input, options)
    }
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Send progress updates to the main thread
function sendProgress(progress: number, stage: string, message: string, details?: string) {
  const progressMessage: WorkerProgressMessage = {
    type: "progress",
    progress: {
      progress,
      stage,
      message,
      details,
    },
  }
  self.postMessage(progressMessage)
}

// Send final result to the main thread
function sendResult(
  text: string,
  replacements: string[],
  size: number,
  totalGain: number,
  nodesExplored: number,
  timeTaken: number,
  matchesLookup: any[],
  searchGraph: SearchGraphData,
) {
  const message: WorkerResultMessage = {
    type: "result",
    text,
    replacements,
    size,
    totalGain,
    nodesExplored,
    timeTaken,
    matchesLookup,
    searchGraph,
  }

  // Log the size of the message for debugging
  const nodeCount = searchGraph.nodes.length
  const edgeCount = searchGraph.edges.length
  console.log(`Sending search graph with ${nodeCount} nodes and ${edgeCount} edges`)
  console.log(`Best solution: ${size} bytes, ${replacements.length} replacements, total gain: ${totalGain}`)

  // Send the message to the main thread
  self.postMessage(message)
}

// Beam search algorithm to find the best replacements
function findBestReplacementsWithBeamSearch(
  input: string,
  options: {
    maxStates: number
    timeLimit?: number
    beamWidth?: number
  },
) {
  const startTime = Date.now()
  const stringHelper = new StringHelper()
  const MAX_REPLACEMENTS = 10 // Always aim for 10 replacements
  const MAX_DEPTH = MAX_REPLACEMENTS

  // Use provided beam width or default to 5
  const beamWidth = options.beamWidth || 5

  // Report initial progress
  sendProgress(0.02, "initialization", `Starting beam search with width ${beamWidth}...`, "Analyzing patterns")

  // Find all potential patterns in the input
  const allPatterns = findAllPotentialPatterns(input)

  sendProgress(0.05, "analysis", `Found ${allPatterns.length} potential patterns`, "Starting beam search")

  // Create graph data structures for visualization
  const nodes: SearchGraphNode[] = []
  const edges: SearchGraphEdge[] = []
  const bestPath: string[] = []

  // Initialize state tracking
  let nodesExplored = 0
  let bestState: State | null = null
  let globalBestState: State | null = null // Track the best state found across all iterations

  // Create the root state
  const rootState: State = {
    id: "root",
    text: input,
    replacements: [],
    patterns: [...allPatterns],
    totalGain: 0,
    score: 0,
    depth: 0,
    parentId: null,
  }

  // Add root node to graph
  nodes.push({
    id: rootState.id,
    text: rootState.text,
    replacements: rootState.replacements,
    size: rootState.text.length,
    depth: rootState.depth,
    totalGain: rootState.totalGain,
    inBeam: true,
    beamRank: 0,
  })

  // Keep track of all states for path reconstruction
  const allStates: Record<string, State> = {
    [rootState.id]: rootState,
  }

  // Initialize beam with the root state
  let beam: State[] = [rootState]

  // Perform beam search
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    // Check if we've exceeded the time limit
    if (options.timeLimit && Date.now() - startTime > options.timeLimit) {
      sendProgress(
        0.9,
        "timeout",
        "Time limit exceeded, returning best solution found so far",
        `Explored ${nodesExplored} states in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`,
      )
      break
    }

    // Report progress
    sendProgress(
      0.1 + 0.8 * (depth / MAX_DEPTH),
      "searching",
      `Beam search depth ${depth + 1}/${MAX_DEPTH}`,
      `Beam size: ${beam.length}, Best gain so far: ${globalBestState?.totalGain || 0}`,
    )

    // Generate all possible next states from current beam
    const candidates: State[] = []

    for (const state of beam) {
      // Skip if we've already used all 10 digits or no patterns remain
      if (state.replacements.length >= MAX_REPLACEMENTS || state.patterns.length === 0) {
        // Even if we can't expand this state further, it might be our best solution
        if (!globalBestState || state.totalGain > globalBestState.totalGain) {
          globalBestState = state
        }
        continue
      }

      // Update pattern statistics for current state
      updatePatternStats(state.patterns, state.text)

      // Sort patterns by gain (highest first)
      state.patterns.sort((a, b) => b.gain - a.gain)

      // Skip if no patterns with positive gain
      if (state.patterns.length === 0 || state.patterns[0].gain <= 0) {
        // This state can't be expanded further, but might be our best solution
        if (!globalBestState || state.totalGain > globalBestState.totalGain) {
          globalBestState = state
        }
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
        const newText = stringHelper.matchAndReplaceAll(state.text, false, pattern.string, digit, "", "", 0, [])

        // Create a deep copy of remaining patterns
        const remainingPatterns = state.patterns
          .filter(
            (p) =>
              !p.string.includes(digit) && !p.string.includes(pattern.string) && !pattern.string.includes(p.string),
          )
          .map((p) => ({ ...p }))

        // Calculate new total gain
        const newGain = state.totalGain + pattern.gain

        // Calculate score for beam search
        // Use a combination of current gain and potential future gain
        const potentialFutureGain = estimateFutureGain(remainingPatterns, newText)
        const score = newGain + potentialFutureGain * 0.5 // Weight future gain less

        // Create new state ID
        const newId = `node-${depth + 1}-${nodesExplored++}`

        // Create new state
        const newState: State = {
          id: newId,
          text: newText,
          replacements: [...state.replacements, pattern.string],
          patterns: remainingPatterns,
          totalGain: newGain,
          score: score,
          depth: depth + 1,
          parentId: state.id,
          patternUsed: pattern.string,
          patternGain: pattern.gain,
        }

        // Store the state for path reconstruction
        allStates[newId] = newState

        // Check if this is our new global best state
        if (!globalBestState || newState.totalGain > globalBestState.totalGain) {
          globalBestState = newState
        }

        candidates.push(newState)

        // Add node to graph
        nodes.push({
          id: newState.id,
          text: newState.text,
          replacements: newState.replacements,
          size: calculateFinalSize(newState.text, newState.replacements),
          depth: newState.depth,
          totalGain: newState.totalGain,
        })

        // Add edge to graph
        edges.push({
          source: state.id,
          target: newState.id,
          pattern: pattern.string,
          gain: pattern.gain,
        })
      }
    }

    // If no candidates were generated, we're done
    if (candidates.length === 0) {
      sendProgress(
        0.9,
        "complete",
        "No more candidates to explore",
        `Explored ${nodesExplored} states in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`,
      )
      break
    }

    // Sort candidates by score and keep only the top beamWidth
    candidates.sort((a, b) => b.score - a.score)
    beam = candidates.slice(0, beamWidth)

    // Update beam status in graph
    for (let i = 0; i < beam.length; i++) {
      const node = nodes.find((n) => n.id === beam[i].id)
      if (node) {
        node.inBeam = true
        node.beamRank = i
      }
    }

    // Update best solution in the current beam
    if (beam.length > 0) {
      bestState = beam[0]
    }
  }

  // Use the global best state as our final solution
  const finalBestState = globalBestState || bestState || rootState

  // Mark the best solution in the graph
  const bestNode = nodes.find((n) => n.id === finalBestState.id)
  if (bestNode) {
    bestNode.isBestSolution = true
  }

  // Build the best path using allStates
  let currentId = finalBestState.id
  while (currentId) {
    bestPath.unshift(currentId)
    const state = allStates[currentId]
    currentId = state?.parentId || null
  }

  // Create search graph data
  const searchGraph: SearchGraphData = {
    nodes,
    edges,
    maxDepth: finalBestState.depth,
    bestPath,
  }

  // Build matchesLookup for visualization
  const matchesLookup: any[] = []
  for (let i = 0; i < finalBestState.replacements.length; i++) {
    const pattern = finalBestState.replacements[i]

    // Count occurrences in the final text
    let count = 0
    for (let j = 0; j < finalBestState.text.length; j++) {
      if (finalBestState.text[j] === i.toString()) {
        count++
      }
    }

    matchesLookup.push({
      token: i.toString(),
      string: pattern,
      originalString: pattern,
      depends: "",
      usedBy: "",
      gain: (pattern.length - 1) * count - pattern.length - 1,
      copies: count,
      len: pattern.length,
      score: pattern.length * count,
      cleared: false,
      newOrder: i,
    })
  }

  // Report completion
  sendProgress(
    0.98,
    "finalizing",
    `Beam search complete.`,
    `Best solution: ${finalBestState.totalGain} bytes gain, ${finalBestState.replacements.length} replacements`,
  )

  // Send the final result
  sendResult(
    finalBestState.text,
    finalBestState.replacements,
    calculateFinalSize(finalBestState.text, finalBestState.replacements),
    finalBestState.totalGain,
    nodesExplored,
    Date.now() - startTime,
    matchesLookup,
    searchGraph,
  )
}

// Find all potential patterns in the input
function findAllPotentialPatterns(s: string): Pattern[] {
  const patterns: Pattern[] = []
  const patternMap = new Map<string, number>()

  // Find all substrings that appear at least twice
  for (let length = Math.min(100, Math.floor(s.length / 2)); length >= 2; length--) {
    // Track positions where each pattern occurs
    const patternPositions = new Map<string, number[]>()

    for (let i = 0; i <= s.length - length; i++) {
      const pattern = s.substring(i, i + length)

      // Skip if already processed or if pattern contains digits
      if (patternMap.has(pattern) || /[0-9]/.test(pattern)) continue

      // Get or initialize positions array
      if (!patternPositions.has(pattern)) {
        patternPositions.set(pattern, [])
      }

      // Add this position
      patternPositions.get(pattern)!.push(i)
    }

    // Process patterns with at least 2 occurrences
    for (const [pattern, positions] of patternPositions.entries()) {
      if (positions.length >= 2) {
        patternMap.set(pattern, positions.length)

        // Calculate raw gain (length * copies)
        const rawGain = pattern.length * positions.length

        // Calculate net gain (accounting for decoder overhead)
        const netGain = (pattern.length - 1) * positions.length - pattern.length - 1

        patterns.push({
          string: pattern,
          copies: positions.length,
          gain: netGain,
          rawGain: rawGain,
        })
      }
    }
  }

  return patterns
}

// Update pattern statistics based on current text
function updatePatternStats(patterns: Pattern[], text: string): void {
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
    pattern.gain = (pattern.string.length - 1) * adjustedCount - pattern.string.length - 1
    pattern.rawGain = pattern.string.length * adjustedCount // Raw gain as score
  }

  // Remove patterns with fewer than 2 occurrences or negative gain
  for (let i = patterns.length - 1; i >= 0; i--) {
    if (patterns[i].copies < 2 || patterns[i].gain <= 0) {
      patterns.splice(i, 1)
    }
  }
}

// Estimate potential future gain from remaining patterns
function estimateFutureGain(patterns: Pattern[], text: string): number {
  // Make a copy and update stats
  const patternsCopy = [...patterns]
  updatePatternStats(patternsCopy, text)

  // Sort by gain
  patternsCopy.sort((a, b) => b.gain - a.gain)

  // Estimate future gain by summing the top patterns' gains
  // with diminishing returns for each subsequent pattern
  let estimatedGain = 0
  const maxPatternsToConsider = Math.min(10, patternsCopy.length)

  for (let i = 0; i < maxPatternsToConsider; i++) {
    if (patternsCopy[i].gain <= 0) break

    // Apply diminishing weight to each subsequent pattern
    // since we can't be sure we'll be able to use all of them
    const weight = Math.pow(0.8, i)
    estimatedGain += patternsCopy[i].gain * weight
  }

  return estimatedGain
}

// Calculate the final size of a solution including the decoder
function calculateFinalSize(text: string, replacements: string[]): number {
  // Generate the actual final output to ensure accurate size calculation
  const decoderArray = `\`${replacements.join("|")}\`.split\`|\``
  const decoder = `.replace(/\\d/g,i=>${decoderArray}[i])`

  // The complete output string as it would be in the final result
  const completeOutput = `\`${text}\`${decoder}`

  // Return the exact length of the complete output
  return completeOutput.length
}
