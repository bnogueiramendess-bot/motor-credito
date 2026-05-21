import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export async function GET() {
  try {
    const nextCode = await fetchBackend("/admin/approval-matrix/next-code");
    return NextResponse.json(nextCode);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar o proximo codigo da matriz." }, { status: 500 });
  }
}
