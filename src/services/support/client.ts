/**
 * Lightweight client for the Google Cloud Support REST API.
 */
import { initGoogleAuth, getProjectId } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

export const SUPPORT_API_BASE_URL = "https://cloudsupport.googleapis.com/v2";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

type QueryValue = string | number | boolean | undefined;

export interface SupportRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  queryParams?: Record<string, QueryValue>;
  projectId?: string;
}

export class SupportApiClient {
  constructor(private readonly baseUrl: string = SUPPORT_API_BASE_URL) {}

  async request<TResponse>(endpoint: string, options: SupportRequestOptions = {}): Promise<TResponse> {
    const { method = "GET", body, queryParams, projectId } = options;

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const auth = await initGoogleAuth(true);
    if (!auth) {
      throw new GcpMcpError(
        "Google Cloud authentication is not available. Please configure credentials to use Support API tools.",
        "UNAUTHENTICATED",
        401,
      );
    }

    const [client, resolvedProjectId] = await Promise.all([
      auth.getClient(),
      projectId ? Promise.resolve(projectId) : getProjectId(),
    ]);

    const accessToken = await client.getAccessToken();
    const tokenValue = typeof accessToken === "string" ? accessToken : accessToken?.token;

    if (!tokenValue) {
      throw new GcpMcpError(
        "Unable to obtain an access token for Google Cloud Support API.",
        "UNAUTHENTICATED",
        401,
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokenValue}`,
      Accept: "application/json",
      "X-Goog-User-Project": resolvedProjectId,
    };

    let requestBody: string | undefined;
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    logger.debug(
      `Support API request: ${method} ${url.toString()}${requestBody ? ` body=${requestBody}` : ""}`,
    );

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const message = errorText
        ? `Support API request failed (${response.status} ${response.statusText}): ${errorText}`
        : `Support API request failed (${response.status} ${response.statusText})`;

      logger.error(message);
      throw new GcpMcpError(
        message,
        response.status === 401
          ? "UNAUTHENTICATED"
          : response.status === 403
            ? "PERMISSION_DENIED"
            : "FAILED_PRECONDITION",
        response.status,
        errorText || undefined,
      );
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const text = await response.text();
    if (!text) {
      return undefined as TResponse;
    }

    try {
      return JSON.parse(text) as TResponse;
    } catch (error) {
      logger.error(`Failed to parse Support API response JSON: ${error instanceof Error ? error.message : error}`);
      throw new GcpMcpError("Failed to parse Support API response.");
    }
  }

  async get<TResponse>(endpoint: string, queryParams?: Record<string, QueryValue>, projectId?: string) {
    return this.request<TResponse>(endpoint, { method: "GET", queryParams, projectId });
  }

  async post<TResponse>(endpoint: string, body?: unknown, queryParams?: Record<string, QueryValue>, projectId?: string) {
    return this.request<TResponse>(endpoint, { method: "POST", body, queryParams, projectId });
  }

  async patch<TResponse>(
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, QueryValue>,
    projectId?: string,
  ) {
    return this.request<TResponse>(endpoint, { method: "PATCH", body, queryParams, projectId });
  }
}

export const supportApiClient = new SupportApiClient();
