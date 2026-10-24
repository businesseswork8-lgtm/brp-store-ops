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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Pure number entry: prevent mouse wheel / trackpad scroll from sliding number inputs
              document.addEventListener('wheel', function(e) {
                if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') {
                  document.activeElement.blur();
                }
              }, { passive: true });
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
