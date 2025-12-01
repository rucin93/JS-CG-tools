"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { Crusher, CrusherHeuristic } from "../models/Crusher"
import { RegPack } from "../models/RegPack"
import { Replacer } from "../models/Replacer"
import { PackerOptimizer, type OptimizationResult } from "../models/PackerOptimizer"
import { PatternViewer } from "./PatternViewer"
import type { PackerData } from "../models/PackerData"
import type { PackerOptions, ProgressInfo, PackerResult } from "../types"
import type { AbstractPacker } from "../models/AbstractPacker"
import { useInputStore } from "@/store/useInputStore"

// Add this import at the top
import SearchGraphVisualizer from "./SearchGraphVisualizer"

export default function CrusherPreview() {
  const { globalInput, setGlobalInput } = useInputStore()
  const input = globalInput
  const setInput = setGlobalInput

  const [output, setOutput] = useState("")
  const [regpackOutput, setRegpackOutput] = useState("")
  const [replacerOutput, setReplacerOutput] = useState("")
  const [details, setDetails] = useState("")
  const [options, setOptions] = useState<PackerOptions>({
    crushGainFactor: 2,
    crushLengthFactor: 1,
    crushCopiesFactor: 0,
    crushTiebreakerFactor: 1,
    useES6: true,
    useBranchSearch: false,
    branchFactor: 3,
    maxBranchDepth: 5,
    maxStates: 10000,
    beamWidth: 5, // Default beam width
    maxInt: 10, // Add maxInt option with default value
  })
  const [packerData, setPackerData] = useState<PackerData | null>(null)
  const [regpackData, setRegpackData] = useState<PackerData | null>(null)
  const [replacerData, setReplacerData] = useState<PackerData | null>(null)
  const [patternView, setPatternView] = useState<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState("output")
  const [error, setError] = useState<string | null>(null)
  const [comparisonMode, setComparisonMode] = useState(false)
  const [selectedHeuristic, setSelectedHeuristic] = useState<CrusherHeuristic>(CrusherHeuristic.BALANCED)
  const [selectedEncoder, setSelectedEncoder] = useState<string>("replacer")

  // Branch search state
  const [shouldRunCompression, setShouldRunCompression] = useState(false)
  const [isWaitingForTrigger, setIsWaitingForTrigger] = useState(false)
  const [branchSearchProgress, setBranchSearchProgress] = useState(0)
  const [branchSearchMessage, setBranchSearchMessage] = useState("")
  const [branchSearchDetails, setBranchSearchDetails] = useState("")
  const [isBranchSearching, setIsBranchSearching] = useState(false)
  const [workerResult, setWorkerResult] = useState<PackerResult | null>(null)

  // Add this state variable with the other state variables
  const [showSearchGraph, setShowSearchGraph] = useState(false)

  // Packer instances
  const regPackRef = useRef<RegPack>(new RegPack())
  const replacerRef = useRef<Replacer>(new Replacer(options.maxInt || 10))

  // Optimization state
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationProgress, setOptimizationProgress] = useState(0)
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null)
  const optimizerRef = useRef<PackerOptimizer | null>(null)

  // Heuristic optimization state
  const [isOptimizingHeuristic, setIsOptimizingHeuristic] = useState(false)
  const [heuristicResult, setHeuristicResult] = useState<{
    heuristic: CrusherHeuristic
    size: number
  }>()

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      replacerRef.current.terminate()
    }
  }, [])

  // Update crusher instance when heuristic changes
  useEffect(() => {
    replacerRef.current = new Replacer(options.maxInt || 10)
  }, [options.maxInt])

  // Effect to update waiting state when options change
  useEffect(() => {
    if (selectedEncoder === "replacer" && options.useBranchSearch && !shouldRunCompression) {
      setIsWaitingForTrigger(true)
    } else {
      setIsWaitingForTrigger(false)
    }
  }, [selectedEncoder, options.useBranchSearch, shouldRunCompression])

  // Progress callback for branch search
  const handleBranchSearchProgress = (progressInfo: ProgressInfo) => {
    setBranchSearchProgress(progressInfo.progress)
    setBranchSearchMessage(progressInfo.message)
    if (progressInfo.details) {
      setBranchSearchDetails(progressInfo.details)
    }

    // If the search is complete, update the UI
    if (progressInfo.stage === "complete") {
      setIsBranchSearching(false)
    }
  }

  // Callback when worker completes
  const handleWorkerComplete = (result: PackerResult) => {
    setWorkerResult(result)
    setOutput(result.output)
    setDetails(result.details)
    setIsBranchSearching(false)

    // Update pattern view if we have matchesLookup data
    if (packerData && packerData.matchesLookup) {
      try {
        const patternViewer = new PatternViewer()
        const patternElement = patternViewer.render(input, packerData.matchesLookup)
        setPatternView(patternElement)
      } catch (error) {
        console.error("Error generating pattern view:", error)
        setPatternView(null)
      }
    }
  }

  // Main effect for running compression
  useEffect(() => {
    if (!input) {
      setInput("") // Ensure input is at least an empty string
      return
    }

    if ((input || "").trim() === "") return

    // Skip automatic compression if branch search is enabled and we're in waiting mode
    if (selectedEncoder === "replacer" && options.useBranchSearch && !shouldRunCompression) {
      // Just show the waiting message without clearing previous results
      if (!output) {
        setDetails("Web Worker branch search is ready. Click 'Run Branch Search Compression' to start.")
      }
      return
    }

    try {
      setError(null)

      // Set branch searching flag if needed
      if (selectedEncoder === "replacer" && options.useBranchSearch && shouldRunCompression) {
        setIsBranchSearching(true)
        setBranchSearchProgress(0)
        setBranchSearchMessage("Initializing Web Worker...")
        setWorkerResult(null)
      }

      // Run all packers for comparison
      const regPack = regPackRef.current
      const replacer = replacerRef.current

      const regPackResult = regPack.runPacker(input, options)

      // Try to run Replacer, but handle the case where input contains digits
      let replacerResult: PackerData[] = []
      try {
        // Pass the waiting state and progress callback to the Replacer
        replacerResult = replacer.runPacker(input, {
          ...options,
          waitingForTrigger: selectedEncoder === "replacer" && options.useBranchSearch && !shouldRunCompression,
          onProgress:
            selectedEncoder === "replacer" && options.useBranchSearch ? handleBranchSearchProgress : undefined,
          onComplete: selectedEncoder === "replacer" && options.useBranchSearch ? handleWorkerComplete : undefined,
        })

        if (replacerResult && replacerResult.length > 0) {
          setReplacerData(replacerResult[0])

          if (replacerResult[0].result && replacerResult[0].result.length >= 1) {
            // If the result is from a worker and is still running, don't update the output
            if (replacerResult[0].result[0].isRunning) {
              // Just store the placeholder result
              setWorkerResult(replacerResult[0].result[0])
            } else {
              setReplacerOutput(replacerResult[0].result[0].output || "")
            }
          }
        }
      } catch (replacerError) {
        console.warn("Replacer error:", replacerError)
        setReplacerOutput(`Error: ${replacerError instanceof Error ? replacerError.message : String(replacerError)}`)
        setIsBranchSearching(false)
      }

      // Process results based on selected encoder
      if (selectedEncoder === "replacer" && replacerResult && replacerResult.length > 0) {
        // Only update if we're not in waiting mode or if we're explicitly running compression
        if (!options.useBranchSearch || shouldRunCompression) {
          setPackerData(replacerResult[0])

          if (replacerResult[0].result && replacerResult[0].result.length >= 1) {
            // If the result is from a worker and is still running, don't update the output
            if (replacerResult[0].result[0].isRunning) {
              // Just store the placeholder result and wait for the worker to complete
              setOutput("Running in Web Worker...")
              setDetails(replacerResult[0].result[0].details || "")
            } else {
              setOutput(replacerResult[0].result[0].output || "")
              setDetails(replacerResult[0].result[0].details || "")

              // Generate pattern view
              try {
                if (replacerResult[0].matchesLookup) {
                  const patternViewer = new PatternViewer()
                  const patternElement = patternViewer.render(input, replacerResult[0].matchesLookup)
                  setPatternView(patternElement)
                } else {
                  setPatternView(null)
                }
              } catch (patternError) {
                console.error("Error generating pattern view:", patternError)
                setPatternView(null)
              }
            }
          } else {
            setOutput("")
            setDetails("Error: No valid output generated")
            setError("Failed to generate output")
          }
        }
      }

      // Process RegPack results for comparison
      if (regPackResult && regPackResult.length > 0) {
        setRegpackData(regPackResult[0])

        if (regPackResult[0].result && regPackResult[0].result.length >= 2 && regPackResult[0].result[1]) {
          setRegpackOutput(regPackResult[0].result[1].output || "")
        } else if (regPackResult[0].result && regPackResult[0].result.length >= 1 && regPackResult[0].result[0]) {
          setRegpackOutput(regPackResult[0].result[0].output || "")
        }

        // Add this block to handle when regpack is selected as the encoder
        if (selectedEncoder === "regpack") {
          setPackerData(regPackResult[0])

          if (regPackResult[0].result && regPackResult[0].result.length >= 2 && regPackResult[0].result[1]) {
            setOutput(regPackResult[0].result[1].output || "")
            setDetails(regPackResult[0].result[1].details || "")
          } else if (regPackResult[0].result && regPackResult[0].result.length >= 1 && regPackResult[0].result[0]) {
            setOutput(regPackResult[0].result[0].output || "")
            setDetails(regPackResult[0].result[0].details || "")
          }

          // Generate pattern view for RegPack
          try {
            if (regPackResult[0].matchesLookup) {
              const patternViewer = new PatternViewer()
              const patternElement = patternViewer.render(input, regPackResult[0].matchesLookup)
              setPatternView(patternElement)
            } else {
              setPatternView(null)
            }
          } catch (patternError) {
            console.error("Error generating pattern view:", patternError)
            setPatternView(null)
          }
        }
      }
    } catch (error) {
      console.error("Error in processing:", error)
      setOutput("")
      setDetails(`Error: ${error instanceof Error ? error.message : String(error)}`)
      setPatternView(null)
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`)
      setIsBranchSearching(false)
    } finally {
      // Reset the trigger flag after processing
      if (shouldRunCompression) {
        setShouldRunCompression(false)
      }
    }
  }, [input, options, selectedHeuristic, selectedEncoder, shouldRunCompression])

  const handleOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    setOptions((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value === "" ? 0 : Number.parseFloat(value) || 0,
    }))
  }

  const startOptimization = async () => {
    if ((input || "").trim() === "") {
      setError("Please enter some code to optimize")
      return
    }

    setIsOptimizing(true)
    setOptimizationProgress(0)
    setError(null)

    try {
      // Get the current active packer based on selected encoder
      const activePacker: AbstractPacker = selectedEncoder === "replacer" ? replacerRef.current : regPackRef.current

      // Create a new optimizer with the active packer
      optimizerRef.current = new PackerOptimizer(activePacker, input, (result) => {
        setOptimizationProgress(result.progress)
        setOptimizationResult(result)
      })

      // Start the optimization process
      const result = await optimizerRef.current.findBestOptions()

      // Apply the best options
      setOptions(result.bestOptions)

      // Re-run the active packer with optimized settings
      const optimizedResult = activePacker.runPacker(input, result.bestOptions)

      if (optimizedResult && optimizedResult.length > 0 && optimizedResult[0].result) {
        if (optimizedResult[0].result.length >= 2 && optimizedResult[0].result[1]) {
          setOutput(optimizedResult[0].result[1].output || "")
          setDetails(optimizedResult[0].result[1].details || "")
        } else if (optimizedResult[0].result.length >= 1 && optimizedResult[0].result[0]) {
          setOutput(optimizedResult[0].result[0].output || "")
          setDetails(optimizedResult[0].result[0].details || "")
        }
      }
    } catch (error) {
      console.error("Optimization error:", error)
      setError(`Optimization error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsOptimizing(false)
    }
  }

  const stopOptimization = () => {
    if (optimizerRef.current) {
      optimizerRef.current.abort()
    }
  }

  const stopBranchSearch = () => {
    replacerRef.current.terminate()
    setIsBranchSearching(false)
    setBranchSearchMessage("Branch search stopped by user")
  }

  const toggleComparisonMode = () => {
    setComparisonMode(!comparisonMode)
  }

  const findBestHeuristic = async () => {
    if ((input || "").trim() === "") {
      setError("Please enter some code to optimize")
      return
    }

    setIsOptimizingHeuristic(true)
    setError(null)

    try {
      // Create a new instance for each heuristic to avoid state issues
      const heuristics = [
        CrusherHeuristic.BALANCED,
        CrusherHeuristic.MOST_COPIES,
        CrusherHeuristic.LONGEST,
        CrusherHeuristic.DENSITY,
        CrusherHeuristic.ADAPTIVE,
      ]

      let bestHeuristic = CrusherHeuristic.BALANCED
      let bestSize = Number.POSITIVE_INFINITY
      let bestOutput = ""
      let bestDetails = ""

      // Try each heuristic
      for (const heuristic of heuristics) {
        try {
          // Create a fresh instance for each test
          const crusher = new Crusher(heuristic)

          // Run the packer with the current heuristic
          const result = crusher.runPacker(input, options)

          if (result && result.length > 0 && result[0].result) {
            // Get the size of the packed code
            let size = Number.POSITIVE_INFINITY
            let output = ""
            let details = ""

            // Prefer the second result (regexp version) if available
            if (result[0].result.length >= 2 && result[0].result[1]) {
              size = result[0].result[1].length
              output = result[0].result[1].output || ""
              details = result[0].result[1].details || ""
            } else if (result[0].result.length >= 1 && result[0].result[0]) {
              size = result[0].result[0].length
              output = result[0].result[0].output || ""
              details = result[0].result[0].details || ""
            }

            // Update best result if this is better
            if (size < bestSize) {
              bestSize = size
              bestHeuristic = heuristic
              bestOutput = output
              bestDetails = details
            }
          }
        } catch (err) {
          console.error(`Error testing heuristic ${heuristic}:`, err)
          // Continue with next heuristic even if this one fails
        }

        // Add a small delay to allow UI updates
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // Apply the best heuristic
      setSelectedHeuristic(bestHeuristic)
      setOutput(bestOutput)
      setDetails(bestDetails)

      setHeuristicResult({
        heuristic: bestHeuristic,
        size: bestSize,
      })
    } catch (error) {
      console.error("Heuristic optimization error:", error)
      setError(`Heuristic optimization error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsOptimizingHeuristic(false)
    }
  }

  const triggerCompression = () => {
    // Set a flag to indicate we're explicitly running compression
    setBranchSearchProgress(0)
    setBranchSearchMessage("Initializing Web Worker...")
    setIsBranchSearching(true)
    setShouldRunCompression(true)
  }

  return (
    <div className="flex flex-col min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">Enhanced JavaScript Packers</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold mb-2">Options</h2>

          {/* Add encoder selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Encoder
              <select
                name="encoder"
                value={selectedEncoder}
                onChange={(e) => setSelectedEncoder(e.target.value)}
                className="w-full mt-1 p-2 border rounded"
                disabled={isOptimizing || isBranchSearching}
              >
                <option value="replacer">Replacer (Digit-based)</option>
                <option value="regpack">RegPack (Original)</option>
              </select>
            </label>
            <p className="text-xs text-gray-500 mt-1">
              {selectedEncoder === "replacer" &&
                "Minimal packer using digit replacements (input must not contain digits 0-9)"}
              {selectedEncoder === "regpack" && "Original RegPack implementation"}
            </p>
          </div>

          {/* Show heuristic selection only for Crusher */}

          {selectedEncoder !== "replacer" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Crush Gain Factor
                  <input
                    type="number"
                    name="crushGainFactor"
                    value={isNaN(options.crushGainFactor) ? "2" : options.crushGainFactor.toString()}
                    onChange={handleOptionChange}
                    step="0.1"
                    className="w-full mt-1 p-2 border rounded"
                    disabled={isOptimizing || isBranchSearching}
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Crush Length Factor
                  <input
                    type="number"
                    name="crushLengthFactor"
                    value={isNaN(options.crushLengthFactor) ? "1" : options.crushLengthFactor.toString()}
                    onChange={handleOptionChange}
                    step="0.1"
                    className="w-full mt-1 p-2 border rounded"
                    disabled={isOptimizing || isBranchSearching}
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Crush Copies Factor
                  <input
                    type="number"
                    name="crushCopiesFactor"
                    value={isNaN(options.crushCopiesFactor) ? "0" : options.crushCopiesFactor.toString()}
                    onChange={handleOptionChange}
                    step="0.1"
                    className="w-full mt-1 p-2 border rounded"
                    disabled={isOptimizing || isBranchSearching}
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Crush Tiebreaker Factor
                  <input
                    type="number"
                    name="crushTiebreakerFactor"
                    value={isNaN(options.crushTiebreakerFactor) ? "1" : options.crushTiebreakerFactor.toString()}
                    onChange={handleOptionChange}
                    step="1"
                    className="w-full mt-1 p-2 border rounded"
                    disabled={isOptimizing || isBranchSearching}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Add branch search option for Replacer */}
          {selectedEncoder === "replacer" && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">
                  Max Integer Range (1-100)
                  <input
                    type="number"
                    name="maxInt"
                    value={options.maxInt || 10}
                    onChange={handleOptionChange}
                    min="1"
                    max="100"
                    step="1"
                    className="w-full mt-1 p-2 border rounded"
                    disabled={isOptimizing || isBranchSearching}
                  />
                </label>
                <p className="text-xs text-gray-500">
                  Number of tokens to use for replacements (default 0-9 = 10 tokens). Higher values allow more
                  replacements but require larger tokens.
                </p>
              </div>

              <div className="mt-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="useBranchSearch"
                    checked={options.useBranchSearch}
                    onChange={(e) => {
                      handleOptionChange(e)
                      // If turning off branch search, run compression automatically
                      if (!e.target.checked) {
                        setShouldRunCompression(true)
                      }
                    }}
                    className="mr-2"
                    disabled={isOptimizing || isBranchSearching}
                  />
                  <span className="text-sm font-medium">Use Web Worker Branch Search (optimal but non-blocking)</span>
                </label>
                {options.useBranchSearch && (
                  <>
                    {options.useBranchSearch && (
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Beam Width
                          <input
                            type="number"
                            name="beamWidth"
                            value={options.beamWidth || 5}
                            onChange={handleOptionChange}
                            min="1"
                            max="20"
                            step="1"
                            className="w-full mt-1 p-2 border rounded"
                            disabled={isOptimizing || isBranchSearching}
                          />
                        </label>
                        <p className="text-xs text-gray-500">
                          Number of candidate solutions to maintain at each step (higher = more thorough but slower)
                        </p>
                      </div>
                    )}

                    {isBranchSearching ? (
                      <div className="mt-4 space-y-2">
                        <div className="flex items-center">
                          <div className="w-full bg-gray-200 rounded-full h-2.5 mr-2">
                            <div
                              className="bg-green-600 h-2.5 rounded-full"
                              style={{ width: `${branchSearchProgress * 100}%` }}
                            ></div>
                          </div>
                          <span className="text-sm">{Math.round(branchSearchProgress * 100)}%</span>
                        </div>
                        <p className="text-sm">{branchSearchMessage}</p>
                        {branchSearchDetails && <p className="text-xs text-gray-600">{branchSearchDetails}</p>}
                        <p className="text-xs text-blue-600">Performing exhaustive search for optimal compression</p>
                        <button
                          onClick={stopBranchSearch}
                          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
                        >
                          Stop Web Worker
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={triggerCompression}
                        className="mt-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                        disabled={isOptimizing || isBranchSearching || (input || "").trim() === ""}
                      >
                        Run Exhaustive Branch Search
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          <div className="mt-4 flex space-x-2">
            {!isOptimizing && !isOptimizingHeuristic && !isBranchSearching ? (
              <>
                <button
                  onClick={startOptimization}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                  disabled={(input || "").trim() === ""}
                >
                  Find Optimal Settings
                </button>
                {selectedEncoder === "crusher" && (
                  <button
                    onClick={findBestHeuristic}
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                    disabled={(input || "").trim() === ""}
                  >
                    Find Best Heuristic
                  </button>
                )}
                <button
                  onClick={toggleComparisonMode}
                  className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded"
                  disabled={(input || "").trim() === ""}
                >
                  {comparisonMode ? "Hide Comparison" : "Compare All Encoders"}
                </button>
              </>
            ) : !isBranchSearching ? (
              <div className="space-y-2">
                <div className="flex items-center">
                  <div className="w-full bg-gray-200 rounded-full h-2.5 mr-2">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full"
                      style={{ width: `${isOptimizing ? optimizationProgress * 100 : 50}%` }}
                    ></div>
                  </div>
                  <span className="text-sm">
                    {isOptimizing ? `${Math.round(optimizationProgress * 100)}%` : "Testing heuristics..."}
                  </span>
                </div>
                <button
                  onClick={
                    isOptimizing
                      ? stopOptimization
                      : () => {
                          setIsOptimizingHeuristic(false)
                          setIsBranchSearching(false)
                        }
                  }
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
                >
                  Stop Heuristic Testing
                </button>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Statistics</h2>
          {packerData && (
            <div className="bg-gray-100 p-3 rounded">
              <p>Original size: {input.length} bytes</p>
              <p>
                Encoder:{" "}
                {selectedEncoder === "crusher" ? "Crusher" : selectedEncoder === "replacer" ? "Replacer" : "RegPack"}
              </p>
              <p>Output size: {output.length} bytes</p>
              <p>Compression ratio: {input.length ? ((output.length / input.length) * 100).toFixed(2) : "0"}%</p>
              <p>Savings: {input.length ? ((1 - output.length / input.length) * 100).toFixed(2) : "0"}%</p>
              {selectedEncoder === "crusher" && <p>Heuristic: {selectedHeuristic}</p>}
              {selectedEncoder === "replacer" && options.useBranchSearch && (
                <p>
                  Branch search:{" "}
                  {isBranchSearching
                    ? "Running in Web Worker..."
                    : isWaitingForTrigger
                      ? "Waiting for trigger"
                      : "Complete"}
                </p>
              )}
              {selectedEncoder === "replacer" && (
                <p className="mt-2">
                  {packerData?.searchGraph ? (
                    <button
                      onClick={() => setShowSearchGraph(!showSearchGraph)}
                      className="text-blue-500 hover:text-blue-700 underline"
                    >
                      View Search Graph Visualization
                    </button>
                  ) : (
                    <span className="text-gray-500">
                      (Search graph data not available. Try using branch search with Web Worker)
                    </span>
                  )}
                </p>
              )}

              {comparisonMode && (
                <>
                  <div className="mt-3 pt-3 border-t border-gray-300">
                    <p className="font-semibold">Comparison:</p>
                    <p>RegPack size: {regpackOutput.length} bytes</p>
                    <p>Replacer size: {replacerOutput.length} bytes</p>
                    <p>
                      Best encoder:{" "}
                      {Math.min(
                        output.length || Number.POSITIVE_INFINITY,
                        regpackOutput.length || Number.POSITIVE_INFINITY,
                        replacerOutput.length || Number.POSITIVE_INFINITY,
                      ) === output.length
                        ? selectedEncoder
                        : Math.min(
                              regpackOutput.length || Number.POSITIVE_INFINITY,
                              replacerOutput.length || Number.POSITIVE_INFINITY,
                            ) === regpackOutput.length
                          ? "RegPack"
                          : "Replacer"}
                    </p>
                  </div>
                </>
              )}

              {optimizationResult && (
                <div className="mt-3 pt-3 border-t border-gray-300">
                  <p className="font-semibold">Optimization Results:</p>
                  <p>Best size: {optimizationResult.bestSize} bytes</p>
                  <p>Best options:</p>
                  <ul className="text-sm ml-4">
                    <li>Gain Factor: {optimizationResult.bestOptions.crushGainFactor}</li>
                    <li>Length Factor: {optimizationResult.bestOptions.crushLengthFactor}</li>
                    <li>Copies Factor: {optimizationResult.bestOptions.crushCopiesFactor}</li>
                    <li>Tiebreaker Factor: {optimizationResult.bestOptions.crushTiebreakerFactor}</li>
                  </ul>
                </div>
              )}
              {heuristicResult && selectedEncoder === "crusher" && (
                <div className="mt-3 pt-3 border-t border-gray-300">
                  <p className="font-semibold">Heuristic Optimization Results:</p>
                  <p>Best heuristic: {heuristicResult.heuristic}</p>
                  <p>Best size: {heuristicResult.size} bytes</p>
                </div>
              )}
              {workerResult && selectedEncoder === "replacer" && options.useBranchSearch && !isBranchSearching && (
                <div className="mt-3 pt-3 border-t border-gray-300">
                  <p className="font-semibold">Web Worker Results:</p>
                  <p>Output size: {workerResult.length} bytes</p>
                  <p>Memory-efficient search completed successfully</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold mb-2">Input</h2>
          <textarea
            value={input || ""}
            onChange={(e) => setInput(e.target.value || "")}
            className="w-full h-full min-h-[300px] p-3 border rounded font-mono text-sm"
            placeholder="Paste your JavaScript code here..."
            disabled={isOptimizing || isBranchSearching}
          />
        </div>

        <div className="flex flex-col">
          <div className="flex border-b mb-2">
            <button
              className={`px-4 py-2 ${activeTab === "output" ? "border-b-2 border-blue-500 font-semibold" : ""}`}
              onClick={() => setActiveTab("output")}
            >
              Output
            </button>
            <button
              className={`px-4 py-2 ${activeTab === "details" ? "border-b-2 border-blue-500 font-semibold" : ""}`}
              onClick={() => setActiveTab("details")}
            >
              Details
            </button>
            <button
              className={`px-4 py-2 ${activeTab === "pattern" ? "border-b-2 border-blue-500 font-semibold" : ""}`}
              onClick={() => setActiveTab("pattern")}
            >
              Pattern View
            </button>
            {comparisonMode && (
              <button
                className={`px-4 py-2 ${activeTab === "comparison" ? "border-b-2 border-blue-500 font-semibold" : ""}`}
                onClick={() => setActiveTab("comparison")}
              >
                Comparison
              </button>
            )}
            {selectedEncoder === "replacer" && packerData?.searchGraph && (
              <button
                className="ml-auto px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
                onClick={() => setShowSearchGraph(!showSearchGraph)}
              >
                {showSearchGraph ? "Hide Search Graph" : "Show Search Graph"}
              </button>
            )}
          </div>

          <div className="flex-grow overflow-auto">
            {activeTab === "output" && (
              <textarea
                value={output}
                readOnly
                className="w-full h-full min-h-[300px] p-3 border rounded font-mono text-sm"
                placeholder="Packed code will appear here..."
              />
            )}

            {activeTab === "details" && (
              <pre className="w-full h-full min-h-[300px] p-3 border rounded font-mono text-sm overflow-auto whitespace-pre-wrap">
                {details}
              </pre>
            )}

            {activeTab === "pattern" && patternView && (
              <div className="w-full h-full min-h-[300px] p-3 border rounded overflow-auto">
                <div dangerouslySetInnerHTML={{ __html: patternView.outerHTML }} />
              </div>
            )}

            {activeTab === "comparison" && comparisonMode && (
              <div className="w-full h-full min-h-[300px] p-3 border rounded overflow-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2">RegPack Output</h3>
                    <pre className="text-xs p-2 bg-gray-50 rounded overflow-auto">{regpackOutput}</pre>
                    <p className="mt-2">Size: {regpackOutput.length} bytes</p>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Replacer Output</h3>
                    <pre className="text-xs p-2 bg-gray-50 rounded overflow-auto">{replacerOutput}</pre>
                    <p className="mt-2">Size: {replacerOutput.length} bytes</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSearchGraph && packerData?.searchGraph && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-11/12 h-5/6 p-4 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Search Graph Visualization</h2>
              <button className="px-2 py-1 bg-gray-200 rounded" onClick={() => setShowSearchGraph(false)}>
                Close
              </button>
            </div>
            <div className="flex-grow">
              <SearchGraphVisualizer graphData={packerData.searchGraph} originalSize={input.length} />
            </div>
          </div>
        </div>
      )}
      <style jsx>{`
  .depth0 { background-color: #ffffff; }
  .depth1 { background-color: #e6f7ff; border-bottom: 1px solid #91d5ff; }
  .depth2 { background-color: #d9f2ff; border-bottom: 1px solid #69c0ff; }
  .depth3 { background-color: #bae7ff; border-bottom: 1px solid #40a9ff; }
  .depth4 { background-color: #91d5ff; border-bottom: 1px solid #1890ff; }
  .depth5 { background-color: #69c0ff; border-bottom: 1px solid #096dd9; color: #003a8c; }
  .depth6 { background-color: #40a9ff; border-bottom: 1px solid #0050b3; color: #002766; }
  .depth7 { background-color: #1890ff; border-bottom: 1px solid #003a8c; color: #ffffff; }
  .depth8 { background-color: #096dd9; border-bottom: 1px solid #002766; color: #ffffff; }
  .depth9 { background-color: #0050b3; border-bottom: 1px solid #001d66; color: #ffffff; }
  
  /* Add hover effects */
  span[class^="depth"]:hover {
    filter: brightness(1.1);
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.2);
    cursor: pointer;
    position: relative;
    z-index: 1;
  }
`}</style>
    </div>
  )
}
