"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { SlowPack } from "../models/SlowPack"
import { PatternViewer } from "./PatternViewer"
import SearchGraphVisualizer from "./SearchGraphVisualizer"
import type { PackerData } from "../models/PackerData"
import type { PackerOptions } from "../types"
import { getByteCount } from "../utils/StringHelper"
import { useInputStore } from "@/store/useInputStore"

export default function RegPack2Preview() {
  const { globalInput, setGlobalInput } = useInputStore()
  const input = globalInput
  const setInput = setGlobalInput

  const [output, setOutput] = useState("")
  const [details, setDetails] = useState("")
  const [options, setOptions] = useState<PackerOptions>({
    useES6: true,
    beamWidth: 5, // Default beam width
    maxReplacements: 100, // Default max replacements
    crushGainFactor: 1,
    crushLengthFactor: 1,
    crushCopiesFactor: 1,
    crushTiebreakerFactor: 1,
  })
  const [packerData, setPackerData] = useState<PackerData | null>(null)
  const [patternView, setPatternView] = useState<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState("output")
  const [error, setError] = useState<string | null>(null)
  const [searchGraphData, setSearchGraphData] = useState<any>(null)
  const [showSearchGraph, setShowSearchGraph] = useState(false)
  const [isPacking, setIsPacking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState("")
  const [progressDetails, setProgressDetails] = useState("")

  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  const handlePack = () => {
    if (input.trim() === "") return
    
    setIsPacking(true)
    setProgress(0)
    setProgressMessage("Initializing...")
    setProgressDetails("")
    setError(null)
    setSearchGraphData(null)
    
    if (workerRef.current) {
        workerRef.current.terminate()
    }

    try {
        const worker = new Worker(new URL("../workers/slowpack.worker.ts", import.meta.url))
        workerRef.current = worker

        worker.onmessage = (event: MessageEvent) => {
            const { type, progress, data, searchGraph, error } = event.data
            
            if (type === "progress") {
                setProgress(progress.progress * 100)
                setProgressMessage(progress.message)
                if (progress.details) setProgressDetails(progress.details)
            } else if (type === "result") {
                setPackerData(data[0])
                 // Process results
                if (data[0].result && data[0].result.length >= 2 && data[0].result[1]) {
                    setOutput(data[0].result[1].output || "")
                    setDetails(data[0].result[1].details || "")
                } else if (data[0].result && data[0].result.length >= 1 && data[0].result[0]) {
                    setOutput(data[0].result[0].output || "")
                    setDetails(data[0].result[0].details || "")
                } else {
                    setOutput("")
                    setDetails("Error: No valid output generated")
                    setError("Failed to generate output")
                }

                // Get search graph data
                setSearchGraphData(searchGraph)

                // Generate pattern view
                try {
                    if (data[0].matchesLookup) {
                        const patternViewer = new PatternViewer()
                        const patternElement = patternViewer.render(input, data[0].matchesLookup)
                        setPatternView(patternElement)
                    } else {
                        setPatternView(null)
                    }
                } catch (patternError) {
                    console.error("Error generating pattern view:", patternError)
                    setPatternView(null)
                }
                
                setIsPacking(false)
                setProgress(100)
            } else if (type === "error") {
                setError(`Worker Error: ${error}`)
                setIsPacking(false)
            }
        }

        worker.postMessage({
            type: "init",
            input,
            options
        })
        
    } catch (e) {
        setError(`Failed to start worker: ${e instanceof Error ? e.message : String(e)}`)
        setIsPacking(false)
    }
  }

  const handleOptionChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked

    setOptions((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value === "" ? 0 : Number.parseFloat(value) || 0,
    }))
  }

  const toggleSearchGraph = () => {
    setShowSearchGraph(!showSearchGraph)
  }

  return (
    <div className="flex flex-col min-h-screen p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">SlowPack - Beam Search JavaScript Packer</h1>
        <button
          onClick={handlePack}
          disabled={isPacking || input.trim() === ""}
          className={`px-4 py-2 rounded font-bold text-white ${
            isPacking || input.trim() === "" ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {isPacking ? "Packing..." : "Pack Code"}
        </button>
      </div>

      {isPacking && (
        <div className="mb-4 bg-white p-4 rounded border shadow-sm">
          <div className="flex justify-between mb-1">
            <span className="text-sm font-medium text-blue-700">{progressMessage}</span>
            <span className="text-sm font-medium text-blue-700">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
          {progressDetails && <p className="text-xs text-gray-500 mt-1 truncate">{progressDetails}</p>}
        </div>
      )}

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
                />
              </label>
              <p className="text-xs text-gray-500">
                Number of candidate solutions to maintain at each step
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Max Replacements
                <input
                  type="number"
                  name="maxReplacements"
                  value={options.maxReplacements || 100}
                  onChange={handleOptionChange}
                  min="1"
                  max="1000"
                  step="1"
                  className="w-full mt-1 p-2 border rounded"
                />
              </label>
              <p className="text-xs text-gray-500">
                Maximum number of replacements to perform
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Branch Factor (Search Breadth)
                <input
                  type="number"
                  name="branchFactor"
                  value={options.branchFactor || 20}
                  onChange={handleOptionChange}
                  min="1"
                  max="50"
                  step="1"
                  className="w-full mt-1 p-2 border rounded"
                />
              </label>
              <p className="text-xs text-gray-500">
                How many patterns to try at each step. Higher = better results but slower.
              </p>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                name="useES6"
                checked={options.useES6}
                onChange={handleOptionChange}
                className="mr-2"
              />
              <span className="text-sm font-medium">Use ES6 Features</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                name="prioritizeHighestGain"
                checked={options.prioritizeHighestGain || false}
                onChange={handleOptionChange}
                className="mr-2"
              />
              <span className="text-sm font-medium">Prioritize Highest Gain</span>
            </label>
            <p className="text-xs text-gray-500 ml-6">
                When checked, prefers replacements with highest immediate gain over predicted future gain.
            </p>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Statistics</h2>
          {packerData && (
            <div className="bg-gray-100 p-3 rounded">
              <p>Original size: {getByteCount(input)} bytes</p>
              <p>Packed size: {getByteCount(output)} bytes</p>
              <p>Compression ratio: {getByteCount(input) ? ((getByteCount(output) / getByteCount(input)) * 100).toFixed(2) : "0"}%</p>
              <p>Savings: {getByteCount(input) ? ((1 - getByteCount(output) / getByteCount(input)) * 100).toFixed(2) : "0"}%</p>
              <p>Beam width: {options.beamWidth || 5}</p>
              {searchGraphData && (
                <div className="mt-2">
                  <p>
                    Search graph: {searchGraphData.nodes.length} nodes, {searchGraphData.edges.length} edges
                  </p>
                  <button
                    onClick={toggleSearchGraph}
                    className="mt-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                  >
                    {showSearchGraph ? "Hide Search Graph" : "Show Search Graph"}
                  </button>
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full h-full min-h-[300px] p-3 border rounded font-mono text-sm"
            placeholder="Paste your JavaScript code here..."
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

            {activeTab === "pattern" && patternView && (
              <div className="w-full h-full min-h-[300px] p-3 border rounded overflow-auto">
                <div dangerouslySetInnerHTML={{ __html: patternView.outerHTML }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search Graph Modal */}
      {showSearchGraph && searchGraphData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-xl font-semibold">SlowPack Search Graph</h3>
              <button 
                onClick={toggleSearchGraph} 
                className="text-gray-500 hover:text-gray-700 focus:outline-none"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-grow overflow-hidden p-2">
              <SearchGraphVisualizer graphData={searchGraphData} originalSize={input.length} />
            </div>
            <div className="p-4 border-t">
              <p className="text-sm text-gray-600">
                This graph shows the beam search process. Each node represents a state in the compression process. The
                red path highlights the best solution found.
              </p>
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
