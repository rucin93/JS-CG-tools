import type { Match } from "../types"

export class PatternViewer {
  /**
   * Escapes special characters for display
   */
  private escapeChar(char: string): string {
    switch (char) {
      case '\n': return '\\n'
      case '\r': return '\\r'
      case '\t': return '\\t'
      case '\\': return '\\\\'
      default: return char
    }
  }

  /**
   * Produces an HTML render of the patterns used by the packer.
   * @param unpackedCode The original unpacked code (after preprocessing)
   * @param matchesLookup Pattern set from RegPack
   * @return A <div> object showing the patterns in the code
   */
  public render(unpackedCode: string, matchesLookup: Match[]): HTMLElement {
    // Create arrays storing whether each character is the beginning or the end of a pattern
    const patternBegin: number[] = []
    const patternEnd: number[] = []

    for (let i = 0; i <= unpackedCode.length; ++i) {
      patternBegin.push(0)
      patternEnd.push(0)
    }

    for (let j = 0; j < matchesLookup.length; ++j) {
      if (matchesLookup[j].token) {
        const pattern = matchesLookup[j].originalString
        let offset = -pattern.length
        while ((offset = unpackedCode.indexOf(pattern, pattern.length + offset)) > -1) {
          ++patternBegin[offset]
          ++patternEnd[pattern.length + offset]
        }
      }
    }

    const output = document.createElement("pre")
    output.setAttribute("class", "topLevel")
    const divStack: HTMLElement[] = []
    let currentNodeContents = ""
    let currentNode: HTMLElement = output
    let currentDepth = 0

    // Some patterns may contain the very end of the string, so we iterate one extra step
    for (let offset = 0; offset <= unpackedCode.length; ++offset) {
      for (let stepsDown = 0; stepsDown < patternEnd[offset]; ++stepsDown) {
        // Unstacking: close the span
        if (currentNodeContents !== "") {
          currentNode.appendChild(document.createTextNode(currentNodeContents))
          currentNodeContents = ""
        }
        currentNode = divStack.pop()!
        --currentDepth
      }

      for (let stepsUp = 0; stepsUp < patternBegin[offset]; ++stepsUp) {
        // Stacking spans
        if (currentNodeContents !== "") {
          currentNode.appendChild(document.createTextNode(currentNodeContents))
          currentNodeContents = ""
        }
        divStack.push(currentNode)
        const newSpan = document.createElement("span")
        newSpan.setAttribute("class", "depth" + Math.min(9, ++currentDepth))

        // Add title attribute with pattern information
        newSpan.setAttribute("title", `Pattern depth: ${currentDepth}`)

        currentNode.appendChild(newSpan)
        currentNode = newSpan
      }

      // Protect against overflow on that last character
      if (offset < unpackedCode.length) {
        currentNodeContents += this.escapeChar(unpackedCode[offset])
      }
    }

    // Append the last characters that are not part of a pattern
    if (currentNodeContents !== "") {
      currentNode.appendChild(document.createTextNode(currentNodeContents))
    }

    return output
  }
}
