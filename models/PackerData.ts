import type { Match } from "../types"

export class PackerData {
  public name: string
  public contents: string
  public log: string
  public environment: string
  public interpreterCall: string
  public wrappedInit: string
  public initialDeclarationOffset: number
  public packedCodeVarName: string
  public containedStrings: any[]
  public containedTemplateLiterals: any[]
  public packedStringDelimiter: string
  public result: any[]
  public matchesLookup?: Match[]
  public tokenCount?: number

  constructor(name = "", dataString = "") {
    this.name = name
    this.contents = dataString
    this.log = ""
    this.environment = ""
    this.interpreterCall = "eval(_)"
    this.wrappedInit = ""
    this.initialDeclarationOffset = 0
    this.packedCodeVarName = "_"
    this.containedStrings = []
    this.containedTemplateLiterals = []
    this.packedStringDelimiter = "`"
    this.result = []
  }

  public static clone(packerData: PackerData, nameSuffix: string): PackerData {
    const clone = new PackerData()
    clone.name = packerData.name + nameSuffix
    clone.contents = packerData.contents
    clone.log = packerData.log
    clone.environment = packerData.environment
    clone.interpreterCall = packerData.interpreterCall
    clone.wrappedInit = packerData.wrappedInit
    clone.initialDeclarationOffset = packerData.initialDeclarationOffset
    clone.packedCodeVarName = packerData.packedCodeVarName
    clone.containedStrings = [...packerData.containedStrings]
    clone.containedTemplateLiterals = [...packerData.containedTemplateLiterals]
    clone.packedStringDelimiter = packerData.packedStringDelimiter
    clone.result = []
    return clone
  }
}
