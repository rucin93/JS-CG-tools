export class StringHelper {
  private static instance: StringHelper

  private constructor() {}

  public static getInstance(): StringHelper {
    if (!StringHelper.instance) {
      StringHelper.instance = new StringHelper()
    }
    return StringHelper.instance
  }

  public getByteLength(normalVal: string): number {
    const str = String(normalVal)
    let byteLen = 0

    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i)
      byteLen +=
        c < 1 << 7
          ? 1
          : c < 1 << 11
            ? 2
            : c < 1 << 16
              ? 3
              : c < 1 << 21
                ? 4
                : c < 1 << 26
                  ? 5
                  : c < 1 << 31
                    ? 6
                    : Number.NaN
    }

    return byteLen
  }

  public getCharacterLength(unicode: number): number {
    let byteLen =
      unicode < 1 << 7
        ? 1
        : unicode < 1 << 11
          ? 2
          : unicode < 1 << 16
            ? 3
            : unicode < 1 << 21
              ? 4
              : unicode < 1 << 26
                ? 5
                : unicode < 1 << 31
                  ? 6
                  : Number.NaN

    byteLen += unicode === 92 ? 1 : 0 // Add 1 for backslash which needs escaping
    return byteLen
  }

  public unicodeToBase64(str: string): string {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(Number.parseInt("0x" + p1, 16))
      }),
    )
  }

  public base64ToUnicode(str: string): string {
    return decodeURIComponent(
      Array.from(atob(str))
        .map((c) => {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
        })
        .join(""),
    )
  }

  public isActualCodeAt(index: number, data: any): boolean {
    return true // Simplified implementation
  }

  public matchAndReplaceAll(
    input: string,
    matchExp: RegExp | false,
    originalText: string,
    replacementText: string,
    prefix: string,
    suffix: string,
    extraMapping: any,
    thermalMap: any[],
  ): string {
    let output = prefix
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

    output += suffix

    return output
  }

  public matchAndReplaceFirstAndAll(
    input: string,
    matchExp: RegExp | false,
    originalText: string,
    firstReplacement: string,
    otherReplacement: string,
    prefix: string,
    suffix: string,
    extraMapping: any,
    thermalMap: any[],
  ): string {
    const firstIndex = input.indexOf(originalText)
    if (firstIndex === -1) return input

    const firstPart = input.substring(0, firstIndex) + firstReplacement
    const restPart = input.substring(firstIndex + originalText.length)

    // Replace all other occurrences
    const restWithReplacements = restPart.replace(new RegExp(originalText, "g"), otherReplacement)

    return firstPart + restWithReplacements
  }

  public writeCharToRegexpCharClass(charCode: number): string {
    let output = ""
    if (charCode > 255) {
      output = "\\u" + (charCode < 4096 ? "0" : "") + charCode.toString(16)
    } else if (charCode > 127) {
      output = "\\x" + charCode.toString(16)
    } else {
      output = (this.needsEscapingInCharClass(charCode) ? "\\" : "") + String.fromCharCode(charCode)
    }
    return output
  }

  public writeRangeToRegexpCharClass(first: number, last: number): string {
    const length = last - first + 1
    let output = length > 0 ? this.writeCharToRegexpCharClass(first) : ""
    output += length > 2 ? "-" : ""
    if (length > 1) {
      output += this.writeCharToRegexpCharClass(last)
    }
    return output
  }

  public needsEscapingInCharClass(ascii: number): boolean {
    return ascii === 92 || ascii === 93 || ascii === 96
  }
}

export const getByteCount = (str: string): number => {
  return new Blob([str]).size
}