import {
  clearAuthCookies,
  getAccessTokenFromCookies,
  getRefreshTokenFromCookies,
  setAuthCookies
} from "@/shared/server/auth-cookies";

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

async function tryRefreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshTokenFromCookies();
  if (!refreshToken) {
    return null;
  }

  const response = await fetch(`${BACKEND_API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { access_token: string; refresh_token: string };
  await setAuthCookies(payload.access_token, payload.refresh_token);
  return payload.access_token;
}

export async function fetchBackend<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BACKEND_API_URL}${path}`;
  let accessToken = await getAccessTokenFromCookies();
  let response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options?.headers ?? {})
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      accessToken = refreshedToken;
      response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(options?.headers ?? {})
        },
        cache: "no-store"
      });
    } else {
      await clearAuthCookies();
    }
  }

  if (!response.ok) {
    throw new BackendError(await parseErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchBackendOptional<T>(path: string): Promise<T | null> {
  const url = `${BACKEND_API_URL}${path}`;
  let accessToken = await getAccessTokenFromCookies();
  let response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      accessToken = refreshedToken;
      response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        cache: "no-store"
      });
    } else {
      await clearAuthCookies();
    }
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new BackendError(await parseErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}
