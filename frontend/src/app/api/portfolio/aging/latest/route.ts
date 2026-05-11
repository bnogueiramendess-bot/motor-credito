import { NextResponse } from "next/server";

import { BackendError, fetchBackendOptional } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bu = searchParams.get("bu");
  const businessUnitContext = searchParams.get("business_unit_context");
  const snapshotId = searchParams.get("snapshot_id");
  const query = new URLSearchParams();

  if (bu) {
    query.set("bu", bu);
  }
  if (snapshotId) {
    query.set("snapshot_id", snapshotId);
  }
  if (businessUnitContext) {
    query.set("business_unit_context", businessUnitContext);
  }

  const suffix = query.toString();
  const path = suffix ? `/portfolio/aging/latest?${suffix}` : "/portfolio/aging/latest";

  try {
    const payload = await fetchBackendOptional<Record<string, unknown>>(path);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }

    return NextResponse.json({ detail: "Falha ao carregar resumo da carteira." }, { status: 500 });
  }
}
