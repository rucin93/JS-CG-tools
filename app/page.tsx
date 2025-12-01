"use client"

import { initRegPack } from "@/lib/init"
import { useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import RegPackPreview from "@/components/RegPackPreview"
import RegPack2Preview from "@/components/RegPack2Preview"
import CrusherPreview from "@/components/CrusherPreview"
// Import the CharPackerPreview component
import CharPackerPreview from "@/components/CharPackerPreview"

export default function Home() {
  // Initialize RegPack when the component mounts
  useEffect(() => {
    initRegPack()
  }, [])

  return (
    <main className="container mx-auto px-4 py-8">
      <Tabs defaultValue="charpacker" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="charpacker">Character packers</TabsTrigger>
          <TabsTrigger value="regpack">RegPack</TabsTrigger>
          <TabsTrigger value="regpack2">SlowPack (Beam Search)</TabsTrigger>
          <TabsTrigger value="crusher">Regex Packers</TabsTrigger>
        </TabsList>
        <TabsContent value="regpack">
          <RegPackPreview />
        </TabsContent>
        <TabsContent value="regpack2">
          <RegPack2Preview />
        </TabsContent>
        <TabsContent value="crusher">
          <CrusherPreview />
        </TabsContent>
        <TabsContent value="charpacker">
          <CharPackerPreview />
        </TabsContent>
      </Tabs>
    </main>
  )
}
