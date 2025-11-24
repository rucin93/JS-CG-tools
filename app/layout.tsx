import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "JavaScript Code Compression Swiss Army Knife Toolkit",
  description:
    "Advanced JavaScript code compression tool that uses regular expressions to achieve better compression ratios than traditional minifiers.",
  keywords: "RegPack, JavaScript, compression, minification, code optimization, regular expressions",
  authors: [{ name: "rucin93" }],
  openGraph: {
    title: "JavaScript Code Compression Swiss Army Knife Toolkit",
    description: "Advanced JavaScript compression",
    url: "https://regpack.io",
    siteName: "RegPack",
    images: [
      {
        url: "/regpack-logo.png",
        width: 1200,
        height: 630,
        alt: "RegPack Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "JavaScript Code Compression Swiss Army Knife Toolkit",
    description: "Advanced JavaScript compression using regular expressions patterns",
    images: ["/regpack-logo.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="bg-gray-800 text-white p-4">
          <div className="container mx-auto">
            <h1 className="text-2xl font-bold">JavaScript Code Compression</h1>
            <p className="text-sm text-gray-300">Swiss Army Knife Toolkit</p>
          </div>
        </header>
        {children}
        <footer className="bg-gray-100 p-4 mt-8">
          <div className="container mx-auto text-center text-gray-600 text-sm">
            <p>JavaScript Code Compression Tools</p>
            <p className="mt-2">© {new Date().getFullYear()} rucin93. All rights reserved.</p>
          </div>
        </footer>
      </body>
    </html>
  )
}
