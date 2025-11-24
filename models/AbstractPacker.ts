import { StringHelper } from "../utils/StringHelper"
import type { PackerData } from "./PackerData"
import type { PackerOptions } from "../types"

/**
 * Abstract base class for all JavaScript packers
 * Contains common functionality shared between different packer implementations
 */
export abstract class AbstractPacker {
  protected stringHelper: StringHelper

  // Common configuration for search strategies
  protected maxBranchingFactor = 5 // Maximum number of branches to explore at each level
  protected maxDepth = 15 // Maximum depth of the search tree
  protected timeLimit = 5000 // Time limit in milliseconds to prevent excessive computation

  constructor() {
    this.stringHelper = StringHelper.getInstance()
  }

  /**
   * Main entry point that should be implemented by all packers
   * @param input A string containing the program to pack
   * @param options An object detailing the different options for the preprocessor and packer
   * @return An array of PackerData, each containing the code packed with different settings
   */
  public abstract runPacker(input: string, options: PackerOptions): PackerData[]

  /**
   * Returns the total byte length of a string "as is" (with no further escaping)
   */
  protected getByteLength(inString: string): number {
    return encodeURI(inString).replace(/%../g, "i").length
  }

  /**
   * Returns the byte length of a string after escaping
   */
  protected getEscapedByteLength(inString: string): number {
    return this.getByteLength(inString.replace(/\\/g, "\\\\"))
  }

  /**
   * Escape special characters in a string for use in a regular expression
   */
  protected escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /**
   * Find all patterns in the string that appear at least twice
   */
  protected findAllPotentialMatches(s: string): Record<string, number> {
    const matches: Record<string, number> = {}

    // Find all substrings that appear at least twice
    let found = true
    for (let t = 2; found; ++t) {
      found = false
      for (let i = 0; i < s.length - t; ++i) {
        const beginCode = s.charCodeAt(i)
        const endCode = s.charCodeAt(i + t - 1)

        // If the first character is a low surrogate or the last character is a high surrogate, skip it
        if ((beginCode < 0xdc00 || beginCode > 0xdfff) && (endCode < 0xd800 || endCode > 0xdbff)) {
          const x = s.substr(i, t)
          if (!matches[x]) {
            let j = s.indexOf(x, i + t)
            if (j !== -1) {
              found = true
              matches[x] = 1
              while (j !== -1) {
                matches[x]++
                j = s.indexOf(x, j + t)
              }
            }
          }
        }
      }
    }

    return matches
  }

  /**
   * Update matches after a replacement
   */
  protected updateMatchesAfterReplacement(
    matches: Record<string, number>,
    replacedPattern: string,
    token: string,
    newString: string,
  ): Record<string, number> {
    const newMatches: Record<string, number> = {}

    // Update existing matches
    for (const pattern in matches) {
      // Skip the pattern we just replaced
      if (pattern === replacedPattern) continue

      // Update pattern if it contains the replaced pattern
      const updatedPattern = pattern.split(replacedPattern).join(token)

      // Count occurrences in the new string
      let count = 0
      let pos = -1
      while ((pos = newString.indexOf(updatedPattern, pos + 1)) !== -1) {
        count++
      }

      if (count >= 2) {
        newMatches[updatedPattern] = count
      }
    }

    // Find new patterns that might have been created
    for (let length = Math.min(20, Math.floor(newString.length / 4)); length >= 2; length--) {
      for (let i = 0; i < newString.length - length; i++) {
        const pattern = newString.substring(i, i + length)

        // Skip if already processed
        if (newMatches[pattern] !== undefined) continue

        // Count occurrences
        let count = 0
        let pos = -1
        while ((pos = newString.indexOf(pattern, pos + 1)) !== -1) {
          count++
        }

        if (count >= 2) {
          newMatches[pattern] = count
        }
      }
    }

    return newMatches
  }

  /**
   * Clears a match from matchesLookup for dependencies in the PackerData
   */
  protected clear(packerData: PackerData, matchIndex: number): void {
    const oldToken = packerData.matchesLookup![matchIndex].token
    for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
      packerData.matchesLookup![j].usedBy = packerData.matchesLookup![j].usedBy.split(oldToken).join("")
    }
    packerData.matchesLookup![matchIndex].cleared = true
  }

  /**
   * Calculate the score for a pattern using the provided options
   */
  protected calculateScore(pattern: string, copies: number, options: PackerOptions): { gain: number; score: number } {
    const patternLength = this.getEscapedByteLength(pattern)
    const gain = copies * patternLength - copies - patternLength - 2

    if (gain <= 0) {
      return { gain, score: -1 }
    }

    const score =
      options.crushGainFactor * gain + options.crushLengthFactor * patternLength + options.crushCopiesFactor * copies

    return { gain, score }
  }

  /**
   * Verify the unpacking works correctly
   */
  protected verifyUnpacking(original: string, compressed: string, tokenString: string, delimiter: string): string {
    let details = "------------------------\nFinal check: "

    // Unescape the string for testing
    let testString = compressed.replace(new RegExp("\\\\" + delimiter, "g"), delimiter)
    testString = testString.replace(/\\\\/g, "\\")

    // Simulate the unpacking process
    const regToken = new RegExp("[" + tokenString + "]", "")
    for (let token = ""; (token = regToken.exec(testString)); ) {
      const k = testString.split(token)
      testString = k.join(k.shift())
    }

    const success = testString === original
    details += (success ? "passed" : "failed") + ".\n"

    return details
  }
}
