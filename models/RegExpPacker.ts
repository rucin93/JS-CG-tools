import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult } from "../types"

export class RegExpPacker {
  private stringHelper: StringHelper

  constructor() {
    this.stringHelper = StringHelper.getInstance()
  }

  private getByteLength(inString: string): number {
    return encodeURI(inString).replace(/%../g, "i").length
  }

  private clear(packerData: PackerData, matchIndex: number): void {
    const oldToken = packerData.matchesLookup![matchIndex].token
    for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
      packerData.matchesLookup![j].usedBy = packerData.matchesLookup![j].usedBy.split(oldToken).join("")
    }
    packerData.matchesLookup![matchIndex].cleared = true
  }

  public packToRegexpCharClass(packerData: PackerData, options: PackerOptions): PackerResult {
    let details = ""

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
      if (i !== packerData.packedStringDelimiter.charCodeAt(0) && packerData.contents.indexOf(token) === -1) {
        if (firstInLine === -1) {
          firstInLine = i
        }
      } else {
        if (firstInLine > -1) {
          if (firstInLine === 13) ++firstInLine
          let lastInLine = i - 1
          if (i === 11 || i === 14) --lastInLine
          if (lastInLine >= firstInLine) {
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

    tokenList.sort((a, b) => {
      return 10 * b.oneByteTokenCount - b.cost + b.first / 1000 - (10 * a.oneByteTokenCount - a.cost + a.first / 1000)
    })

    const costOneTokens: number[] = []
    const costTwoTokens: number[] = []
    for (let tokenLine = 0; tokenLine < tokenList.length; ++tokenLine) {
      for (let i = tokenList[tokenLine].first; i <= tokenList[tokenLine].last; ++i) {
        if (i !== 13) {
          if (i === 92) costTwoTokens.push(i)
          else costOneTokens.push(i)
        }
      }
    }

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
          const score = gain

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

          this.clear(packerData, matchIndex)

          ++packerData.tokenCount
          if (packerData.tokenCount >= availableTokens.length) {
            tokensRemaining = false
            details += "Out of tokens\n"
          }
        } else {
          for (let j = 0; j < packerData.matchesLookup!.length; ++j) {
            if (!packerData.matchesLookup![j].cleared) {
              details += "skipped str = " + packerData.matchesLookup![j].originalString + "\n"
            }
          }
          gainsRemaining = false
        }
      }
    }

    let tokenLine = 0
    let tokenIndex = 0
    const unusedBackslash =
      availableTokens.length > 0 &&
      availableTokens[availableTokens.length - 1] === 92 &&
      packerData.tokenCount < availableTokens.length

    if (tokenList.length === 0) {
      details += "No tokens available\nFinal check: failed"
      return { length: -1, output: "", details }
    }

    if (packerData.tokenCount >= availableTokens.length) {
      tokenLine = tokenList.length - 1
      tokenIndex = tokenList[tokenList.length - 1].count
    } else if (packerData.tokenCount > 0) {
      const lastTokenUsed = availableTokens[packerData.tokenCount - 1]
      let lineFound = false

      while (!lineFound && tokenLine < tokenList.length) {
        if (unusedBackslash && tokenList[tokenLine].first === 92) {
          ++tokenList[tokenLine].first
          --tokenList[tokenLine].count
        }
        if (unusedBackslash && tokenList[tokenLine].last === 92) {
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

    if (tokenLine >= tokenList.length) {
      details += "Exception: token out of range\nFinal check: failed"
      return { length: -1, output: "", details }
    }

    let remainingTokens = tokenList[tokenLine].count - tokenIndex
    tokenList[tokenLine].last -= remainingTokens
    tokenList[tokenLine].count = tokenIndex

    if (remainingTokens > 0) {
      const tokensToReplace: Array<{
        rangeIndex: number
        atBeginning: boolean
        count: number
      }> = []

      for (let i = 0; i <= tokenLine; ++i) {
        if (tokenList[i].first === 93) {
          tokensToReplace.push({ rangeIndex: i, atBeginning: true, count: 1 })
        } else if (tokenList[i].last === 93) {
          tokensToReplace.push({ rangeIndex: i, atBeginning: false, count: 1 })
        }
      }

      for (let i = 0; i < tokensToReplace.length; ++i) {
        if (remainingTokens >= tokensToReplace[i].count) {
          for (let j = 0; j < tokensToReplace[i].count; ++j) {
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

            --currentRange.count
            ++tokenList[tokenLine].count
            if (tokensToReplace[i].atBeginning) {
              ++currentRange.first
              if (unusedBackslash && currentRange.first === 92) {
                ++currentRange.first
                --currentRange.count
              }
            } else {
              --currentRange.last
              if (unusedBackslash && currentRange.last === 92) {
                --currentRange.last
                --currentRange.count
              }
            }
            if (tokensToReplace[i].rangeIndex === tokenLine) {
              --tokenIndex
            }
          }
        }
      }
    }

    if (tokenList.length > 1 && tokenList[0].first === 94) {
      const newFirstRange = tokenList.splice(1, 1)
      tokenList.unshift(newFirstRange[0])
    }

    let tokenString = ""
    for (let i = 0; i <= tokenLine; ++i) {
      const rangeString = this.stringHelper.writeRangeToRegexpCharClass(tokenList[i].first, tokenList[i].last)
      if (rangeString.charCodeAt(0) === 45) {
        tokenString = rangeString + tokenString
      } else {
        tokenString += rangeString
      }
    }

    let checkedString = this.stringHelper.matchAndReplaceAll(regPackOutput, false, "\\", "\\\\", "", "", 0, [])
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

    details += "------------------------\nFinal check: "
    let testString = checkedString.replace(
      new RegExp("\\\\" + packerData.packedStringDelimiter, "g"),
      packerData.packedStringDelimiter,
    )
    testString = testString.replace(/\\\\/g, "\\")
    const regToken = new RegExp("[" + tokenString + "]", "")
    let match: RegExpExecArray | null
    while ((match = regToken.exec(testString))) {
      const token = match[0]
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
