import { PackerData } from "./PackerData"
import type { PackerOptions, PackerResult } from "../types"
import { BeamSearchSolver } from "./BeamSearchSolver"
import { RegExpPacker } from "./RegExpPacker"

/**
 * SlowPack - A packer using Beam Search and Dynamic Programming (Memoization)
 * to find optimal replacements.
 */
export class SlowPack {
  private beamSearchSolver: BeamSearchSolver
  private regExpPacker: RegExpPacker

  constructor() {
    this.beamSearchSolver = new BeamSearchSolver()
    this.regExpPacker = new RegExpPacker()
  }

  public getSearchGraph() {
    return this.beamSearchSolver.getSearchGraph()
  }

  public runPacker(input: string, options: PackerOptions): PackerData[] {
    try {
      const inputData = new PackerData("SlowPack", input)

      // First stage: Beam Search + DP
      const output = this.beamSearchSolver.findOptimalReplacements(inputData, options)
      inputData.result.push(output)

      // Second stage: Decoder generation (same as RegPack)
      const output2 = this.regExpPacker.packToRegexpCharClass(inputData, options)
      inputData.result.push(output2)

      console.log(inputData)

      return [inputData]
    } catch (error) {
      console.error("Error in SlowPack:", error)
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
}
