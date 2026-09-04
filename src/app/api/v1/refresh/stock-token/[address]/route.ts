import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Public token refresh is not available",
      message: "Observations are updated only by the protected scheduled collector.",
    },
    { status: 410 },
  );
}
