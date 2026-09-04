import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Legacy token scoring endpoint retired",
      replacement: "/api/v1/stock-tokens",
    },
    { status: 410 },
  );
}
