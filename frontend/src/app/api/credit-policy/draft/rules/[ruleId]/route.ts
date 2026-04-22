import { NextResponse } from "next/server";

import {
  CreditPolicyRuleDto,
  UpdateCreditPolicyDraftRulePayload
} from "@/features/credit-rules/api/credit-policy.contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: {
    ruleId: string;
  };
};

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: RouteContext) {
  const numericRuleId = Number(params.ruleId);
  if (!Number.isInteger(numericRuleId)) {
    return NextResponse.json({ detail: "Identificador de regra invalido." }, { status: 400 });
  }

  let payload: UpdateCreditPolicyDraftRulePayload;
  try {
    payload = (await request.json()) as UpdateCreditPolicyDraftRulePayload;
  } catch {
    return NextResponse.json({ detail: "Payload invalido para atualizacao da regra." }, { status: 400 });
  }

  try {
    const rule = await fetchBackend<CreditPolicyRuleDto>(`/credit-policy/draft/rules/${numericRuleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(rule);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao atualizar regra do rascunho." }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  const numericRuleId = Number(params.ruleId);
  if (!Number.isInteger(numericRuleId)) {
    return NextResponse.json({ detail: "Identificador de regra invalido." }, { status: 400 });
  }

  try {
    await fetchBackend(`/credit-policy/draft/rules/${numericRuleId}`, {
      method: "DELETE"
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao excluir regra do rascunho." }, { status: 500 });
  }
}
