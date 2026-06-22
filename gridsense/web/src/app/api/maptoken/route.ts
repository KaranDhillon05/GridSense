import { NextResponse } from "next/server";
import { getMapplsToken } from "@/lib/gridsense";

// Hands the browser a short-lived Mappls access token to load the Web Map SDK.
// The token doubles as the SDK key. Returns { token: null } when credentials
// aren't configured, so the client falls back to the Leaflet basemap.
export async function GET() {
  const token = await getMapplsToken();
  return NextResponse.json(
    { token: token ?? null },
    {
      headers: {
        // Cache briefly at the edge; token is valid ~24h, refreshed server-side.
        "Cache-Control": "private, max-age=300",
      },
    }
  );
}
