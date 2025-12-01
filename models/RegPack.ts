import { StringHelper } from "../utils/StringHelper"
import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult } from "../types"
import { RegExpPacker } from "./RegExpPacker"

export class RegPack {
  private stringHelper: StringHelper
  private regExpPacker: RegExpPacker

  constructor() {
    this.stringHelper = StringHelper.getInstance()
    this.regExpPacker = new RegExpPacker()
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
      const output2 = this.regExpPacker.packToRegexpCharClass(inputData, options)
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
}
