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
          <p>Use of upstream data remains subject to the source providers&apos; applicable terms and policies.</p>
        </article>
        <article className="panel">
          <h2>Privacy</h2>
          <p>The application has no user accounts, wallet connection, advertising tracker, or profiling system. It does not intentionally collect wallet ownership claims or personal financial records. Hosting and network providers may process standard request metadata such as IP address, user agent, and timestamps under their own policies and retention practices.</p>
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

      <footer className="method-footer">Effective 4 September 2026. Material changes will be reflected in the public repository.</footer>
    </div>
  );
}
