import { NextResponse } from "next/server";

import { clearAuthCookies } from "@/shared/server/auth-cookies";

export async function POST() {
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
