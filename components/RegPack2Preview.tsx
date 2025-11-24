"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { RegPack2 } from "../models/RegPack2"
import { PatternViewer } from "./PatternViewer"
import SearchGraphVisualizer from "./SearchGraphVisualizer"
import type { PackerData } from "../models/PackerData"
import type { PackerOptions } from "../types"

export default function RegPack2Preview() {
  const [input, setInput] = useState("")
  const [output, setOutput] = useState("")
  const [details, setDetails] = useState("")
  const [options, setOptions] = useState<PackerOptions>({
    useES6: true,
    beamWidth: 5, // Default beam width for RegPack2
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

  const regPack2Ref = useRef<RegPack2>(new RegPack2())

  useEffect(() => {
    if (input.trim() === "") return

    try {
      setError(null)
      const regPack2 = regPack2Ref.current
      const result = regPack2.runPacker(input, options)

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

        // Get search graph data
        setSearchGraphData(regPack2.getSearchGraph())

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
      console.error("Error in RegPack2 processing:", error)
      setOutput("")
      setDetails(`Error: ${error instanceof Error ? error.message : String(error)}`)
      setPatternView(null)
      setError(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [input, options])

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
      <h1 className="text-2xl font-bold mb-4">RegPack2 - Beam Search JavaScript Packer</h1>

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
                Number of candidate solutions to maintain at each step (higher = more thorough but slower)
              </p>
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
              />
              <span className="text-sm font-medium">Use ES6 Features</span>
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Statistics</h2>
          {packerData && (
            <div className="bg-gray-100 p-3 rounded">
              <p>Original size: {input.length} bytes</p>
              <p>Packed size: {output.length} bytes</p>
              <p>Compression ratio: {input.length ? ((output.length / input.length) * 100).toFixed(2) : "0"}%</p>
              <p>Savings: {input.length ? ((1 - output.length / input.length) * 100).toFixed(2) : "0"}%</p>
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
              <h3 className="text-xl font-semibold">RegPack2 Search Graph</h3>
              <button onClick={toggleSearchGraph} className="text-gray-500 hover:text-gray-700 focus:outline-none">
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
