import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    economicGroup: string;
  };
};

export async function GET(request: Request, context: RouteContext) {
  const economicGroup = decodeURIComponent(context.params.economicGroup);
  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get("snapshot_id");
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";
  try {
    const payload = await fetchBackend<unknown>(`/portfolio/groups/${encodeURIComponent(economicGroup)}/open-invoices${suffix}`);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar NFs em aberto do grupo." }, { status: 500 });
  }
}
