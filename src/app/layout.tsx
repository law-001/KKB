import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/server/auth-actions";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "KKB",
  description:
    "Kanya-kanyang bayad — bill splitting for the messy reality of group spending",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-zinc-50 font-sans text-zinc-900 antialiased">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link
              href={user ? "/groups" : "/"}
              className="text-lg font-bold tracking-tight"
            >
              KK<span className="text-emerald-600">B</span>
              <span className="ml-2 hidden text-xs font-normal text-zinc-400 sm:inline">
                kanya-kanyang bayad
              </span>
            </Link>
            {user ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-zinc-500">{user.name}</span>
                <form action={logout}>
                  <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-zinc-600 hover:bg-zinc-100">
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Link
                  href="/login"
                  className="px-2.5 py-1 text-zinc-600 hover:text-zinc-900"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
