import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BRP Store Ops',
  description: 'Store operations dashboard for 99 Pancakes and Baskin Robbins',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
