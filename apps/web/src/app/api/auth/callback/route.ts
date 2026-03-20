import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export async function GET(req: NextRequest) {
  // Forward the entire query string to the backend
  const queryString = req.nextUrl.searchParams.toString();
  return NextResponse.redirect(`${API_URL}/api/auth/callback?${queryString}`);
}
