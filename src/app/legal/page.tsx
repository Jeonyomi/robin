import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal, privacy and data use",
  description: "Terms, privacy, attribution, and methodology boundaries for Robin Onchain Observatory.",
  alternates: { canonical: "/legal" },
};

export default function LegalPage() {
  return (
    <div className="page-shell legal-page">
      <header className="section-hero">
        <div>
          <p className="eyebrow">PUBLIC USE BOUNDARIES</p>
          <h1>Legal, privacy & data use</h1>
          <p>Plain-language conditions for using this independent public-data observatory.</p>
        </div>
      </header>

      <section className="legal-grid">
        <article className="panel">
          <h2>Independent project</h2>
          <p>Robin is an independent research project with publicly viewable source code. It is not affiliated with, sponsored by, or endorsed by Robinhood Markets, Inc. Robinhood names and marks belong to their respective owners.</p>
        </article>
        <article className="panel">
          <h2>Informational use only</h2>
          <p>The service provides descriptive observations of public blockchain data. It does not provide investment, legal, tax, trading, or financial advice and does not recommend any token or transaction.</p>
        </article>
        <article className="panel">
          <h2>Sources and limits</h2>
          <p>Canonical asset references come from Robinhood&apos;s public asset endpoint. Chain statistics, contract metadata, and transfer logs come from Blockscout. Collection is rotating, page-bounded, batch-updated, and may be incomplete, delayed, duplicated across retries, or affected by upstream changes and chain reorganizations.</p>
          <p>LP Leaders ranks a small observed NFT sample by lifetime recorded WETH fees only, not total profit or investment return. Principal withdrawals are excluded; other token fees and spot-valued inventory are separate. Records may span previous owners. Pool prices can be manipulated or illiquid, and NPM accounting can differ from exact received cash. No global top ranking, APR/APY, token safety or executable price is asserted. Use of upstream data remains subject to provider terms and policies.</p>
        </article>
        <article className="panel">
          <h2>Privacy</h2>
          <p>The application has no user accounts, wallet connection, advertising tracker, or profiling system. LP Leaders automatically requests a public NFT sample; it does not ask for your wallet or position ID and does not attribute public NFT owners or lifetime fee records to you. Legacy manual scenarios in this browser&apos;s local storage remain untouched and are not uploaded or used as chain evidence. Those records are not encrypted; shared browser profiles, extensions and site-data clearing can affect them.</p>
          <p>The server reads public NFT, pool and event records from the official Robinhood Chain RPC. These requests and page visits may appear in standard hosting/RPC logs, including IP address, user agent and timestamps under provider retention policies. No portfolio is saved, no financial transaction is submitted, and no Telegram notification or background price polling is started. The previous read-only position API remains available, but personal token-ID entry is no longer the page flow.</p>
        </article>
        <article className="panel">
          <h2>Availability and liability</h2>
          <p>The service is provided as-is and may change or become unavailable. Verify material facts against the linked explorer and original sources before relying on them. To the extent permitted by law, the maintainers are not responsible for losses arising from use of the service.</p>
        </article>
        <article className="panel">
          <h2>Questions and corrections</h2>
          <p>Report source, methodology, or privacy concerns through the public GitHub repository. Include the route, timestamp, and linked transaction evidence where possible.</p>
          <p><a className="text-link" href="https://github.com/Jeonyomi/robin/issues" target="_blank" rel="noreferrer">Open a GitHub issue ↗</a></p>
        </article>
      </section>

      <footer className="method-footer">Effective 5 September 2026. Material changes will be reflected in the public repository.</footer>
    </div>
  );
}
