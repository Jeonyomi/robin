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
  { href: "/", label: "Chain Pulse", icon: "📊", description: "Overview" },
  { href: "/opportunities", label: "Opportunity Radar", icon: "🎯", description: "Rankings" },
  { href: "/stock-tokens", label: "Stock Token Radar", icon: "📈", description: "Canonical" },
  { href: "/tokens", label: "Token Scanner", icon: "🔍", description: "Discovery" },
  { href: "/capital-flow", label: "Capital Flow", icon: "💰", description: "Bridge & DEX" },
  { href: "/smart-money", label: "Smart Money", icon: "🧠", description: "Wallets" },
  { href: "/alerts", label: "Alerts", icon: "🔔", description: "Signals" },
];

const settingsItems = [
  { href: "/watchlist", label: "Watchlist", icon: "★" },
  { href: "/settings/data-sources", label: "Data Sources", icon: "⚙️" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-foreground`}>
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-60 border-r bg-card flex flex-col">
            {/* Logo */}
            <div className="p-4 border-b">
              <h1 className="text-lg font-bold tracking-tight">🦉 Robin</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Robinhood Chain · 4663
              </p>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-3 space-y-0.5">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors group"
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            {/* Settings */}
            <div className="p-3 border-t">
              {settingsItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground"
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>

            {/* Footer */}
            <div className="p-3 border-t">
              <div className="p-2 rounded-md bg-muted/50 text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium">Data Freshness</p>
                <p>Last sync: Check Data Sources</p>
                <p>Explorer: Blockscout</p>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            {/* Global header */}
            <header className="border-b bg-card px-6 py-3 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Chain: Robinhood Mainnet · Chain ID 4663
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <a
                  href="https://robinhoodchain.blockscout.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  Blockscout ↗
                </a>
                <a
                  href="https://github.com/Jeonyomi/robin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  GitHub ↗
                </a>
              </div>
            </header>

            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
