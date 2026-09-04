import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Robin · Robinhood Chain Onchain Observatory",
  description: "Source-labeled public onchain observations for Robinhood Chain",
};

const navItems = [
  { href: "/", marker: "01", label: "Overview", description: "Chain and tracked activity" },
  { href: "/stock-tokens", marker: "02", label: "Asset Registry", description: "Canonical contracts" },
  { href: "/capital-flow", marker: "03", label: "Transfers", description: "Raw onchain movement" },
  { href: "/opportunities", marker: "04", label: "Activity Lens", description: "Evidence-based ranking" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <div className="app-shell">
          <aside className="app-sidebar">
            <Link href="/" className="brand-block">
              <span className="brand-mark">R</span>
              <span><strong>Robin</strong><small>Onchain Observatory</small></span>
            </Link>

            <nav className="primary-nav" aria-label="Primary navigation">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  <span className="nav-marker">{item.marker}</span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                </Link>
              ))}
            </nav>

            <div className="sidebar-bottom">
              <Link href="/settings/data-sources" className="source-link"><span className="source-pulse" /> Data sources & health</Link>
              <div className="scope-card"><span>INDEX SCOPE</span><strong>Canonical tokens</strong><p>Free public APIs · bounded collection · no synthetic activity</p></div>
            </div>
          </aside>

          <div className="app-content">
            <header className="topbar">
              <div><span className="network-dot" /> Robinhood Chain <b>4663</b></div>
              <div className="topbar-links">
                <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Explorer ↗</a>
                <a href="https://github.com/Jeonyomi/robin" target="_blank" rel="noreferrer">Source ↗</a>
              </div>
            </header>
            <nav className="mobile-nav" aria-label="Mobile navigation">
              {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            </nav>
            <main>{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
