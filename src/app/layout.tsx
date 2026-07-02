import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "KKB",
  description:
    "Kanya-kanyang bayad — bill splitting for the messy reality of group spending",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-zinc-50 font-sans text-zinc-900 antialiased">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/groups" className="text-lg font-bold tracking-tight">
              KK<span className="text-emerald-600">B</span>
              <span className="ml-2 hidden text-xs font-normal text-zinc-400 sm:inline">
                kanya-kanyang bayad
              </span>
            </Link>
            <Link
              href="/groups"
              className="text-sm text-zinc-600 hover:text-zinc-900"
            >
              Groups
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
