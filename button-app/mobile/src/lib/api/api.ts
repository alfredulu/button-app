import { fetch } from "expo/fetch";
import { supabase } from "@/lib/auth/supabase";
import {
  explainBackendConnectionFailure,
  getBackendBaseUrl,
  isPhysicalDeviceUsingLocalhostBackend,
} from "@/lib/api/backend-url";

interface ApiResponse<T> {
  data: T;
}

export interface ApiError extends Error {
  status: number;
  code: "TIMEOUT" | "RATE_LIMITED" | "PAYLOAD_TOO_LARGE" | "HTTP_ERROR" | "NETWORK_ERROR";
  retryAfter?: number;
}

function makeApiError(
  message: string,
  status: number,
  code: ApiError["code"],
  retryAfter?: number
): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  if (retryAfter !== undefined) err.retryAfter = retryAfter;
  return err;
}

const REQUEST_TIMEOUT_MS = 30_000;

const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {}
): Promise<T> => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    throw makeApiError(
      "EXPO_PUBLIC_BACKEND_URL is missing. Add it to mobile/.env (use your PC’s LAN IP:3000 on a real phone, not localhost).",
      0,
      "NETWORK_ERROR"
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      const msg = isPhysicalDeviceUsingLocalhostBackend()
        ? explainBackendConnectionFailure()
        : "Request timed out. Please check your connection and try again.";
      throw makeApiError(msg, 0, "TIMEOUT");
    }
    const netMsg = isPhysicalDeviceUsingLocalhostBackend()
      ? explainBackendConnectionFailure()
      : "Network error. Please check your connection and try again.";
    throw makeApiError(netMsg, 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    let retryAfterSeconds: number | undefined;
    if (retryAfterHeader !== null) {
      const delta = parseInt(retryAfterHeader, 10);
      if (!isNaN(delta)) retryAfterSeconds = delta;
      else {
        const retryDate = new Date(retryAfterHeader).getTime();
        if (!isNaN(retryDate)) retryAfterSeconds = Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
      }
    }
    const waitMsg =
      retryAfterSeconds !== undefined
        ? ` Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} before trying again.`
        : " Please try again shortly.";
    throw makeApiError(`Too many requests.${waitMsg}`, 429, "RATE_LIMITED", retryAfterSeconds);
  }

  if (response.status === 413) {
    throw makeApiError("The data you sent is too large. Try a shorter recording or smaller file.", 413, "PAYLOAD_TOO_LARGE");
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    let serverMessage: string | undefined;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      try {
        const errBody = await response.json();
        serverMessage = errBody?.error?.message;
      } catch {}
    }
    throw makeApiError(serverMessage ?? `Request failed with status ${response.status}.`, response.status, "HTTP_ERROR");
  }

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const json: ApiResponse<T> = await response.json();
    return json.data;
  }
  return undefined as T;
};

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) => request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  patch: <T>(url: string, body: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
};

