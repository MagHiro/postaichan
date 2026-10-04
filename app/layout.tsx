import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Tempat Taichan",
    template: "%s · Tempat Taichan",
  },
  description: "Operational ordering and POS for Tempat Taichan.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF7F1",
  colorScheme: "light",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Nonce-based CSP requires request-time rendering in Next.js 16.
  await headers();
  return (
    <html lang="id">
      <body className={`${poppins.variable}`}>{children}</body>
    </html>
  );
}
