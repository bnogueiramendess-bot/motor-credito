export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseError(response: Response) {
  try {
    const data = (await response.json()) as { detail?: string; message?: string };
    return data.detail ?? data.message ?? "Erro inesperado ao processar a requisição.";
  } catch {
    return "Erro inesperado ao processar a requisição.";
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(url: string) => request<T>(url, { method: "GET" }),
  post: <TResponse, TBody>(url: string, body: TBody) =>
    request<TResponse>(url, {
      method: "POST",
      body: JSON.stringify(body)
    })
};
