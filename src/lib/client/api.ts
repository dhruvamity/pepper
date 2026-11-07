"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

let tokenGetter: () => Promise<string | null> = async () => null;
let onUnauthorized: (() => void) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}

/** Called when the server rejects our token (expired session, rotated secret…). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function getToken() {
  return tokenGetter();
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {},
): Promise<T> {
  const token = await tokenGetter();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    keepalive: init.keepalive,
  });
  if (!res.ok) {
    if (res.status === 401 && token && token === await tokenGetter()) onUnauthorized?.();
    let data: { error?: string; issues?: string[] } | undefined;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    const msg = data?.error ? `${data.error}${data.issues?.length ? `: ${data.issues.join("; ")}` : ""}` : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, data);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const fetcher = <T,>(path: string) => api<T>(path);

/** Upload a blob to a presigned URL with progress (XHR gives upload progress events). */
export function uploadBlob(
  target: { url: string; method: string; headers: Record<string, string> },
  blob: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}). ${xhr.status === 403 ? "Check bucket CORS / credentials." : xhr.responseText.slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("Network error during upload — is CORS configured on the bucket?"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}
