/**
 * Security policy for gcloud command execution.
 */
import { GcpMcpError } from "../../utils/error.js";

export interface PolicyViolation {
  code: string;
  reason: string;
}

const READ_ONLY_VERBS = new Set([
  "list",
  "lists",
  "describe",
  "get",
  "read",
  "tail",
  "check",
  "diagnose",
  "inspect",
  "lookup",
  "ls",
  "print",
  "show",
  "status",
  "verify",
  "whoami",
]);

const STRICT_PREFIX_DENYLIST = [
  "iam",
  "alpha iam",
  "beta iam",
  "secret-manager",
  "alpha secret-manager",
  "beta secret-manager",
  "secrets",
  "kms",
  "alpha kms",
  "beta kms",
  "access-context-manager",
  "alpha access-context-manager",
  "beta access-context-manager",
  "iam service-accounts",
  "iam roles",
  "organizations policies",
  "resource-manager org-policies",
];

const SENSITIVE_TOKEN_SNIPPETS = [
  "iam",
  "secretmanager",
  "secret-manager",
  "secrets",
  "kms",
  "keymanagement",
  "accesscontext",
  "ssh",
  "scp",
  "tunnel",
  "interactive",
  "inactivate",
  "activate",
];

const FORBIDDEN_OPERATION_KEYWORDS = [
  "apply",
  "attach",
  "cancel",
  "connect",
  "copy",
  "create",
  "delete",
  "deploy",
  "destroy",
  "detach",
  "disable",
  "enable",
  "export",
  "import",
  "move",
  "patch",
  "promote",
  "publish",
  "purge",
  "recreate",
  "remove",
  "reset",
  "restart",
  "resume",
  "revoke",
  "rollback",
  "run",
  "set",
  "start",
  "stop",
  "suspend",
  "truncate",
  "update",
  "upgrade",
  "write",
];

export function checkCommandAgainstPolicy(
  parsedCommand: string,
  args: string[],
): PolicyViolation | null {
  const normalizedCommand = parsedCommand
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!normalizedCommand) {
    return {
      code: "INVALID_COMMAND",
      reason: "Unable to parse the gcloud command path.",
    };
  }

  const tokens = normalizedCommand.split(" ");
  const verb = tokens[tokens.length - 1];

  if (!READ_ONLY_VERBS.has(verb)) {
    return {
      code: "UNSAFE_VERB",
      reason: `Only read-only verbs (${Array.from(READ_ONLY_VERBS).join(", ")}) are permitted. Detected "${verb}".`,
    };
  }

  for (const prefix of STRICT_PREFIX_DENYLIST) {
    if (
      normalizedCommand === prefix ||
      normalizedCommand.startsWith(`${prefix} `)
    ) {
      return {
        code: "SENSITIVE_COMMAND",
        reason: `Commands under "${prefix}" are blocked to prevent access to sensitive surfaces.`,
      };
    }
  }

  const sensitiveToken = tokens.find((token) =>
    SENSITIVE_TOKEN_SNIPPETS.some((snippet) => token.includes(snippet)),
  );

  if (sensitiveToken) {
    return {
      code: "SENSITIVE_COMMAND",
      reason: `The token "${sensitiveToken}" indicates a security-sensitive surface, so this command is blocked.`,
    };
  }

  const argsText = args.join(" ").toLowerCase();
  const matchedOperation = FORBIDDEN_OPERATION_KEYWORDS.find((keyword) =>
    new RegExp(`\\b${keyword}\\b`).test(argsText),
  );

  if (matchedOperation) {
    return {
      code: "UNSAFE_OPERATION",
      reason: `Detected prohibited operation keyword "${matchedOperation}". Only read-only commands are permitted.`,
    };
  }

  return null;
}

export function enforceReadOnlyPolicy(
  parsedCommand: string,
  args: string[],
): void {
  const violation = checkCommandAgainstPolicy(parsedCommand, args);
  if (violation) {
    throw new GcpMcpError(
      violation.reason,
      "GCLOUD_POLICY_DENIED",
      403,
    );
  }
}
