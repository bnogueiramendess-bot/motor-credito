import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = await fetchBackend("/credit-analyses/draft", {
      method: "POST",
      body: JSON.stringify(body)
    });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Não foi possível iniciar a solicitação. Tente novamente." }, { status: 500 });
  }
}

