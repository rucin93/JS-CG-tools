import { StringHelper } from "../utils/StringHelper"
import type { Match } from "../types"

export class PatternAnalyzer {
  private stringHelper: StringHelper

  constructor() {
    this.stringHelper = StringHelper.getInstance()
  }

  private getByteLength(inString: string): number {
    return encodeURI(inString).replace(/%../g, "i").length
  }

  private getEscapedByteLength(inString: string): number {
    return this.getByteLength(inString.replace(/\\/g, "\\\\"))
  }

  public findAllPotentialPatterns(s: string): Match[] {
    const patterns: Match[] = []
    const matches: Record<string, number> = {}

    // Search for patterns from length 2 up to half the string length (capped at 500)
    for (let length = Math.min(Math.floor(s.length / 2), 500); length >= 2; length--) {
      for (let i = 0; i <= s.length - length; i++) {
        const beginCode = s.charCodeAt(i)
        const endCode = s.charCodeAt(i + length - 1)

        // Avoid splitting surrogate pairs
        if ((beginCode < 0xdc00 || beginCode > 0xdfff) && (endCode < 0xd800 || endCode > 0xdbff)) {
          const pattern = s.substr(i, length)
          if (matches[pattern] !== undefined) continue

          let count = 0
          let pos = -1
          while ((pos = s.indexOf(pattern, pos + 1)) !== -1) {
            count++
          }

          if (count >= 2) {
            matches[pattern] = count
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
              score: gain,
              cleared: false,
              newOrder: 9999,
            })
          }
        }
      }
    }
    return patterns
  }

  public updatePatternStats(patterns: Match[], text: string): void {
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i]
      let count = 0
      let pos = 0
      while ((pos = text.indexOf(pattern.string, pos)) !== -1) {
        count++
        pos += pattern.string.length
      }
      pattern.copies = Math.max(count, 1)
      pattern.gain = count * pattern.len - count - pattern.len - 2
      pattern.score = pattern.gain
    }
    for (let i = patterns.length - 1; i >= 0; i--) {
      if (patterns[i].copies < 2 || patterns[i].gain <= 0) {
        patterns.splice(i, 1)
      }
    }
  }

  public sortPatterns(patterns: Match[]): void {
    patterns.sort((a, b) => {
      if (b.gain !== a.gain) return b.gain - a.gain
      if (b.len !== a.len) return b.len - a.len
      return b.copies - a.copies
    })
  }
}
