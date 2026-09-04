import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    data: [],
    meta: {
      status: "withheld",
      reason: "Cross-token ranking and momentum are withheld until per-token observation exposure and truncation are comparable.",
      investmentRecommendation: false,
    },
  });
}
