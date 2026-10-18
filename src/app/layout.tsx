import type { Metadata } from "next";
import { Martian_Mono, Mona_Sans } from "next/font/google";
import "./globals.css";

// One family at two widths: expanded and heavy for display, normal for text.
const sans = Mona_Sans({
  variable: "--font-mona",
  subsets: ["latin"],
  axes: ["wdth"],
});

const mono = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Hiring Panel",
  description: "Run a resume past seven reviewers, rebuild it, and get projects that close the gaps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
