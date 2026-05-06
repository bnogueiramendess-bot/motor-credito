import { NextResponse } from "next/server";

import { BackendError, fetchBackendOptional } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get("snapshot_id");
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";

  try {
    const payload = await fetchBackendOptional<Record<string, unknown>>(`/portfolio/aging/movements/latest${suffix}`);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar movimentos da carteira." }, { status: 500 });
  }
}
