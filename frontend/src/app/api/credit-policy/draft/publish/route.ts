import { NextResponse } from "next/server";

import { CreditPolicyDto } from "@/features/credit-rules/api/credit-policy.contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const policy = await fetchBackend<CreditPolicyDto>("/credit-policy/draft/publish", {
      method: "POST",
      body: JSON.stringify({})
    });
    return NextResponse.json(policy);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao publicar o rascunho da politica." }, { status: 500 });
  }
}
