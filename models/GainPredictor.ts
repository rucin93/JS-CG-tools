import { StringHelper } from "../utils/StringHelper"
import type { Match } from "../types"
import { PatternAnalyzer } from "./PatternAnalyzer"

export class GainPredictor {
  private stringHelper: StringHelper
  private patternAnalyzer: PatternAnalyzer
  private predictionCache: Map<string, number> = new Map()

  constructor() {
    this.stringHelper = StringHelper.getInstance()
    this.patternAnalyzer = new PatternAnalyzer()
  }

  public clearCache(): void {
    this.predictionCache.clear()
  }

  public predictMultiLevelGain(
    text: string,
    availablePatterns: Match[],
    lookAheadDepth: number,
    depth = 0,
    usedTokens: string[] = [],
  ): number {
    if (this.predictionCache.has(text)) {
      return this.predictionCache.get(text)!
    }

    if (depth >= lookAheadDepth || availablePatterns.length === 0) {
      return 0
    }

    const patterns = JSON.parse(JSON.stringify(availablePatterns))
    this.patternAnalyzer.updatePatternStats(patterns, text)
    this.patternAnalyzer.sortPatterns(patterns)

    if (patterns.length === 0 || patterns[0].gain <= 0) {
      this.predictionCache.set(text, 0)
      return 0
    }

    const pattern = patterns[0]
    let c = ""
    for (let i = 122; !c && i > 0; i--) {
      const token = String.fromCharCode(i)
      if (text.indexOf(token) === -1 && !usedTokens.includes(token)) {
        c = token
      }
    }

    if (!c) {
      this.predictionCache.set(text, pattern.gain)
      return pattern.gain
    }

    const newText = this.stringHelper.matchAndReplaceAll(text, false, pattern.string, c, "", c + pattern.string, 0, [])
    const remainingPatterns = patterns.filter((p: Match) => p.string !== pattern.string)
    const futureGain = this.predictMultiLevelGain(
      newText,
      remainingPatterns,
      lookAheadDepth,
      depth + 1,
      [...usedTokens, c],
    )

    const discountFactor = 1.0
    const result = pattern.gain + discountFactor * futureGain

    this.predictionCache.set(text, result)
    return result
  }
}
