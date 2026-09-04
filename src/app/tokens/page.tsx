import { permanentRedirect } from "next/navigation";

export default function LegacyTokensPage() {
  permanentRedirect("/stock-tokens");
}
