import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();

  const cnpj = searchParams.get("cnpj");
  const bu = searchParams.get("bu");

  if (cnpj) {
    query.set("cnpj", cnpj);
  }

  if (bu) {
    query.set("bu", bu);
  }

  const suffix = query.toString();
  const path = suffix ? `/portfolio/customers?${suffix}` : "/portfolio/customers";

  try {
    const payload = await fetchBackend<unknown[]>(path);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }

    return NextResponse.json({ detail: "Falha ao carregar clientes da carteira." }, { status: 500 });
  }
}
