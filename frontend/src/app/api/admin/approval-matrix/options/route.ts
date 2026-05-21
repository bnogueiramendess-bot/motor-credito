import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export async function GET() {
  try {
    const options = await fetchBackend("/admin/approval-matrix/options");
    return NextResponse.json(options);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar as opcoes da matriz." }, { status: 500 });
  }
}
