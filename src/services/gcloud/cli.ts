/**
 * Thin wrappers around the gcloud CLI.
 */
import { spawn } from "child_process";
import { z } from "zod";
import { GcpMcpError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

export interface GcloudInvocationResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface SpawnResult extends GcloudInvocationResult {}

const LINT_SCHEMA = z.array(
  z.object({
    command_string_no_args: z.string(),
    success: z.boolean(),
    error_message: z.string().nullable(),
    error_type: z.string().nullable(),
  }),
);

const AUTH_LIST_SCHEMA = z.array(
  z.object({
    account: z.string(),
    status: z.string().optional().nullable(),
  }),
);

function spawnGcloud(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("gcloud", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export async function invokeGcloud(
  args: string[],
): Promise<GcloudInvocationResult> {
  try {
    return await spawnGcloud(args);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new GcpMcpError(
        "The gcloud CLI is not available on this host. Install the Google Cloud CLI or make sure it is on the PATH before invoking this tool.",
        "GCLOUD_NOT_FOUND",
        500,
      );
    }

    throw error;
  }
}

export interface ParsedLintResult {
  success: true;
  commandPath: string;
}

export async function lintGcloudCommand(
  command: string,
): Promise<ParsedLintResult> {
  const { code, stdout, stderr } = await invokeGcloud([
    "meta",
    "lint-gcloud-commands",
    "--command-string",
    `gcloud ${command}`,
  ]);

  let lintOutput: z.infer<typeof LINT_SCHEMA>;
  try {
    lintOutput = LINT_SCHEMA.parse(
      JSON.parse(stdout.trim().length > 0 ? stdout : "[]"),
    );
  } catch (error) {
    logger.warn(
      `Unable to parse gcloud lint output: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new GcpMcpError(
      "gcloud lint returned invalid output while validating the command.",
      "GCLOUD_LINT_FAILED",
      500,
    );
  }

  const lintResult = lintOutput[0];
  if (!lintResult) {
    throw new GcpMcpError(
      "gcloud lint did not return any analysis for the provided command.",
      "GCLOUD_LINT_FAILED",
      500,
    );
  }

  if (code !== 0) {
    const message =
      lintResult.error_message || stderr || "gcloud lint failed unexpectedly.";
    throw new GcpMcpError(message, "GCLOUD_LINT_FAILED", 400);
  }

  if (!lintResult.success) {
    const message = lintResult.error_type
      ? `${lintResult.error_type}: ${lintResult.error_message ?? "Invalid gcloud command."}`
      : lintResult.error_message ?? "Invalid gcloud command.";
    throw new GcpMcpError(message, "INVALID_ARGUMENT", 400);
  }

  const normalizedCommand = lintResult.command_string_no_args
    .replace(/^gcloud\s+/i, "")
    .trim();

  if (!normalizedCommand) {
    throw new GcpMcpError(
      "Unable to determine the gcloud command path from lint results.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  return { success: true, commandPath: normalizedCommand };
}

export async function getActiveGcloudAccount(): Promise<string | null> {
  const { code, stdout, stderr } = await invokeGcloud([
    "auth",
    "list",
    "--format=json",
  ]);

  if (code !== 0) {
    throw new GcpMcpError(
      `Unable to inspect gcloud authentication state (exit ${code}). ${stderr || stdout || ""}`.trim(),
      "GCLOUD_AUTH_ERROR",
      500,
    );
  }

  let parsedList: z.infer<typeof AUTH_LIST_SCHEMA>;
  try {
    parsedList = AUTH_LIST_SCHEMA.parse(
      JSON.parse(stdout.trim().length > 0 ? stdout : "[]"),
    );
  } catch (error) {
    logger.warn(
      `Unable to parse gcloud auth list output: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new GcpMcpError(
      "gcloud auth list returned malformed JSON; cannot validate the active identity.",
      "GCLOUD_AUTH_ERROR",
      500,
    );
  }

  const active = parsedList.find(
    (entry) => entry.status && entry.status.toUpperCase() === "ACTIVE",
  );

  return active?.account ?? null;
}
