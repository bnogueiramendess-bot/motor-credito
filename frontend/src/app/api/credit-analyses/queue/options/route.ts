import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await fetchBackend("/credit-analyses/queue/options");
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar opções da fila operacional." }, { status: 500 });
  }
}
