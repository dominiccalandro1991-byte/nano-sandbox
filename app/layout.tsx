import type { Metadata, Viewport } from 'next'
import './globals.css'

// Deliberately not next/font/google: that fetches from fonts.googleapis.com
// at build time, which fails in any network-restricted build environment
// (this is exactly what was breaking `next build` throughout earlier
// verification sessions). A system font stack renders instantly with no
// network dependency and no FOUT/layout shift, and on Apple platforms in
// particular closely matches Inter/IBM Plex Mono's proportions anyway.
const FONT_UI_STACK =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif'
const FONT_CODE_STACK =
  'ui-monospace, "SF Mono", "SFMono-Regular", "Cascadia Code", "Fira Code", "IBM Plex Mono", Menlo, Consolas, monospace'

export const metadata: Metadata = {
  title: 'Ultimate Fix-It / NanoHabitat',
  description:
    'On-device multi-modal diagnostic engine: content-addressed store, working-set governor, live module runtime, 24 validation engines, and a 60-case verification suite. Runs entirely client-side.',
  applicationName: 'Ultimate Fix-It',
  appleWebApp: {
    capable: true,
    title: 'Ultimate Fix-It',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  // Explicit basePath prefix so GitHub Pages (project site) resolves assets.
  manifest: '/nano-sandbox/manifest.webmanifest',
  icons: {
    icon: [{ url: '/nano-sandbox/icon.svg', type: 'image/svg+xml' }],
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1b1d22',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className="bg-background"
      style={{ ['--font-ui' as string]: FONT_UI_STACK, ['--font-code' as string]: FONT_CODE_STACK }}
    >
      <body className="antialiased">{children}</body>
    </html>
  )
}
