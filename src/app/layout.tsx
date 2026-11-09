import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { appStunt } from "./app-stunt.ts";
import { CheckNowButton } from "./check-now-button.tsx";
import { CheckStream } from "./check-stream.tsx";
import { LiveUpdates } from "./live-updates.tsx";
import { RepositoryNav } from "./repository-nav.tsx";
import { RepositorySwitcher } from "./repository-switcher.tsx";
import { parseTheme, THEME_COOKIE, themeClass } from "./theme.ts";
import { ThemeToggle } from "./theme-toggle.tsx";
import "./globals.css";

export const metadata = {
  title: "stunt",
};

// The theme the browser chose is a class on <html> from the first byte, so the
// page never shows in the other one first. Auto sets no class and follows the
// OS.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const model = await appStunt().pageModel();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="en" className={themeClass(theme)}>
      <body className="antialiased">
        <div className="flex min-h-svh">
          <aside className="sticky top-0 flex h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
              <span className="font-semibold tracking-tight">stunt</span>
              <div className="flex items-center">
                <CheckStream>
                  <CheckNowButton />
                  <LiveUpdates />
                </CheckStream>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RepositoryNav owners={model.owners} />
            </div>
            <div className="border-t border-sidebar-border p-2">
              <ThemeToggle initial={theme} />
            </div>
          </aside>
          <RepositorySwitcher names={model.repositories.map(({ name }) => name)} />
          <main className="min-w-0 flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
