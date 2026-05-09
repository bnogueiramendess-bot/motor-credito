import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await fetchBackend("/credit-analyses/triage/submit", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao enviar solicitacao para analise financeira." }, { status: 500 });
  }
}
