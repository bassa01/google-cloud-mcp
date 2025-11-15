/**
 * Utilities for selecting which Google Cloud MCP services are active at runtime.
 */

/**
 * Canonical list of service identifiers that can be toggled via configuration.
 */
export const SERVICE_NAMES = [
  "logging",
  "spanner",
  "bigquery",
  "monitoring",
  "trace",
  "error-reporting",
  "profiler",
  "support",
  "docs",
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

/**
 * Result of parsing the MCP_ENABLED_SERVICES environment variable.
 */
export interface ServiceSelection {
  /** Whether all services are permitted or a custom subset is enforced. */
  mode: "all" | "custom";
  /** The services that should be enabled (all services when mode === "all"). */
  enabled: Set<ServiceName>;
  /** Raw entries from the env variable that could not be matched to a service. */
  invalidEntries: string[];
}

const aliasEntries: Array<[string, ServiceName]> = [
  ["logging", "logging"],
  ["logs", "logging"],
  ["log", "logging"],
  ["spanner", "spanner"],
  ["bq", "bigquery"],
  ["bigquery", "bigquery"],
  ["big-query", "bigquery"],
  ["big_query", "bigquery"],
  ["monitoring", "monitoring"],
  ["metrics", "monitoring"],
  ["trace", "trace"],
  ["tracing", "trace"],
  ["error-reporting", "error-reporting"],
  ["error_reporting", "error-reporting"],
  ["errorreporting", "error-reporting"],
  ["errors", "error-reporting"],
  ["profiler", "profiler"],
  ["profile", "profiler"],
  ["support", "support"],
  ["cases", "support"],
  ["docs", "docs"],
  ["documentation", "docs"],
  ["google-docs", "docs"],
  ["cloud-docs", "docs"],
];

const SERVICE_ALIAS_LOOKUP = new Map<string, ServiceName>(aliasEntries);

const WILDCARD_TOKENS = new Set(["*", "all"]);

const normalizeToken = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const createAllServicesSet = (): Set<ServiceName> => new Set<ServiceName>(SERVICE_NAMES);

const buildSelection = (
  mode: ServiceSelection["mode"],
  enabled?: Set<ServiceName>,
  invalidEntries: string[] = [],
): ServiceSelection => ({
  mode,
  enabled: enabled ?? createAllServicesSet(),
  invalidEntries,
});

/**
 * Parse the MCP_ENABLED_SERVICES string and determine which services should be active.
 */
export const parseServiceSelection = (rawValue?: string): ServiceSelection => {
  if (!rawValue || rawValue.trim().length === 0) {
    return buildSelection("all");
  }

  const tokens = rawValue
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return buildSelection("all");
  }

  const enabled = new Set<ServiceName>();
  const invalidEntries: string[] = [];

  for (const token of tokens) {
    const lowered = token.toLowerCase();
    if (WILDCARD_TOKENS.has(lowered)) {
      return buildSelection("all", undefined, invalidEntries);
    }

    const normalized = normalizeToken(token);
    if (!normalized) {
      // Skip entries that were only punctuation/whitespace after normalization
      continue;
    }

    const matchedService = SERVICE_ALIAS_LOOKUP.get(normalized);
    if (matchedService) {
      enabled.add(matchedService);
      continue;
    }

    invalidEntries.push(token);
  }

  if (enabled.size === 0) {
    return buildSelection("all", undefined, invalidEntries);
  }

  return buildSelection("custom", enabled, invalidEntries);
};

/**
 * Convenience helper to check whether a service is enabled under the current selection.
 */
export const isServiceEnabled = (
  selection: ServiceSelection,
  service: ServiceName,
): boolean => {
  if (selection.mode === "all") {
    return true;
  }

  return selection.enabled.has(service);
};

/**
 * Return the list of services that will be active. Useful for logging/debug output.
 */
export const getEnabledServices = (selection: ServiceSelection): ServiceName[] => {
  if (selection.mode === "all") {
    return Array.from(SERVICE_NAMES);
  }

  return Array.from(selection.enabled.values());
};
