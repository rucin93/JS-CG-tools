/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/JS-CG-tools",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
