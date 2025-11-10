import { logger } from "../../utils/logger.js";

/**
 * Controls access to sensitive log payloads based on explicit role/policy checks.
 */
const DEFAULT_ALLOWED_ROLES = [
  "security_admin",
  "compliance_admin",
  "site_reliability_admin",
];

function parseRoles(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);
}

function getActiveRoles(): string[] {
  const roleSources = [
    process.env.MCP_ACTIVE_ROLES,
    process.env.MCP_USER_ROLES,
    process.env.MCP_USER_ROLE,
  ];

  const roles = new Set<string>();
  for (const source of roleSources) {
    for (const role of parseRoles(source)) {
      roles.add(role);
    }
  }

  return Array.from(roles);
}

function getAllowedRoles(): string[] {
  const envRoles = parseRoles(process.env.LOG_PAYLOAD_FULL_ACCESS_ROLES);
  return envRoles.length > 0 ? envRoles : DEFAULT_ALLOWED_ROLES;
}

/**
 * Determines if the current runtime context should expose full log payloads.
 *
 * Requires an explicit role match between MCP_* role claims and
 * LOG_PAYLOAD_FULL_ACCESS_ROLES.
 */
export function canViewFullLogPayloads(): boolean {
  const allowedRoles = getAllowedRoles();
  const activeRoles = getActiveRoles();

  const hasMatch = activeRoles.some((role) =>
    allowedRoles.includes(role.toLowerCase()),
  );

  if (!hasMatch && process.env.LOG_PAYLOAD_FULL_ACCESS === "1") {
    logger.warn(
      "LOG_PAYLOAD_FULL_ACCESS override detected without role match. Access remains restricted.",
    );
  }

  return hasMatch;
}

/**
 * Returns a short, user-facing reason when payload access is denied.
 */
export function getFullPayloadDeniedReason(): string {
  const allowedRoles = getAllowedRoles();
  return `Full payloads are limited to roles: ${allowedRoles.join(", ")}`;
}

export function buildRedactionNotice(allowFullPayload: boolean): string {
  if (allowFullPayload) {
    return "";
  }

  return `\n\n_Redacted fields: IP addresses, user identifiers, request bodies. ${getFullPayloadDeniedReason()}._`;
}
