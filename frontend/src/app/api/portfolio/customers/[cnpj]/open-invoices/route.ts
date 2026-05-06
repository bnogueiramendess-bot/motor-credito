import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    cnpj: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  const cnpj = decodeURIComponent(context.params.cnpj);
  try {
    const payload = await fetchBackend<unknown>(`/portfolio/customers/${encodeURIComponent(cnpj)}/open-invoices`);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar NFs em aberto do cliente." }, { status: 500 });
  }
}
