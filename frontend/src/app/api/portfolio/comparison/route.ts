import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromSnapshotId = searchParams.get("from_snapshot_id");
  const toSnapshotId = searchParams.get("to_snapshot_id");

  const query = new URLSearchParams();
  if (fromSnapshotId) query.set("from_snapshot_id", fromSnapshotId);
  if (toSnapshotId) query.set("to_snapshot_id", toSnapshotId);
  const suffix = query.toString();
  const path = suffix ? `/portfolio/comparison?${suffix}` : "/portfolio/comparison";

  try {
    const payload = await fetchBackend<unknown>(path);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar comparacao da carteira." }, { status: 500 });
  }
}

