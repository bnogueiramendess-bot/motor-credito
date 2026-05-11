import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const businessUnitContext = searchParams.get("business_unit_context");
  const suffix = businessUnitContext ? `?business_unit_context=${encodeURIComponent(businessUnitContext)}` : "";
  try {
    const payload = await fetchBackend(`/credit-analyses/queue/options${suffix}`);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar opções da fila operacional." }, { status: 500 });
  }
}
