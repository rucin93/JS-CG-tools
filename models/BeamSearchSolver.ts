import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult, Match } from "../types"
import { PatternAnalyzer } from "./PatternAnalyzer"
import { GainPredictor } from "./GainPredictor"

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

export class BeamSearchSolver {
  private stringHelper: StringHelper
  private patternAnalyzer: PatternAnalyzer
  private gainPredictor: GainPredictor
  private maxBeamWidth = 5
  private maxIterations = 100000
  private lookAheadDepth = 150
  private maxReplacements = 100

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
    this.patternAnalyzer = new PatternAnalyzer()
    this.gainPredictor = new GainPredictor()
  }

  public getSearchGraph() {
    return this.searchGraph
  }

  private getByteLength(inString: string): number {
    return encodeURI(inString).replace(/%../g, "i").length
  }

  private sortCandidates(candidates: State[], options: PackerOptions): void {
    candidates.sort((a, b) => {
      if (options.prioritizeHighestGain) {
        if (b.score !== a.score) {
          return b.score - a.score
        }
      }

      if (a.predictedScore !== undefined && b.predictedScore !== undefined) {
        if (Math.abs(b.predictedScore - a.predictedScore) > 0.1) {
          return b.predictedScore - a.predictedScore
        }
      }
      return b.score - a.score
    })
  }

  private reconstructBestPath(bestSolutionId: string): string[] {
    let currId = bestSolutionId
    const path: string[] = [currId]
    while (true) {
      const edge = this.searchGraph.edges.find((e) => e.target === currId)
      if (!edge) break
      currId = edge.source
      path.unshift(currId)
    }
    return path
  }

  public findOptimalReplacements(packerData: PackerData, options: PackerOptions): PackerResult {
    this.searchGraph = { nodes: [], edges: [], maxDepth: 0, bestPath: [] }
    this.gainPredictor.clearCache()

    if (options.beamWidth) this.maxBeamWidth = options.beamWidth
    if (options.lookAheadDepth) this.lookAheadDepth = options.lookAheadDepth
    if (options.maxReplacements) this.maxReplacements = options.maxReplacements

    let s = packerData.contents
    packerData.matchesLookup = []
    let details = ""

    const delimiterCode = packerData.packedStringDelimiter.charCodeAt(0)
    const Q: string[] = []
    for (let i = 1; i < 127; i++) {
      if (i !== 96 && i !== 13 && i !== delimiterCode && i !== 92) {
        Q.push(String.fromCharCode(i))
      }
    }

    const initialPatterns = this.patternAnalyzer.findAllPotentialPatterns(s)

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

    startState.predictedScore = this.gainPredictor.predictMultiLevelGain(
      startState.text,
      startState.availablePatterns,
      this.lookAheadDepth,
    )

    let beam: State[] = [startState]

    this.searchGraph.nodes.push({
      id: startState.id,
      text: startState.text,
      replacements: [],
      size: startState.text.length,
      depth: 0,
      predictedGain: startState.predictedScore,
    })

    let bestSolution = beam[0]
    let iteration = 0

    while (iteration++ < this.maxIterations) {
      const candidates: State[] = []

      for (const state of beam) {
        if (state.tokens.length >= Q.length || state.replacements.length >= this.maxReplacements) {
          candidates.push(state)
          continue
        }

        const newPatterns = this.patternAnalyzer.findAllPotentialPatterns(state.text)

        const existingStrings = new Set(state.availablePatterns.map((p) => p.string))
        const mergedPatterns: Match[] = [...state.availablePatterns]
        for (const newPattern of newPatterns) {
          if (!existingStrings.has(newPattern.string)) {
            mergedPatterns.push(newPattern)
            existingStrings.add(newPattern.string)
          }
        }

        this.patternAnalyzer.updatePatternStats(mergedPatterns, state.text)
        this.patternAnalyzer.sortPatterns(mergedPatterns)

        if (options.onProgress && iteration % 10 === 0) {
          options.onProgress({
            progress: 0.1 + (0.8 * beam[0].replacements.length) / this.maxReplacements,
            stage: "searching",
            message: `Beam search iteration ${iteration}`,
            details: `Current best gain: ${bestSolution.score}, Patterns found: ${mergedPatterns.length}`,
          })
        }

        if (mergedPatterns.length === 0 || mergedPatterns[0].gain <= 0) {
          candidates.push(state)
          continue
        }

        const patternsToTry = Math.min(options.branchFactor || 20, mergedPatterns.length)

        for (let i = 0; i < patternsToTry; i++) {
          const pattern = mergedPatterns[i]
          if (pattern.gain <= 0) continue

          let c = ""
          for (let j = 122; !c && j > 0; j--) {
            if (j < Q.length && state.text.indexOf(Q[j]) === -1) {
              c = Q[j]
            }
          }

          if (!c) continue

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

          const remainingPatterns = JSON.parse(
            JSON.stringify(mergedPatterns.filter((p) => p.string !== pattern.string)),
          )

          const newStateId = `node_${this.searchGraph.nodes.length}`
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

          const predictedFutureGain = this.gainPredictor.predictMultiLevelGain(
            newState.text,
            newState.availablePatterns,
            this.lookAheadDepth,
          )
          newState.predictedScore = newState.score + predictedFutureGain

          this.searchGraph.nodes.push({
            id: newStateId,
            text: newText,
            replacements: newState.replacements.map((r) => `${r.token}:${r.string}`),
            size: newText.length,
            depth: newState.depth,
            predictedGain: predictedFutureGain,
          })

          this.searchGraph.edges.push({
            source: state.id,
            target: newStateId,
            pattern: pattern.string,
            gain: pattern.gain,
            predictedGain: predictedFutureGain,
          })

          if (newState.depth > this.searchGraph.maxDepth) {
            this.searchGraph.maxDepth = newState.depth
          }

          candidates.push(newState)
        }
        candidates.push(state)
      }

      if (candidates.length === 0) break

      this.sortCandidates(candidates, options)

      const seenTexts = new Set<string>()
      const uniqueCandidates: State[] = []
      for (const cand of candidates) {
        if (!seenTexts.has(cand.text)) {
          seenTexts.add(cand.text)
          uniqueCandidates.push(cand)
        }
      }

      beam = uniqueCandidates.slice(0, this.maxBeamWidth)

      if (beam[0].score > bestSolution.score) {
        bestSolution = beam[0]
      }

      if (
        beam[0].availablePatterns.length === 0 ||
        (beam[0].availablePatterns.length > 0 && beam[0].availablePatterns[0].gain <= 0) ||
        beam[0].replacements.length >= this.maxReplacements
      ) {
        break
      }
    }

    const bestNodeIndex = this.searchGraph.nodes.findIndex((node) => node.id === bestSolution.id)
    if (bestNodeIndex !== -1) {
      this.searchGraph.nodes[bestNodeIndex].isBestSolution = true
    }

    this.searchGraph.bestPath = this.reconstructBestPath(bestSolution.id)

    s = bestSolution.text
    const tokens = bestSolution.tokens
    packerData.matchesLookup = bestSolution.replacements

    for (const match of bestSolution.replacements) {
      details += `${match.token.charCodeAt(0)}(${match.token}) : gain=${match.gain}, N=${match.copies}, str = ${match.string}\n`
    }

    const loopInitCode = options.useES6 ? ";for(i of" : ";for(i in G="
    const loopMemberCode = options.useES6 ? "i" : "G[i]"

    let packedString = this.stringHelper.matchAndReplaceAll(s, false, "\\", "\\\\", "", "", 0, [])
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

    const outputStr =
      unpackBlock1 +
      packedString +
      unpackBlock2 +
      packerData.wrappedInit +
      unpackBlock3 +
      packerData.environment +
      packerData.interpreterCall

    details += "\n------------------------\n"
    details += `Original size: ${packerData.contents.length} bytes\n`
    details += `Compressed size: ${s.length} bytes\n`
    details += `Decoder size: ${unpackBlock1.length + unpackBlock2.length + unpackBlock3.length} bytes\n`
    details += `Total size: ${outputStr.length} bytes\n`
    details += `Compression ratio: ${((outputStr.length / packerData.contents.length) * 100).toFixed(2)}%\n`
    details += `Algorithm: SlowPack (Beam Search width=${this.maxBeamWidth}, Max Replacements=${this.maxReplacements})\n`
    details += `Search graph: ${this.searchGraph.nodes.length} nodes, ${this.searchGraph.edges.length} edges\n`

    return {
      length: this.getByteLength(outputStr),
      output: outputStr,
      details,
    }
  }
}
