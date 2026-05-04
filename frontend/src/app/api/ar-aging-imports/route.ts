import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await fetchBackend<Record<string, unknown>>("/ar-aging-imports", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao importar base Aging AR." }, { status: 500 });
  }
}

