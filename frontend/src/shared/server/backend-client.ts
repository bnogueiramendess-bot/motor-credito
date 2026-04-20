const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";

export class BackendError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

async function parseErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    return payload.detail ?? payload.message ?? "Erro ao consultar o backend.";
  } catch {
    return "Erro ao consultar o backend.";
  }
}

export async function fetchBackend<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BACKEND_API_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new BackendError(await parseErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function fetchBackendOptional<T>(path: string): Promise<T | null> {
  const url = `${BACKEND_API_URL}${path}`;
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new BackendError(await parseErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}
