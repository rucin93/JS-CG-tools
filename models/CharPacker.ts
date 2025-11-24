import { twoOnePlus } from "./2To1plus"

/**
 * Character Packer implementations
 * These packers encode multiple characters into single characters to reduce string length
 */

// Base class for all character packers
export abstract class CharPacker {
  abstract name: string
  abstract description: string

  // Pack the input string
  abstract pack(input: string): { packed: string; mapping?: any }

  // Unpack the packed string (for verification)
  abstract unpack(packed: string): string

  // Generate the decoder function as a string
  abstract getDecoderCode(varName: string): string
}

// 2-1 Packer: Packs 2 characters into 1 using a simple mapping
export class Packer2To1 extends CharPacker {
  name = "2-1 Packer"
  description = "Packs 2 characters into 1 using Unicode characters"

  pack(input: string): { packed: string; mapping: any } {
    try {
      let result = ""
      // Ensure even length by adding a space if needed
      if (input.length % 2) input += " "

      // Pack pairs of characters into surrogate pairs
      for (let a = 0; input.length > a; a += 2) {
        const char1 = input.charCodeAt(a)
        const char2 = input.charCodeAt(a + 1)
        result += String.fromCharCode(55296 + char1) + String.fromCharCode(56320 + char2)
      }

      // Return the packed string and null for mapping (this packer doesn't use a mapping)
      return {
        packed: "eval(unescape(escape`" + result + "`.replace(/u../g,'')))",
        mapping: null,
      }
    } catch (e) {
      console.error("Error in 2-1 packer:", e)
      return {
        packed: "Error packing input",
        mapping: null,
      }
    }
  }

  unpack(packed: string): string {
    // This is just for demonstration - in real usage, we'd need the mapping
    return packed
  }

  getDecoderCode(varName: string): string {
    return `function unpack${this.name.replace(/[^a-zA-Z0-9]/g, "")}(${varName}) {
  return eval(unescape(escape\`${varName}\`.replace(/u../g,'')));
}`
  }
}

// 2-1 Plus Packer: Enhanced version with better pair selection
export class Packer2To1Plus extends CharPacker {
  name = "2-1+ Packer"
  description = "Enhanced 2-1 packer with frequency-based pair selection"

  pack(input: string): { packed: string; mapping?: any } {
    return { packed: twoOnePlus(input, true) }
  }

  unpack(packed: string): string {
    // This is just for demonstration - in real usage, we'd need the mapping
    return packed
  }

  getDecoderCode(varName: string): string {
    return `function unpack${this.name.replace(/[^a-zA-Z0-9]/g, "")}(${varName}) {
  return eval(unescape(escape\`${varName}\`.replace(/u../g,'')));
}`
  }
}

// 3-1 Packer: Packs 3 characters into 1
export class Packer3To1 extends CharPacker {
  name = "3-1 Packer"
  description = "Packs 3 characters into 1 using Unicode characters"

  pack(code: string): { packed: string; mapping?: any } {
    let u = ""
    const m = 95
    const r = 32
    const mod = (n, m) => ((n % m) + m) % m
    code = ";" + code.replace(/(\r\n|\n|\r)/gm, "\\n")
    code += "//"
    code += " ".repeat((code.length * 2) % 3)
    const step = code.length / 3
    for (let i = 0; i < step; i++) {
      const [a, b, c] = [code[i + 2 * step], code[i + step], code[i]].map((c) => c.charCodeAt(0) - r)
      const x = mod(a - b, m + 1) * m + a
      let y = mod(((m + 1) / 2) * (x - c), m + 2) * m * (m + 1) + x
      if (y >= 0xd800 && y <= 0xdfff) y += m * (m + 1) * (m + 2)
      u += String.fromCodePoint(y)
    }

    return { packed: `for(_=i=98;i--;)for(c of\`${u}\`)_+=String.fromCharCode(c.codePointAt()%i+32);eval(_)` }
  }

  unpack(packed: string): string {
    // This is just for demonstration - in real usage, we'd need the mapping
    return packed
  }

  getDecoderCode(varName: string): string {
    return `function unpack${this.name.replace(/[^a-zA-Z0-9]/g, "")}(${varName}) {
  let _ = "";
  let i = 98;
  while (i--) {
    for (let c of ${varName}) {
      _ += String.fromCharCode(c.codePointAt(0) % i + 32);
    }
  }
  return eval(_);
}`
  }
}

// 4-1 Packer: Packs 4 characters into 1
export class Packer4To1 extends CharPacker {
  name = "4-1 Packer"
  description = "Packs 4 characters into 1 using Unicode characters"

  pack(code: string): { packed: string; mapping?: any } {
    const s = ";" + code
    let V = ""
    const W = [...new Set([...(";" + s)])].join("")

    let S = 0
    let q = ""
    for (let i = 0; (q = s[i]) || i % 4; ++i) {
      S += q ? W.indexOf(q) << ((i % 2) * 5) : 0
      i % 2 ? ((V += String.fromCharCode(((i % 4 == 1 ? 54 : 55) << 10) + S)), (S = 0)) : 0
    }
    return {
      packed: `for(I=O="";I<1e5;)O+=\`${W.replace(/`/g, "\\`")}\`["${V}".charCodeAt(I/2)>>I++%2*5&31];eval(O)`,
    }
  }

  unpack(packed: string): string {
    // This is just for demonstration - in real usage, we'd need the mapping
    return packed
  }

  getDecoderCode(varName: string): string {
    return `function unpack${this.name.replace(/[^a-zA-Z0-9]/g, "")}(${varName}) {
  const parts = ${varName}.split(';');
  const charset = parts[0];
  const encoded = parts[1];
  let output = "";
  for (let I = 0; I < 1e5 && output.length < 1e5; I++) {
    const charIndex = encoded.charCodeAt(I/2) >> (I++ % 2 * 5) & 31;
    if (charIndex >= charset.length) break;
    output += charset[charIndex];
  }
  return output;
}`
  }
}

// Factory to get the appropriate packer
export function getCharPacker(type: string): CharPacker {
  switch (type) {
    case "2-1":
      return new Packer2To1()
    case "2-1+":
      return new Packer2To1Plus()
    case "3-1":
      return new Packer3To1()
    case "4-1":
      return new Packer4To1()
    default:
      return new Packer2To1()
  }
}
