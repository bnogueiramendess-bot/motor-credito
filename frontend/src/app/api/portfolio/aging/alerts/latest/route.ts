import { NextResponse } from "next/server";

import { BackendError, fetchBackendOptional } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await fetchBackendOptional<Record<string, unknown>>("/portfolio/aging/alerts/latest");
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }

    return NextResponse.json({ detail: "Falha ao carregar alertas da carteira." }, { status: 500 });
  }
}

