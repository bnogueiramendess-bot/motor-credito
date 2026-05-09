import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const suffix = searchParams.toString();
  const path = suffix ? `/credit-analyses/monitor?${suffix}` : "/credit-analyses/monitor";
  try {
    const payload = await fetchBackend(path);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar monitor de solicitações." }, { status: 500 });
  }
}
