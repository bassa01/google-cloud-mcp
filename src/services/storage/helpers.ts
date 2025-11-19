import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getProjectId } from "../../utils/auth.js";

export async function requireProjectId(
  provided?: string,
): Promise<string> {
  if (provided && provided.trim().length > 0) {
    return provided.trim();
  }

  const projectId = await getProjectId(true);
  if (!projectId || projectId === "unknown-project") {
    throw new Error(
      "A Google Cloud project ID is required. Set GOOGLE_CLOUD_PROJECT or pass projectId explicitly.",
    );
  }

  return projectId;
}

export async function optionalProjectId(
  provided?: string,
): Promise<string | undefined> {
  if (provided && provided.trim().length > 0) {
    return provided.trim();
  }

  const projectId = await getProjectId(false);
  if (!projectId || projectId === "unknown-project") {
    return undefined;
  }

  return projectId;
}

export function storageErrorResult(
  operation: string,
  error: unknown,
): CallToolResult {
  const errorMessage =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return {
    content: [
      {
        type: "text",
        text: `# ${operation} Failed\n\n${errorMessage}`,
      },
    ],
    isError: true,
  };
}
