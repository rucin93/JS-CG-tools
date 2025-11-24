"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"

interface SearchGraphNode {
  id: string
  text: string
  replacements: string[]
  size: number
  depth: number
  isBestSolution?: boolean
}

interface SearchGraphEdge {
  source: string
  target: string
  pattern: string
  gain: number
}

interface SearchGraphData {
  nodes: SearchGraphNode[]
  edges: SearchGraphEdge[]
  maxDepth: number
  bestPath: string[]
}

interface SearchGraphVisualizerProps {
  graphData: SearchGraphData
  originalSize: number
}

const SearchGraphVisualizer: React.FC<SearchGraphVisualizerProps> = ({ graphData, originalSize }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [selectedNode, setSelectedNode] = useState<SearchGraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<SearchGraphNode | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [showBestPathOnly, setShowBestPathOnly] = useState(false)
  const [showLabels, setShowLabels] = useState(true)

  useEffect(() => {
    if (!graphData || !svgRef.current) return

    // Filter nodes and edges if showing best path only
    let nodes = [...graphData.nodes]
    let edges = [...graphData.edges]

    if (showBestPathOnly) {
      const bestPathNodeIds = new Set(graphData.bestPath)
      nodes = nodes.filter((node) => bestPathNodeIds.has(node.id))
      edges = edges.filter((edge) => bestPathNodeIds.has(edge.source) && bestPathNodeIds.has(edge.target))
    }

    // Clear previous visualization
    d3.select(svgRef.current).selectAll("*").remove()

    // Set up SVG dimensions
    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight
    const margin = { top: 20, right: 20, bottom: 20, left: 20 }

    // Create SVG container with zoom capability
    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.1, 4])
          .on("zoom", (event) => {
            setZoomLevel(event.transform.k)
            g.attr("transform", event.transform)
          }) as any,
      )

    // Create a group for all elements
    const g = svg.append("g")

    // Create a force simulation
    const simulation = d3
      .forceSimulation<d3.SimulationNodeDatum & SearchGraphNode>()
      .force(
        "link",
        d3
          .forceLink<d3.SimulationNodeDatum, d3.SimulationLinkDatum<d3.SimulationNodeDatum>>()
          .id((d: any) => d.id)
          .distance(100),
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.1))
      .force("y", d3.forceY(height / 2).strength(0.1))

    // Create a map of best path edges for quick lookup
    const bestPathEdges = new Map<string, boolean>()

    // Add all possible edges between nodes in the best path
    for (let i = 0; i < graphData.bestPath.length; i++) {
      for (let j = i + 1; j < graphData.bestPath.length; j++) {
        const source = graphData.bestPath[i]
        const target = graphData.bestPath[j]
        bestPathEdges.set(`${source}-${target}`, true)
        bestPathEdges.set(`${target}-${source}`, true) // Add both directions
      }
    }

    // Update the link styling section to highlight the best path
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(edges)
      .enter()
      .append("line")
      .attr("stroke-width", (d) => {
        // Check if this edge is part of the best path
        const isInBestPath =
          bestPathEdges.has(`${d.source}-${d.target}`) || bestPathEdges.has(`${d.target}-${d.source}`)

        // Make best path edges thicker
        if (isInBestPath) {
          return 3 // Thicker for best path
        }

        // Check if both nodes are in the best path (for consecutive nodes)
        const sourceInBestPath = graphData.bestPath.includes(d.source)
        const targetInBestPath = graphData.bestPath.includes(d.target)

        if (sourceInBestPath && targetInBestPath) {
          // Check if these nodes are consecutive in the best path
          const sourceIndex = graphData.bestPath.indexOf(d.source)
          const targetIndex = graphData.bestPath.indexOf(d.target)
          if (Math.abs(sourceIndex - targetIndex) === 1) {
            return 4 // Even thicker for consecutive nodes in best path
          }
          return 3 // Thicker for non-consecutive nodes in best path
        }

        return Math.max(1, Math.min(2, d.gain / 20))
      })
      .attr("stroke", (d) => {
        // Check if this edge is part of the best path
        const isInBestPath =
          bestPathEdges.has(`${d.source}-${d.target}`) || bestPathEdges.has(`${d.target}-${d.source}`)

        // Color best path edges red
        if (isInBestPath) {
          return "#ff0000" // Red for best path
        }

        // Check if both nodes are in the best path
        const sourceInBestPath = graphData.bestPath.includes(d.source)
        const targetInBestPath = graphData.bestPath.includes(d.target)

        if (sourceInBestPath && targetInBestPath) {
          // Check if these nodes are consecutive in the best path
          const sourceIndex = graphData.bestPath.indexOf(d.source)
          const targetIndex = graphData.bestPath.indexOf(d.target)
          if (Math.abs(sourceIndex - targetIndex) === 1) {
            return "#ff0000" // Red for consecutive nodes in best path
          }
          return "#ff5555" // Lighter red for non-consecutive nodes in best path
        }

        return "#999" // Gray for other edges
      })
      .attr("stroke-opacity", (d) => {
        // Check if this edge is part of the best path
        const isInBestPath =
          bestPathEdges.has(`${d.source}-${d.target}`) || bestPathEdges.has(`${d.target}-${d.source}`)

        // Make best path edges more visible
        if (isInBestPath) {
          return 0.9 // More visible for best path
        }

        // Check if both nodes are in the best path
        const sourceInBestPath = graphData.bestPath.includes(d.source)
        const targetInBestPath = graphData.bestPath.includes(d.target)

        if (sourceInBestPath && targetInBestPath) {
          // Check if these nodes are consecutive in the best path
          const sourceIndex = graphData.bestPath.indexOf(d.source)
          const targetIndex = graphData.bestPath.indexOf(d.target)
          if (Math.abs(sourceIndex - targetIndex) === 1) {
            return 1.0 // Fully visible for consecutive nodes in best path
          }
          return 0.8 // Highly visible for non-consecutive nodes in best path
        }

        return 0.4 // Less visible for other edges
      })
      .attr("stroke-dasharray", (d) => {
        // Check if both nodes are in the best path
        const sourceInBestPath = graphData.bestPath.includes(d.source)
        const targetInBestPath = graphData.bestPath.includes(d.target)

        if (sourceInBestPath && targetInBestPath) {
          // Check if these nodes are consecutive in the best path
          const sourceIndex = graphData.bestPath.indexOf(d.source)
          const targetIndex = graphData.bestPath.indexOf(d.target)
          if (Math.abs(sourceIndex - targetIndex) === 1) {
            return null // Solid line for consecutive nodes in best path
          }
          return "5,5" // Dashed line for non-consecutive nodes in best path
        }

        return null // Solid line for other edges
      })

    // Add nodes
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", (d) => Math.max(5, 20 * (1 - d.size / originalSize)))
      .attr("fill", (d) => {
        if (d.isBestSolution) return "#ff0000" // Red for best solution
        if (graphData.bestPath.includes(d.id)) {
          // Color based on position in best path
          const pathIndex = graphData.bestPath.indexOf(d.id)
          const pathLength = graphData.bestPath.length
          // Gradient from green to red
          const hue = 120 - (pathIndex / (pathLength - 1)) * 120
          return `hsl(${hue}, 80%, 60%)`
        }
        // Color based on depth
        const depthColors = [
          "#8dd3c7",
          "#ffffb3",
          "#bebada",
          "#fb8072",
          "#80b1d3",
          "#fdb462",
          "#b3de69",
          "#fccde5",
          "#d9d9d9",
          "#bc80bd",
        ]
        return depthColors[d.depth % depthColors.length]
      })
      .attr("stroke", (d) => (graphData.bestPath.includes(d.id) ? "#ff0000" : "#fff"))
      .attr("stroke-width", (d) => (graphData.bestPath.includes(d.id) ? 2 : 1))
      .call(
        d3
          .drag<SVGCircleElement, d3.SimulationNodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on("drag", (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          }) as any,
      )

    // Add node labels if enabled
    if (showLabels) {
      const labels = g
        .append("g")
        .attr("class", "labels")
        .selectAll("text")
        .data(nodes)
        .enter()
        .append("text")
        .text((d) => {
          if (graphData.bestPath.includes(d.id)) {
            const pathIndex = graphData.bestPath.indexOf(d.id)
            return `${pathIndex}:${d.size}b`
          }
          return `${d.size}b`
        })
        .attr("font-size", 10)
        .attr("dx", 12)
        .attr("dy", 4)
        .attr("fill", (d) => (graphData.bestPath.includes(d.id) ? "#ff0000" : "#000"))
        .attr("font-weight", (d) => (graphData.bestPath.includes(d.id) ? "bold" : "normal"))
        .style("pointer-events", "none")
    }

    // Add tooltips
    node
      .on("mouseover", (event, d: any) => {
        setHoveredNode(d)
        const tooltip = d3.select(tooltipRef.current)
        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY + 10}px`)
      })
      .on("mousemove", (event) => {
        const tooltip = d3.select(tooltipRef.current)
        tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY + 10}px`)
      })
      .on("mouseout", () => {
        setHoveredNode(null)
        d3.select(tooltipRef.current).style("display", "none")
      })
      .on("click", (event, d: any) => {
        setSelectedNode(d)
        event.stopPropagation()
      })

    // Update positions on simulation tick
    simulation.nodes(nodes as any).on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y)

      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y)

      if (showLabels) {
        g.selectAll("text")
          .attr("x", (d: any) => d.x)
          .attr("y", (d: any) => d.y)
      }
    })

    // Set up the links
    simulation
      .force<d3.ForceLink<d3.SimulationNodeDatum, d3.SimulationLinkDatum<d3.SimulationNodeDatum>>>("link")!
      .links(edges as any)

    // Click on background to deselect node
    svg.on("click", () => {
      setSelectedNode(null)
    })

    return () => {
      simulation.stop()
    }
  }, [graphData, originalSize, showBestPathOnly, showLabels])

  // Find the best solution node
  const bestSolutionNode = graphData?.nodes.find((node) => node.isBestSolution)

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-2">
        <div className="flex space-x-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={showBestPathOnly}
              onChange={(e) => setShowBestPathOnly(e.target.checked)}
              className="mr-1"
            />
            Show Best Path Only
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="mr-1"
            />
            Show Labels
          </label>
        </div>
        <div className="text-sm">
          Zoom: {Math.round(zoomLevel * 100)}% | Nodes: {graphData.nodes.length} | Edges: {graphData.edges.length}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <svg ref={svgRef} className="w-full h-full border rounded bg-gray-50"></svg>
          <div ref={tooltipRef} className="absolute hidden bg-white p-2 border rounded shadow-lg text-xs max-w-xs z-10">
            {hoveredNode && (
              <>
                <div className="font-bold">Size: {hoveredNode.size} bytes</div>
                <div>Depth: {hoveredNode.depth}</div>
                <div>Replacements: {hoveredNode.replacements.length}</div>
                {hoveredNode.isBestSolution && <div className="text-red-600 font-bold">Best solution found!</div>}
                {graphData.bestPath.includes(hoveredNode.id) && (
                  <div className="text-green-600 font-bold">
                    Best path node #{graphData.bestPath.indexOf(hoveredNode.id)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="w-1/3 border-l p-2 overflow-auto">
          {selectedNode ? (
            <div>
              <h3 className="text-lg font-bold mb-2">
                Node Details {selectedNode.isBestSolution && <span className="text-red-600">(Best Solution!)</span>}
                {graphData.bestPath.includes(selectedNode.id) && (
                  <span className="text-green-600">
                    {" "}
                    (Best Path Node #{graphData.bestPath.indexOf(selectedNode.id)})
                  </span>
                )}
              </h3>
              <div className="mb-2">
                <span className="font-semibold">Size:</span> {selectedNode.size} bytes (
                {((selectedNode.size / originalSize) * 100).toFixed(1)}% of original)
              </div>
              <div className="mb-2">
                <span className="font-semibold">Depth:</span> {selectedNode.depth}
              </div>
              <div className="mb-2">
                <span className="font-semibold">Replacements:</span> {selectedNode.replacements.length}
              </div>
              {selectedNode.replacements.length > 0 && (
                <div className="mb-2">
                  <span className="font-semibold">Replacement Patterns:</span>
                  <ul className="list-disc pl-5 mt-1">
                    {selectedNode.replacements.map((pattern, index) => (
                      <li key={index} className="break-all">
                        {index}: {pattern}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mb-2">
                <span className="font-semibold">Compressed Text:</span>
                <pre className="bg-gray-100 p-2 mt-1 text-xs overflow-auto max-h-40 rounded">{selectedNode.text}</pre>
              </div>
            </div>
          ) : bestSolutionNode ? (
            <div>
              <h3 className="text-lg font-bold mb-2 text-red-600">Best Solution</h3>
              <div className="mb-2">
                <span className="font-semibold">Size:</span> {bestSolutionNode.size} bytes (
                {((bestSolutionNode.size / originalSize) * 100).toFixed(1)}% of original)
              </div>
              <div className="mb-2">
                <span className="font-semibold">Depth:</span> {bestSolutionNode.depth}
              </div>
              <div className="mb-2">
                <span className="font-semibold">Replacements:</span> {bestSolutionNode.replacements.length}
              </div>
              {bestSolutionNode.replacements.length > 0 && (
                <div className="mb-2">
                  <span className="font-semibold">Replacement Patterns:</span>
                  <ul className="list-disc pl-5 mt-1">
                    {bestSolutionNode.replacements.map((pattern, index) => (
                      <li key={index} className="break-all">
                        {index}: {pattern}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mb-2">
                <span className="font-semibold">Compressed Text:</span>
                <pre className="bg-gray-100 p-2 mt-1 text-xs overflow-auto max-h-40 rounded">
                  {bestSolutionNode.text}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 italic">Select a node to view details</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchGraphVisualizer
