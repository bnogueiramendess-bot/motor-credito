import { NextResponse } from "next/server";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ detail: "Token de convite ausente." }, { status: 400 });
  }

  const response = await fetch(`${BACKEND_API_URL}/auth/invite-preview?token=${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      { detail: data.detail ?? "Nao foi possivel validar o link de primeiro acesso." },
      { status: response.status }
    );
  }

  return NextResponse.json(data);
}
