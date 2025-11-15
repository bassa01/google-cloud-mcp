/**
 * Tooling that exposes a read-only subset of the gcloud CLI.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { GcpMcpError } from "../../utils/error.js";
import {
  invokeGcloud,
  lintGcloudCommand,
  type GcloudInvocationResult,
} from "./cli.js";
import { enforceReadOnlyPolicy } from "./policy.js";
import { requireServiceAccountIdentity } from "./service-account.js";

const TOOL_INPUT_SCHEMA = {
  args: z
    .array(z.string())
    .min(1, "Provide the gcloud command as an array of tokens.")
    .describe(
      "Command arguments to supply to the gcloud CLI. Include flags exactly as you would on the terminal. The leading 'gcloud' token is optional.",
    ),
};

interface NormalizedCommand {
  args: string[];
  display: string;
}

function normalizeArgs(rawArgs: string[]): NormalizedCommand {
  const trimmed = rawArgs
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (trimmed.length === 0) {
    throw new GcpMcpError(
      "Provide at least one argument after 'gcloud'.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  if (trimmed[0].toLowerCase() === "gcloud") {
    trimmed.shift();
  }

  if (trimmed.length === 0) {
    throw new GcpMcpError(
      "No gcloud subcommand supplied. Example: ['gcloud', 'projects', 'list'].",
      "INVALID_ARGUMENT",
      400,
    );
  }

  return {
    args: trimmed,
    display: `gcloud ${trimmed.join(" ")}`,
  };
}

function buildCommandResponse(
  displayCommand: string,
  account: string,
  result: GcloudInvocationResult,
) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  const chunks = [
    "# gcloud command output",
    "",
    `- Command: \`${displayCommand}\``,
    `- Service account: \`${account}\``,
    `- Exit code: \`${result.code ?? "unknown"}\``,
  ];

  if (stdout.length > 0) {
    chunks.push("", "## STDOUT", "```", stdout, "```");
  } else {
    chunks.push("", "## STDOUT", "_(no output)_");
  }

  if (stderr.length > 0) {
    chunks.push("", "## STDERR", "```", stderr, "```");
  }

  return {
    content: [
      {
        type: "text" as const,
        text: chunks.join("\n"),
      },
    ],
    isError: result.code !== 0,
  };
}

function buildErrorResponse(error: unknown) {
  const code =
    error instanceof GcpMcpError
      ? error.code
      : error instanceof Error
        ? "UNKNOWN_ERROR"
        : "UNKNOWN_ERROR";
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return {
    content: [
      {
        type: "text" as const,
        text: `# gcloud command rejected

- Error code: \`${code}\`
- Detail: ${message}`,
      },
    ],
    isError: true,
  };
}

export function registerGcloudTools(server: McpServer): void {
  server.registerTool(
    "gcloud-run-read-command",
    {
      title: "Run read-only gcloud command",
      description: `Execute a strictly read-only gcloud CLI command with heavy guardrails.

## Usage
- Provide the command as an array of tokens, e.g. ["gcloud", "projects", "list"].
- Only read operations (list/describe/get/read) are allowed.
- Mutating verbs (create, delete, update, etc.), IAM/Secret Manager/KMS surfaces, SSH/interactive commands, or API enablement are immediately blocked.
- Commands must authenticate with a service account (either active account or via --impersonate-service-account=...).

If the command exits with a non-zero status, the stderr stream is returned in the response.`,
      inputSchema: TOOL_INPUT_SCHEMA,
    },
    async ({ args }) => {
      try {
        const normalized = normalizeArgs(args);
        const serviceAccount = await requireServiceAccountIdentity(
          normalized.args,
        );

        const lintResult = await lintGcloudCommand(
          normalized.args.join(" "),
        );

        enforceReadOnlyPolicy(lintResult.commandPath, normalized.args);

        logger.info(
          `Executing read-only gcloud command: ${normalized.display}`,
        );
        const execution = await invokeGcloud(normalized.args);
        return buildCommandResponse(
          normalized.display,
          serviceAccount,
          execution,
        );
      } catch (error) {
        logger.warn(
          `Blocked gcloud command: ${error instanceof Error ? error.message : String(error)}`,
        );
        return buildErrorResponse(error);
      }
    },
  );
}
