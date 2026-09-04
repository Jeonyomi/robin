import { permanentRedirect } from "next/navigation";

export default function LegacyTokenDetailPage() {
  permanentRedirect("/stock-tokens");
}
