import { permanentRedirect } from "next/navigation";

export default function LegacyWatchlistPage() {
  permanentRedirect("/stock-tokens");
}
