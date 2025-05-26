import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Fidelatam – Sistema de IA desarrollado por Antualia",
  description:
    "Desarrollado por Antualia.",
  icons: {
    icon: "https://sutton-facturas.s3.us-east-1.amazonaws.com/Fidelatam.ico",
    shortcut: "https://sutton-facturas.s3.us-east-1.amazonaws.com/Fidelatam.ico",
    apple: "https://sutton-facturas.s3.us-east-1.amazonaws.com/Fidelatam.ico",
  },
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
