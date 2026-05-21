import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type RouteContext = {
  params: Promise<{ ruleId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { ruleId } = await context.params;
    const payload = await request.json();
    const updated = await fetchBackend(`/admin/approval-matrix/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel atualizar a regra da matriz." }, { status: 500 });
  }
}
