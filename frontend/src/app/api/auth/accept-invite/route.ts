import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/shared/server/auth-cookies";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${BACKEND_API_URL}/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ detail: data.detail ?? "Falha no primeiro acesso." }, { status: response.status });
  }

  const store = cookies();
  store.set(ACCESS_TOKEN_COOKIE, data.tokens.access_token, { httpOnly: true, sameSite: "lax", path: "/" });
  store.set(REFRESH_TOKEN_COOKIE, data.tokens.refresh_token, { httpOnly: true, sameSite: "lax", path: "/" });
  store.set("gcc_permissions", JSON.stringify(data.user.permissions ?? []), { httpOnly: false, sameSite: "lax", path: "/" });
  return NextResponse.json(data);
}
