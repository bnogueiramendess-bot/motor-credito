import { NextResponse } from "next/server";

import { CofaceReportReadResponse } from "@/features/analysis-journey/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = { params: { readId: string } };

export async function GET(_: Request, context: Context) {
  const readId = Number(context.params.readId);
  if (!Number.isFinite(readId) || readId <= 0) {
    return NextResponse.json({ detail: "ID de leitura inválido." }, { status: 400 });
  }
  try {
    const result = await fetchBackend<CofaceReportReadResponse>(`/credit-report-reads/coface/${readId}`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao buscar leitura COFACE." }, { status: 500 });
  }
}
