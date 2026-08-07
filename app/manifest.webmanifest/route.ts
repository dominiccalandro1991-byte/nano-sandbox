/**
 * Served as a route so the manifest can never drift from the app metadata.
 * Enables Add to Home Screen on iOS with a standalone, dark-themed shell.
 */
export const dynamic = "force-static"

export function GET() {
  const manifest = {
    name: "NanoHabitat Sandbox Engine",
    short_name: "NanoHabitat",
    description:
      "On-device content-addressed habitat engine with a deduplicating store, working-set governor, and live module runtime.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1b1d22",
    theme_color: "#1b1d22",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  }

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=3600",
    },
  })
}
