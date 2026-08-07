import { Analytics } from '@vercel/analytics/next'
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
  title: 'NanoHabitat Sandbox Engine',
  description:
    'On-device content-addressed habitat engine: deduplicating store, working-set governor, live module runtime, and a 60-case verification suite. Runs entirely inside iOS Safari.',
  generator: 'v0.app',
  applicationName: 'NanoHabitat',
  appleWebApp: {
    capable: true,
    title: 'NanoHabitat',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-dark-32x32.png' },
    ],
    apple: '/apple-icon.png',
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
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
