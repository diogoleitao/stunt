import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { appStunt } from "./app-stunt.ts";
import { RepositoryNav } from "./repository-nav.tsx";
import "./globals.css";

export const metadata = {
  title: "stunt",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const model = await appStunt().pageModel();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="flex min-h-svh">
            <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
              <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
                <Link href="/" className="font-semibold tracking-tight">
                  stunt
                </Link>
                <ThemeToggle />
              </div>
              <RepositoryNav
                repositories={model.repositories.map(({ name, counts }) => ({ name, counts }))}
              />
            </aside>
            <main className="min-w-0 flex-1 p-8">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
