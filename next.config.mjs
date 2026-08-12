/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for pure GitHub Pages hosting (no Node server required).
  output: "export",
  // Project-site path under https://<user>.github.io/<repo>/
  basePath: "/nano-sandbox",
  assetPrefix: "/nano-sandbox",
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
