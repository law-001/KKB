import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { UserMenu } from "@/components/user-menu";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
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
      <body className="flex min-h-dvh flex-col antialiased">
        <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link href="/groups" className="group flex items-center gap-3">
              <span className="inline-block -rotate-2 rounded-[3px] border-2 border-ink px-1.5 py-px font-mono text-sm font-bold tracking-[0.2em] transition-colors group-hover:border-accent group-hover:text-accent-deep">
                KKB
              </span>
              <span className="microlabel hidden sm:inline">
                kanya-kanyang bayad
              </span>
            </Link>
            {user ? (
              <UserMenu name={user.name} />
            ) : (
              <Link
                href="/login"
                className="btn btn-ghost min-h-9 px-3 text-sm"
              >
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
          {children}
        </main>
        <RefreshOnFocus />
        <footer className="border-t border-line-soft py-5">
          <p className="microlabel px-4 text-center normal-case tracking-normal">
            balances are derived, never stored · history is appended, never
            mutated
          </p>
        </footer>
      </body>
    </html>
  );
}
