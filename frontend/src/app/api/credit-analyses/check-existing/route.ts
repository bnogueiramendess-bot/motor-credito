import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cnpj = searchParams.get("cnpj");
  if (!cnpj) {
    return NextResponse.json({ detail: "Informe o CNPJ para consulta." }, { status: 400 });
  }

  try {
    const payload = await fetchBackend(`/credit-analyses/check-existing?cnpj=${encodeURIComponent(cnpj)}`);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao verificar análise existente." }, { status: 500 });
  }
}

