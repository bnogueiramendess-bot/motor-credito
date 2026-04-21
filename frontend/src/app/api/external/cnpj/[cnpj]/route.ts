import { NextResponse } from "next/server";

import { ExternalCnpjLookupResponse } from "@/features/analysis-journey/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    cnpj: string;
  };
};

export async function GET(_: Request, context: Context) {
  try {
    const payload = await fetchBackend<ExternalCnpjLookupResponse>(`/external/cnpj/${context.params.cnpj}`);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao consultar CNPJ externo." }, { status: 500 });
  }
}
