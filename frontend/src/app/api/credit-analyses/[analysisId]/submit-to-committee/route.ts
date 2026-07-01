import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    analysisId: string;
  };
};

type SubmitToCommitteeBody = {
  justification?: string | null;
};

export async function POST(request: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da analise invalido." }, { status: 400 });
  }

  let body: SubmitToCommitteeBody;
  try {
    body = (await request.json()) as SubmitToCommitteeBody;
  } catch {
    return NextResponse.json({ detail: "Payload invalido." }, { status: 400 });
  }

  try {
    const payload = await fetchBackend(`/credit-analyses/${analysisId}/submit-to-committee`, {
      method: "POST",
      body: JSON.stringify({
        justification: body.justification ?? "",
      }),
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao submeter ao Comite." }, { status: 500 });
  }
}