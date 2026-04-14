import { fetch } from "expo/fetch";
import { supabase } from "../auth/supabase";

interface ApiResponse<T> {
  data: T;
}

// Security: structured error type keeps sensitive details off the console
// and gives callers a stable shape to handle without exposing internals.
export interface ApiError extends Error {
  status: number;
  code: "TIMEOUT" | "RATE_LIMITED" | "PAYLOAD_TOO_LARGE" | "HTTP_ERROR" | "NETWORK_ERROR";
  /** For 429 responses: seconds the caller should wait before retrying. */
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

// 30-second hard ceiling. Without a timeout a stalled TCP connection
// can block the UI indefinitely and drain battery.
const REQUEST_TIMEOUT_MS = 30_000;

const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;

const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {}
): Promise<T> => {
  // Retrieve the session token at call time so we always use the freshest
  // value. We deliberately avoid logging the token anywhere in this file.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  // AbortController provides the timeout mechanism. When the signal fires
  // after REQUEST_TIMEOUT_MS, fetch throws a DOMException("AbortError") which
  // we catch below and convert into a typed ApiError.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Use inferred type from expo/fetch rather than the built-in Response
  // to avoid a TypeScript incompatibility between ArrayBufferLike and ArrayBuffer.
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        // Security: the Authorization header is only set when a token exists.
        // We never include the raw token value in any logged error message.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    // AbortError means our own timeout fired, not a server-side cancellation.
    if (err instanceof Error && err.name === "AbortError") {
      throw makeApiError(
        "Request timed out. Please check your connection and try again.",
        0,
        "TIMEOUT"
      );
    }

    // Any other fetch-level error (DNS failure, no network, etc.).
    // Security: we do NOT forward err.message to the user or into logs
    // because it can contain the full URL including path parameters.
    throw makeApiError(
      "Network error. Please check your connection and try again.",
      0,
      "NETWORK_ERROR"
    );
  } finally {
    // Always clear the timeout once the fetch settles to avoid a stale
    // timer firing after the function has already returned or thrown.
    clearTimeout(timeoutId);
  }

  // --- HTTP-level error handling ---

  // 429 Too Many Requests: surface a human-readable message and honour the
  // Retry-After header so callers can implement back-off without guessing.
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    // Retry-After can be a delta-seconds integer or an HTTP-date string.
    // We try delta-seconds first (most common) and fall back to date math.
    let retryAfterSeconds: number | undefined;
    if (retryAfterHeader !== null) {
      const delta = parseInt(retryAfterHeader, 10);
      if (!isNaN(delta)) {
        retryAfterSeconds = delta;
      } else {
        const retryDate = new Date(retryAfterHeader).getTime();
        if (!isNaN(retryDate)) {
          retryAfterSeconds = Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
        }
      }
    }

    const waitMsg = retryAfterSeconds !== undefined
      ? ` Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} before trying again.`
      : " Please try again shortly.";

    throw makeApiError(
      `Too many requests.${waitMsg}`,
      429,
      "RATE_LIMITED",
      retryAfterSeconds
    );
  }

  // 413 Payload Too Large: occurs when an audio file or body exceeds the
  // server's size limit. Give the user an actionable message.
  if (response.status === 413) {
    throw makeApiError(
      "The data you sent is too large. Try a shorter recording or smaller file.",
      413,
      "PAYLOAD_TOO_LARGE"
    );
  }

  // 204 No Content: valid success with no body.
  if (response.status === 204) return undefined as T;

  // Security: check response.ok BEFORE attempting to parse JSON. Parsing an
  // error body without checking status first can silently swallow non-2xx
  // responses that happen to include valid-looking JSON (e.g. a 401 that
  // returns { data: null }).
  if (!response.ok) {
    // Attempt to extract a server-provided message for developer context,
    // but never include auth headers or request internals in the thrown error.
    let serverMessage: string | undefined;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      try {
        const errBody = await response.json();
        // Follow the project error envelope: { error: { message, code } }
        serverMessage = errBody?.error?.message;
      } catch {
        // JSON parse failed — ignore and use the generic message below.
      }
    }

    throw makeApiError(
      serverMessage ?? `Request failed with status ${response.status}.`,
      response.status,
      "HTTP_ERROR"
    );
  }

  // Happy path: only reached for 2xx responses.
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    // Unwrap the { data: ... } envelope that all app routes use.
    const json: ApiResponse<T> = await response.json();
    return json.data;
  }

  return undefined as T;
};

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
};
