import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  const bu = searchParams.get("bu");
  const q = searchParams.get("q");
  if (bu) query.set("bu", bu);
  if (q) query.set("q", q);
  const suffix = query.toString();
  const path = suffix ? `/portfolio/groups?${suffix}` : "/portfolio/groups";
  try {
    const payload = await fetchBackend<unknown>(path);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar grupos da carteira." }, { status: 500 });
  }
}
