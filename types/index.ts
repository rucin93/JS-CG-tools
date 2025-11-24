export interface Match {
  token: string
  string: string
  originalString: string
  depends: string
  usedBy: string
  gain: number
  copies: number
  len: number
  score: number
  cleared: boolean
  newOrder: number
}

export interface PackerOptions {
  crushGainFactor: number
  crushLengthFactor: number
  crushCopiesFactor: number
  crushTiebreakerFactor: number
  useES6: boolean
  useBranchSearch?: boolean // New option for branch search
  branchFactor?: number // How many branches to explore at each level
  maxBranchDepth?: number // Maximum depth of branch search
  maxStates?: number // Maximum number of states to explore
  waitingForTrigger?: boolean // Whether we're waiting for manual trigger
  onProgress?: (progress: ProgressInfo) => void // Progress callback
  onComplete?: (result: PackerResult) => void // Callback when worker completes
  beamWidth?: number // Added beam width parameter for beam search
  lookAheadDepth?: number // Added look-ahead depth parameter for multi-level gain predictions
}

export interface ProgressInfo {
  progress: number // 0-1 progress value
  stage: string // Current stage of processing
  message: string // Human-readable message
  details?: string // Additional details
}

export interface PackerResult {
  length: number
  output: string
  details: string
  transform?: any[]
  isRunning?: boolean // Indicates if the worker is still running
}

export interface ThermalMapping {
  inLength: number
  outLength: number
  complete: boolean
  chapter?: number
  rangeIn: number[]
  rangeOut: number[]
}
