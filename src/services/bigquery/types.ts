/**
 * Helper types and client initialisation for Google Cloud BigQuery.
 */
import { BigQuery } from "@google-cloud/bigquery";
import { GcpMcpError } from "../../utils/error.js";
import { stateManager } from "../../utils/state-manager.js";
import { getProjectId } from "../../utils/auth.js";
import { logger } from "../../utils/logger.js";

const clientCache = new Map<string, BigQuery>();

async function resolveProjectId(
  override?: string | null,
): Promise<string> {
  if (override) {
    return override;
  }

  const fromState = stateManager.getCurrentProjectId();
  if (fromState) {
    return fromState;
  }

  const detected = await getProjectId();
  if (detected) {
    return detected;
  }

  throw new GcpMcpError(
    "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
    "UNAUTHENTICATED",
    401,
  );
}

/**
 * Lazily create or reuse a BigQuery client scoped to the provided project.
 */
export async function getBigQueryClient(
  projectId?: string | null,
): Promise<BigQuery> {
  const resolvedProjectId = await resolveProjectId(projectId);

  const cached = clientCache.get(resolvedProjectId);
  if (cached) {
    return cached;
  }

  logger.debug(
    `Initializing BigQuery client with project ID: ${resolvedProjectId}`,
  );

  const client = new BigQuery({
    projectId: resolvedProjectId,
  });

  clientCache.set(resolvedProjectId, client);
  return client;
}
