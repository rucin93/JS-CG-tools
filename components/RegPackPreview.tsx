"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { RegPack } from "../models/RegPack"
import { PackerOptimizer, type OptimizationResult } from "../models/PackerOptimizer"
import { PatternViewer } from "./PatternViewer"
import type { PackerData } from "../models/PackerData"
import type { PackerOptions } from "../types"
import { getByteCount } from "../utils/StringHelper"
import { useInputStore } from "@/store/useInputStore"

export default function RegPackPreview() {
  const { globalInput, setGlobalInput } = useInputStore()
  const input = globalInput
  const setInput = setGlobalInput
  
  const [output, setOutput] = useState<string>("")
  const [details, setDetails] = useState<string>("")
  const [options, setOptions] = useState<PackerOptions>({
    crushGainFactor: 2,
    crushLengthFactor: 1,
    crushCopiesFactor: 0,
    crushTiebreakerFactor: 1,
    useES6: true,
  })
  const [packerData, setPackerData] = useState<PackerData | null>(null)
  const [patternView, setPatternView] = useState<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState("output")
  const [error, setError] = useState<string | null>(null)

  // Optimization state
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationProgress, setOptimizationProgress] = useState(0)
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null)
  const optimizerRef = useRef<PackerOptimizer | null>(null)
  const regPackRef = useRef<RegPack>(new RegPack())

  useEffect(() => {
    // Guard against undefined or empty input
    if (!input || typeof input !== "string" || input.trim() === "") {
      setOutput("")
      setDetails("")
      setPackerData(null)
      setPatternView(null)
      return
    }

    try {
      setError(null)
      const regPack = regPackRef.current
      const result = regPack.runPacker(input, options)

      if (result && result.length > 0) {
        setPackerData(result[0])

        // Process results
        if (result[0].result && result[0].result.length >= 2 && result[0].result[1]) {
          setOutput(result[0].result[1].output || "")
          setDetails(result[0].result[1].details || "")
        } else if (result[0].result && result[0].result.length >= 1 && result[0].result[0]) {
          setOutput(result[0].result[0].output || "")
          setDetails(result[0].result[0].details || "")
        } else {
          setOutput("")
          setDetails("Error: No valid output generated")
          setError("Failed to generate output")
        }

        // Generate pattern view
        try {
          if (result[0].matchesLookup) {
            const patternViewer = new PatternViewer()
            const patternElement = patternViewer.render(input, result[0].matchesLookup)
            setPatternView(patternElement)
          } else {
            setPatternView(null)
          }
        } catch (patternError) {
          console.error("Error generating pattern view:", patternError)
          setPatternView(null)
        }
      } else {
        setOutput("")
        setDetails("Error: No valid output generated")
        setPatternView(null)
        setError("Failed to generate output")
      }
    } catch (error) {
      console.error("Error in RegPack processing:", error)
      setOutput("")
      setDetails(`Error: ${error instanceof Error ? error.message : String(error)}`)
      setPatternView(null)
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [input, options])

  const handleOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    setOptions((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value === "" ? 0 : Number.parseFloat(value) || 0,
    }))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setInput(newValue || "")
  }

  const startOptimization = async () => {
    if (!input || typeof input !== "string" || input.trim() === "") {
      setError("Please enter some code to optimize")
      return
    }

    setIsOptimizing(true)
    setOptimizationProgress(0)
    setError(null)

    try {
      // Create a new optimizer with the RegPack instance
      optimizerRef.current = new PackerOptimizer(regPackRef.current, input, (result) => {
        setOptimizationProgress(result.progress)
        setOptimizationResult(result)
      })

      // Start the optimization process
      const result = await optimizerRef.current.findBestOptions()

      // Apply the best options
      setOptions(result.bestOptions)
      setOutput(result.bestOutput)
      setDetails(result.bestDetails)
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

  const inputLength = input ? input.length : 0
  const outputLength = output ? output.length : 0
  const hasValidInput = input && typeof input === "string" && input.trim() !== ""

  return (
    <div className="flex flex-col min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">RegPack - JavaScript Packer</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold mb-2">Options</h2>
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
                  disabled={isOptimizing}
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
                  disabled={isOptimizing}
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
                  disabled={isOptimizing}
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
                  disabled={isOptimizing}
                />
              </label>
            </div>
          </div>
          <div className="mt-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                name="useES6"
                checked={options.useES6}
                onChange={handleOptionChange}
                className="mr-2"
                disabled={isOptimizing}
              />
              <span className="text-sm font-medium">Use ES6 Features</span>
            </label>
          </div>

          <div className="mt-4">
            {!isOptimizing ? (
              <button
                onClick={startOptimization}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
                disabled={!hasValidInput}
              >
                Find Optimal Settings
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center">
                  <div className="w-full bg-gray-200 rounded-full h-2.5 mr-2">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full"
                      style={{ width: `${optimizationProgress * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm">{Math.round(optimizationProgress * 100)}%</span>
                </div>
                <button onClick={stopOptimization} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded">
                  Stop Optimization
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Statistics</h2>
          {packerData && hasValidInput ? (
            <div className="bg-gray-100 p-3 rounded">
              <p>Original size: {getByteCount(input)} bytes</p>
              <p>Packed size: {getByteCount(output)} bytes</p>
              <p>Compression ratio: {getByteCount(input) ? ((getByteCount(output) / getByteCount(input)) * 100).toFixed(2) : "0"}%</p>
              <p>Savings: {getByteCount(input) ? ((1 - getByteCount(output) / getByteCount(input)) * 100).toFixed(2) : "0"}%</p>

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
                    <li>ES6: {optimizationResult.bestOptions.useES6 ? "Yes" : "No"}</li>
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-100 p-3 rounded text-gray-500">
              <p>Enter code to see statistics</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold mb-2">Input</h2>
          <textarea
            value={input}
            onChange={handleInputChange}
            className="w-full h-full min-h-[300px] p-3 border rounded font-mono text-sm"
            placeholder="Paste your JavaScript code here..."
            disabled={isOptimizing}
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

            {activeTab === "pattern" && (
              <div className="w-full h-full min-h-[300px] p-3 border rounded overflow-auto">
                {patternView ? (
                  <div dangerouslySetInnerHTML={{ __html: patternView.outerHTML }} />
                ) : (
                  <p className="text-gray-500">No pattern data available</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
