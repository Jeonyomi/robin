import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { SiteAnalytics } from "@/components/site-analytics";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://robinwatch24.vercel.app"),
  title: {
    default: "Robinwatch · Robinhood Chain Onchain Observatory",
    template: "%s · Robinwatch Onchain Observatory",
  },
  description: "Independent, source-labeled observations of public Robinhood Chain data. Bounded samples, raw evidence, and explicit limits; no investment signals.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "Robinwatch · Robinhood Chain Onchain Observatory",
    description: "Independent, source-labeled observations of public Robinhood Chain data.",
    siteName: "Robinwatch Onchain Observatory",
    images: [{ url: "/og-robinwatch.png", width: 1200, height: 630, alt: "Robinwatch: Evidence-first analytics for Robinhood Chain" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@robinwatch24",
    creator: "@robinwatch24",
    title: "Robinwatch · Robinhood Chain Onchain Observatory",
    description: "Independent, source-labeled observations of public Robinhood Chain data.",
    images: [{ url: "/og-robinwatch.png", alt: "Robinwatch: Evidence-first analytics for Robinhood Chain" }],
  },
  robots: { index: true, follow: true },
};

const navItems = [
  { href: "/", marker: "01", label: "Overview", description: "Chain and tracked activity" },
  { href: "/stock-tokens", marker: "02", label: "Asset Registry", description: "Canonical contracts" },
  { href: "/capital-flow", marker: "03", label: "Transfers", description: "Raw onchain evidence" },
  { href: "/opportunities", marker: "04", label: "Activity Lens", description: "Observed activity ranking" },
  { href: "/liquidity", marker: "05", label: "Meme & Stock Pairs", description: "Pair discovery and pool research" },
  { href: "/meme-leaders", marker: "06", label: "Meme Leaders", description: "Trending tokens and market activity" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <div className="app-shell">
          <aside className="app-sidebar">
            <Link href="/" className="brand-block">
              <span className="brand-mark">R</span>
              <span><strong>Robinwatch</strong><small>Onchain Observatory</small></span>
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
                <Link href="/legal">Legal & privacy</Link>
                <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Explorer ↗</a>
                <a href="https://github.com/Jeonyomi/robin" target="_blank" rel="noreferrer">Source ↗</a>
                <a href="https://x.com/robinwatch24" target="_blank" rel="noopener noreferrer" aria-label="Robinwatch on X (@robinwatch24)">X ↗</a>
              </div>
            </header>
            <nav className="mobile-nav" aria-label="Mobile navigation">
              {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
              <Link href="/legal">Legal</Link>
            </nav>
            <main id="main-content">{children}</main>
            <footer className="site-footer">
              <p>Independent public-source research project. Not affiliated with or endorsed by Robinhood Markets, Inc.</p>
              <p><a href="https://x.com/robinwatch24" target="_blank" rel="noopener noreferrer">X @robinwatch24 ↗</a> · <Link href="/legal">Terms, privacy & data use</Link> · No investment advice</p>
            </footer>
          </div>
        </div>
        <SiteAnalytics />
      </body>
    </html>
  );
}
