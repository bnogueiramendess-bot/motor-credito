import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ policyId: string }>;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const payload = await request.json();
    const result = await fetchBackend(`/credit-decision-policies/${policyId}/score-simulation/pillar-two`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel simular o Pilar 2." }, { status: 500 });
  }
}
