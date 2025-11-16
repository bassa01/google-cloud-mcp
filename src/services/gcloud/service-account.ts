/**
 * Helpers enforcing service account usage for gcloud commands.
 */
import { GcpMcpError } from "../../utils/error.js";
import { getActiveGcloudAccount } from "./cli.js";

const SERVICE_ACCOUNT_SUFFIX = ".gserviceaccount.com";
const IMPERSONATE_FLAG = "--impersonate-service-account";

export function isServiceAccountEmail(value?: string | null): boolean {
  return (
    typeof value === "string" && value.toLowerCase().endsWith(SERVICE_ACCOUNT_SUFFIX)
  );
}

export function extractImpersonatedServiceAccount(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token.startsWith(`${IMPERSONATE_FLAG}=`)) {
      return token.slice(IMPERSONATE_FLAG.length + 1);
    }

    if (token === IMPERSONATE_FLAG && i + 1 < args.length) {
      return args[i + 1];
    }
  }

  return null;
}

export async function requireServiceAccountIdentity(
  args: string[],
): Promise<string> {
  const impersonated = extractImpersonatedServiceAccount(args);
  if (impersonated) {
    if (!isServiceAccountEmail(impersonated)) {
      throw new GcpMcpError(
        `Only service account impersonation is permitted. "${impersonated}" is not a service account.`,
        "UNSUPPORTED_IDENTITY",
        403,
      );
    }
    return impersonated;
  }

  const activeAccount = await getActiveGcloudAccount();
  if (!activeAccount) {
    throw new GcpMcpError(
      "gcloud has no active account. Activate or impersonate a service account (for example via `gcloud config set auth/impersonate_service_account <sa-email>`) before invoking this tool.",
      "UNAUTHENTICATED",
      401,
    );
  }

  if (!isServiceAccountEmail(activeAccount)) {
    throw new GcpMcpError(
      `Active gcloud account "${activeAccount}" is not a service account. Configure impersonation or ADC credentials for a service account to continue.`,
      "UNSUPPORTED_IDENTITY",
      403,
    );
  }

  return activeAccount;
}
