import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit");
    const query = new URLSearchParams();
    if (limit) {
      query.set("limit", limit);
    }

    const suffix = query.toString();
    const path = suffix ? `/ar-aging-imports/history?${suffix}` : "/ar-aging-imports/history";
    const payload = await fetchBackend<Record<string, unknown>>(path);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar histórico de importações." }, { status: 500 });
  }
}

