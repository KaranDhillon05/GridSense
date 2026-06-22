import { NextRequest, NextResponse } from "next/server";
import { forecast, type EventInput } from "@/lib/gridsense";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as EventInput;
  return NextResponse.json(forecast(body));
}
