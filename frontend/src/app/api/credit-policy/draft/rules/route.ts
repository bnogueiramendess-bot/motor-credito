import { NextResponse } from "next/server";

import {
  CreateCreditPolicyDraftRulePayload,
  CreditPolicyRuleDto
} from "@/features/credit-rules/api/credit-policy.contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: CreateCreditPolicyDraftRulePayload;

  try {
    payload = (await request.json()) as CreateCreditPolicyDraftRulePayload;
  } catch {
    return NextResponse.json({ detail: "Payload invalido para criacao de regra." }, { status: 400 });
  }

  try {
    const rule = await fetchBackend<CreditPolicyRuleDto>("/credit-policy/draft/rules", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao criar regra no rascunho." }, { status: 500 });
  }
}
