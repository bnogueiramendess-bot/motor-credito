import { NextResponse } from "next/server";

import { CofaceReportReadResponse } from "@/features/analysis-journey/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type CofaceReadRequestPayload = {
  original_filename: string;
  mime_type: string;
  file_size: number;
  customer_document_number: string;
  file_content_base64: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: CofaceReadRequestPayload;
  try {
    payload = (await request.json()) as CofaceReadRequestPayload;
  } catch {
    return NextResponse.json({ detail: "Payload inválido para leitura do relatório COFACE." }, { status: 400 });
  }

  if (!payload.original_filename || !payload.customer_document_number || !payload.file_content_base64) {
    return NextResponse.json({ detail: "Arquivo e CNPJ do cliente são obrigatórios para leitura do relatório COFACE." }, { status: 400 });
  }

  try {
    const result = await fetchBackend<CofaceReportReadResponse>("/credit-report-reads/coface", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao processar o relatório COFACE." }, { status: 500 });
  }
}
