import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Inter } from 'next/font/google'
import './globals.css'

const ui = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

const code = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-code',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Ultimate Fix-It / NanoHabitat',
  description:
    'On-device multi-modal diagnostic engine: content-addressed store, working-set governor, live module runtime, 20 validation engines, and a 60-case verification suite. Runs entirely client-side.',
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
    <html lang="en" className={`bg-background ${ui.variable} ${code.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
