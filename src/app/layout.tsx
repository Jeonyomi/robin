import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Robinhood Chain Opportunity Intelligence",
  description: "Onchain investment intelligence terminal for Robinhood Chain",
};

const navItems = [
  { href: "/", label: "Chain Pulse", icon: "📊" },
  { href: "/opportunities", label: "Opportunity Radar", icon: "🎯" },
  { href: "/stock-tokens", label: "Stock Token Radar", icon: "📈" },
  { href: "/tokens", label: "Token Scanner", icon: "🔍" },
  { href: "/capital-flow", label: "Capital Flow", icon: "💰" },
  { href: "/smart-money", label: "Smart Money", icon: "🧠" },
  { href: "/alerts", label: "Alerts", icon: "🔔" },
  { href: "/settings/data-sources", label: "Data Sources", icon: "⚙️" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-foreground`}>
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-64 border-r bg-card p-4">
            <div className="mb-8">
              <h1 className="text-lg font-bold">🦉 Robin Intelligence</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Robinhood Chain · 4663
              </p>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            <div className="mt-8 p-3 rounded-md bg-muted text-xs text-muted-foreground">
              <p className="font-medium mb-1">Data Freshness</p>
              <p>Last sync: N/A</p>
              <p>Source: Blockscout API</p>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
