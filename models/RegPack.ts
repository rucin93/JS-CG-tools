import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult } from "../types"

export class RegPack {
  private stringHelper: StringHelper

  constructor() {
    this.stringHelper = StringHelper.getInstance()
  }

  /**
   * Main entry point for RegPack
   * @param input A string containing the program to pack
   * @param options An object detailing the different options for the preprocessor and packer
   * @return An array of PackerData, each containing the code packed with different settings
   */
  public runPacker(input: string, options: PackerOptions): PackerData[] {
    try {
      const inputData = new PackerData("", input)

      // First stage: configurable crusher
      const output = this.findRedundancies(inputData, options)
      inputData.result.push(output)

      // Second stage: convert token string to regexp
      const output2 = this.packToRegexpCharClass(inputData, options)
      inputData.result.push(output2)

      return [inputData]
    } catch (error) {
      console.error("Error in RegPack:", error)
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
   * First stage: apply the algorithm common to First Crush and JS Crush
   */
  private findRedundancies(packerData: PackerData, options: PackerOptions): PackerResult {
    let s = packerData.contents
    packerData.matchesLookup = []
    let details = ""

    // 34(") and 39(') now allowed, as long as they are not the chosen delimiter
    const delimiterCode = packerData.packedStringDelimiter.charCodeAt(0)
    const Q: string[] = []
    for (let i = 0; ++i < 127; ) {
      if (i - 96 && i - 13 && i - delimiterCode && i - 92) {
        Q.push(String.fromCharCode(i))
      }
    }

    const matches: Record<string, number> = {}
    let tokens = ""

    // Main compression loop
    while (true) {
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

      if (tokens.length === 1) {
        // First token: search all string space for possible matches
        let found = true // stop as soon as no substring of length t is found twice
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
      } else {
        // Subsequent tokens: only recompute the values of previously found matches
        const newMatches: Record<string, number> = {}
        for (const x in matches) {
          let j = s.indexOf(x)
          newMatches[x] = 0
          while (j !== -1) {
            newMatches[x]++
            j = s.indexOf(x, j + x.length)
          }
        }
        Object.assign(matches, newMatches)
      }

      // Find the best match to replace
      let bestLength = 0,
        bestValue = 0,
        M = 0,
        N = 0,
        e = "",
        Z = 0

      for (const i in matches) {
        const j = this.getEscapedByteLength(i)
        const R = matches[i]
        Z = R * j - R - j - 2 // -1 used in JS Crush performs replacement with zero gain
        const value = options.crushGainFactor * Z + options.crushLengthFactor * j + options.crushCopiesFactor * R

        if (Z > 0) {
          if (
            value > bestValue ||
            (bestValue === value &&
              (Z > M || (Z === M && options.crushTiebreakerFactor * R > options.crushTiebreakerFactor * N)))
          ) {
            M = Z
            N = R
            e = i
            bestValue = value
            bestLength = j
          }
        } else if (R < 2) {
          delete matches[i]
        }
      }

      if (M < 1) break

      // Update the other matches in case the selected one is a substring thereof
      const newMatches: Record<string, number> = {}
      for (const x in matches) {
        newMatches[x.split(e).join(c)] = 1
      }
      Object.assign(matches, newMatches)

      // Apply the compression to the string
      s = this.stringHelper.matchAndReplaceAll(s, false, e, c, "", c + e, 0, [])

      packerData.matchesLookup.push({
        token: c,
        string: e,
        originalString: e,
        depends: "",
        usedBy: "",
        gain: M,
        copies: N,
        len: bestLength,
        score: bestValue,
        cleared: false,
        newOrder: 9999,
      })

      details += c.charCodeAt(0) + "(" + c + ") : val=" + bestValue + ", gain=" + M + ", N=" + N + ", str = " + e + "\n"
    }

    // List matches that did not find a token
    // First, update the matches count
    const newMatches: Record<string, number> = {}
    for (const x in matches) {
      let j = s.indexOf(x)
      newMatches[x] = 0
      while (j !== -1) {
        newMatches[x]++
        j = s.indexOf(x, j + x.length)
      }
    }
    Object.assign(matches, newMatches)

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
        packerData.matchesLookup.push({
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

    // Show the patterns that are "almost" gains
    firstLine = true
    for (const i in matches) {
      const j = this.getEscapedByteLength(i)
      const R = matches[i]
      const Z = R * j - R - j - 2
      const Z1 = (R + 1) * j - (R + 1) - j - 2

      if (Z <= 0 && Z1 > 0) {
        if (firstLine) {
          details += "\n--- One extra occurrence needed for a gain --\n"
          firstLine = false
        }
        const value = options.crushGainFactor * Z1 + options.crushLengthFactor * j + options.crushCopiesFactor * R
        details +=
          "   val=" + value + ", gain=" + Z + "->" + Z1 + " (+" + (Z1 - Z) + "), N=" + R + ", str = " + i + "\n"
      }
    }

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

    const envMapping = [
      { inLength: packedString.length, outLength: packedString.length, complete: false },
      {
        chapter: 1,
        rangeIn: [0, packedString.length],
        rangeOut: [0, unpackBlock1.length + unpackBlock2.length + unpackBlock3.length],
      },
    ]

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

    const envMapping = [
      { inLength: checkedString.length, outLength: checkedString.length, complete: false },
      {
        chapter: 1,
        rangeIn: [0, checkedString.length],
        rangeOut: [0, unpackBlock1.length + unpackBlock2.length + unpackBlock3.length],
      },
    ]

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
