import { NextRequest, NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ policyId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { policyId } = await context.params;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const payload = await fetchBackend(`/credit-decision-policies/${policyId}/versions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel criar a nova versao da politica." }, { status: 500 });
  }
}
