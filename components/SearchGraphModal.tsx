"use client"

import type React from "react"

import { useEffect, useRef } from "react"
import SearchGraphVisualizer from "./SearchGraphVisualizer"

interface SearchGraphModalProps {
  isOpen: boolean
  onClose: () => void
  graphData: {
    nodes: Array<{
      id: string
      text: string
      replacements: string[]
      size: number
      depth: number
      isBestSolution?: boolean
    }>
    edges: Array<{
      source: string
      target: string
      pattern: string
      gain: number
    }>
    maxDepth: number
    bestPath: string[]
  }
  originalSize: number
}

const SearchGraphModal: React.FC<SearchGraphModalProps> = ({ isOpen, onClose, graphData, originalSize }) => {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }

    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        ref={modalRef}
        className="relative w-[90vw] h-[90vh] bg-white rounded-lg shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-bold">RegPack2 Search Graph</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 transition-colors" aria-label="Close">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 border-b bg-gray-50">
          <p>
            This visualization shows the beam search process of RegPack2. Each node represents a state in the search,
            and edges represent pattern replacements. The best path is highlighted in red.
          </p>
          <div className="mt-2 text-sm text-gray-600">
            <span className="font-semibold">Nodes:</span> {graphData.nodes.length} |{" "}
            <span className="font-semibold">Edges:</span> {graphData.edges.length} |{" "}
            <span className="font-semibold">Max Depth:</span> {graphData.maxDepth}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <SearchGraphVisualizer graphData={graphData} originalSize={originalSize} />
        </div>
      </div>
    </div>
  )
}

export default SearchGraphModal
