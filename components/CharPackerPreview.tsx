"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getCharPacker } from "@/models/CharPacker"

// Helper function to calculate byte size of a string
function getByteSize(str: string): number {
  try {
    return new TextEncoder().encode(str).length
  } catch (e) {
    // Fallback for environments without TextEncoder
    let s = str.length
    for (let i = str.length - 1; i >= 0; i--) {
      const code = str.charCodeAt(i)
      if (code > 0x7f && code <= 0x7ff) s++
      else if (code > 0x7ff && code <= 0xffff) s += 2
      if (code >= 0xdc00 && code <= 0xdfff) i-- // Trail surrogate of a surrogate pair
    }
    return s
  }
}

// Helper function to format byte sizes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " bytes"
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB"
  else return (bytes / (1024 * 1024)).toFixed(2) + " MB"
}

export default function CharPackerPreview() {
  const [input, setInput] = useState<string>(`How much wood would a woodchuck chuck,
If a woodchuck could chuck wood?
A woodchuck would chuck all the wood he could chuck
If a woodchuck would chuck wood.

Peter Piper picked a peck of pickled peppers.
A peck of pickled peppers Peter Piper picked.
If Peter Piper picked a peck of pickled peppers,
Where's the peck of pickled peppers Peter Piper picked?

She sells seashells by the seashore,
The shells she sells are seashells, I'm sure.
So if she sells seashells on the seashore,
Then I'm sure she sells seashore shells.`)

  const [packerType, setPackerType] = useState<string>("2-1")
  const [output, setOutput] = useState<{ packed: string; mapping?: any }>({ packed: "" })
  const [stats, setStats] = useState<{
    originalLength: number
    packedLength: number
    originalBytes: number
    packedBytes: number
    compressionRatio: number
    byteCompressionRatio: number
    totalSize: number
    savings: number
    byteSavings: number
  }>({
    originalLength: 0,
    packedLength: 0,
    originalBytes: 0,
    packedBytes: 0,
    compressionRatio: 0,
    byteCompressionRatio: 0,
    totalSize: 0,
    savings: 0,
    byteSavings: 0,
  })

  // Run packing when input or packer type changes
  useEffect(() => {
    if ((input || "").trim() === "") {
      setOutput({ packed: "" })
      setStats({
        originalLength: 0,
        packedLength: 0,
        originalBytes: 0,
        packedBytes: 0,
        compressionRatio: 0,
        byteCompressionRatio: 0,
        totalSize: 0,
        savings: 0,
        byteSavings: 0,
      })
      return
    }

    try {
      const packer = getCharPacker(packerType)
      const result = packer.pack(input)

      // Ensure result has expected properties
      const safeResult = {
        packed: result?.packed || "",
        mapping: result?.mapping,
      }

      setOutput(safeResult)

      // Calculate stats
      const originalLength = input.length
      const packedLength = [...(safeResult?.packed || "")].length
      const originalBytes = getByteSize(input)
      const packedBytes = getByteSize(safeResult.packed)
      const totalSize = packedBytes
      const compressionRatio = originalLength > 0 ? packedLength / originalLength : 0
      const byteCompressionRatio = originalBytes > 0 ? packedBytes / originalBytes : 0
      const savings = originalLength - packedLength
      const byteSavings = originalBytes - packedBytes

      setStats({
        originalLength,
        packedLength,
        originalBytes,
        packedBytes,
        compressionRatio,
        byteCompressionRatio,
        totalSize,
        savings,
        byteSavings,
      })
    } catch (error) {
      console.error("Error packing:", error)
      setOutput({ packed: "Error packing input" })
    }
  }, [input, packerType])

  // Copy output to clipboard
  const copyOutput = () => {
    navigator.clipboard
      .writeText(output?.packed || "")
      .then(() => {
        alert("Packed output copied to clipboard!")
      })
      .catch((err) => {
        console.error("Failed to copy:", err)
      })
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Character Packer</CardTitle>
        <CardDescription>
          Pack multiple characters into single Unicode characters to reduce string length
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="2-1" value={packerType} onValueChange={setPackerType}>
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="2-1">2-1 Packer</TabsTrigger>
            <TabsTrigger value="2-1+">2-1+ Packer</TabsTrigger>
            <TabsTrigger value="3-1">3-1 Packer</TabsTrigger>
            <TabsTrigger value="4-1">4-1 Packer</TabsTrigger>
          </TabsList>

          <TabsContent value="2-1">
            <p className="text-sm text-gray-500 mb-4">
              Packs 2 characters into 1 using Unicode characters. Good for general compression.
              <br />
              <br />
              credits to Xem <a href="https://xem.github.io/obfuscatweet-reloaded/">https://xem.github.io/obfuscatweet-reloaded/</a>
            </p>
          </TabsContent>
          <TabsContent value="2-1+">
            <p className="text-sm text-gray-500 mb-4">
              Enhanced 2-1+ packer with Unicode support. Better compression for code containing Unicode chars.
              <br />
              <br />
              credits to LukeG <a href="https://github.com/lukegustafson/jspacker_21plus">https://github.com/lukegustafson/jspacker_21plus</a>
            </p>
          </TabsContent>
          <TabsContent value="3-1">
            <p className="text-sm text-gray-500 mb-4">
              Packs 3 characters into 1. Higher compression ratio but larger mapping table.
              <br />
              <br />
              credits to <a href="https://github.com/romancortes">romancortes</a>
            </p>
          </TabsContent>
          <TabsContent value="4-1">
            <p className="text-sm text-gray-500 mb-4">
              Packs 4 characters into 1. Highest compression ratio but largest mapping table.
            </p>
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Input</h3>
            <textarea
              className="w-full h-64 p-2 border rounded-md font-mono text-sm"
              value={input || ""}
              onChange={(e) => setInput(e.target.value || "")}
              placeholder="Enter text to pack..."
            />
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Packed Output</h3>
            <textarea
              className="w-full h-64 p-2 border rounded-md font-mono text-sm"
              value={output?.packed || ""}
              readOnly
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Character Statistics</h3>
            <div className="bg-gray-100 p-3 rounded-md">
              <p className="text-sm">Original length: {stats.originalLength} characters</p>
              <p className="text-sm">Packed length: {stats.packedLength} characters</p>
              <p className="text-sm">Compression ratio: {(stats.compressionRatio * 100).toFixed(2)}%</p>
              <p className="text-sm font-medium">
                {stats.savings > 0
                  ? `Character savings: ${stats.savings} characters (${((stats.savings / stats.originalLength) * 100).toFixed(2)}%)`
                  : stats.savings < 0
                    ? `Character increase: ${Math.abs(stats.savings)} characters (${((Math.abs(stats.savings) / stats.originalLength) * 100).toFixed(2)}%)`
                    : "No change in character count"}
              </p>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Byte Statistics</h3>
            <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
              <p className="text-sm">
                Original size: <span className="font-medium">{formatBytes(stats.originalBytes)}</span> (
                {stats.originalBytes} bytes)
              </p>
              <p className="text-sm">
                Packed size: <span className="font-medium">{formatBytes(stats.packedBytes)}</span> ({stats.packedBytes}{" "}
                bytes)
              </p>
              <p className="text-sm">Byte compression ratio: {(stats.byteCompressionRatio * 100).toFixed(2)}%</p>
              <p className="text-sm font-medium">
                {stats.byteSavings > 0
                  ? `Byte savings: ${formatBytes(stats.byteSavings)} (${((stats.byteSavings / stats.originalBytes) * 100).toFixed(2)}%)`
                  : stats.byteSavings < 0
                    ? `Byte increase: ${formatBytes(Math.abs(stats.byteSavings))} (${((Math.abs(stats.byteSavings) / stats.originalBytes) * 100).toFixed(2)}%)`
                    : "No byte savings"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <div>
          <Button onClick={copyOutput} disabled={(input || "").trim() === "" || !output?.packed} className="mr-2">
            Copy Packed Output
          </Button>
        </div>
        <div className="text-xs text-gray-500">
          {stats.originalBytes > 0 && (
            <>
              {stats.byteSavings > 0
                ? `Reduced from ${formatBytes(stats.originalBytes)} to ${formatBytes(stats.packedBytes)}`
                : stats.byteSavings < 0
                  ? `Increased from ${formatBytes(stats.originalBytes)} to ${formatBytes(stats.packedBytes)}`
                  : `No size change`}
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
