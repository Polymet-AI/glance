import type { ReactNode } from "react"

import "./globals.css"

export const metadata = {
  title: "Design review",
  description: "Render a page, score its design, and separate what is measured from what is judged.",
}

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body>{children}</body>
  </html>
)

export default RootLayout
