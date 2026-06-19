import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ policyId: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const structure = await fetchBackend(`/credit-decision-policies/${policyId}/score-structure`);
    return NextResponse.json(structure);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar a estrutura de score." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { policyId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const structure = await fetchBackend(`/credit-decision-policies/${policyId}/score-structure`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return NextResponse.json(structure);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel salvar a estrutura de score." }, { status: 500 });
  }
}
