import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    requestId: string;
  };
};

export async function GET(_: Request, { params }: RouteContext) {
  try {
    const payload = await fetchBackend(
      `/credit-decision-policies/governance-requests/${params.requestId}/executive-summary`,
    );
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar o resumo executivo da politica." }, { status: 500 });
  }
}
