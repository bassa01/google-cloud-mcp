import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

import * as authUtils from "../../../../src/utils/auth.js";
import {
  optionalProjectId,
  requireProjectId,
  storageErrorResult,
} from "../../../../src/services/storage/helpers.js";

const projectIdSpy = vi.spyOn(authUtils, "getProjectId");

afterAll(() => {
  projectIdSpy.mockRestore();
});

describe("requireProjectId", () => {
  beforeEach(() => {
    projectIdSpy.mockReset();
  });

  it("returns the provided project ID when present", async () => {
    const result = await requireProjectId("  demo-project  ");

    expect(result).toBe("demo-project");
    expect(projectIdSpy).not.toHaveBeenCalled();
  });

  it("fetches the project ID when not provided", async () => {
    projectIdSpy.mockResolvedValue("derived-project");

    const result = await requireProjectId();

    expect(projectIdSpy).toHaveBeenCalledWith(true);
    expect(result).toBe("derived-project");
  });

  it("throws when no project ID can be resolved", async () => {
    projectIdSpy.mockResolvedValue("unknown-project");

    await expect(requireProjectId()).rejects.toThrow(
      "A Google Cloud project ID is required.",
    );
  });
});

describe("optionalProjectId", () => {
  beforeEach(() => {
    projectIdSpy.mockReset();
  });

  it("returns the provided project ID when supplied", async () => {
    const result = await optionalProjectId("  provided-project\n");

    expect(result).toBe("provided-project");
    expect(projectIdSpy).not.toHaveBeenCalled();
  });

  it("falls back to the resolved project ID when available", async () => {
    projectIdSpy.mockResolvedValue("resolved-project");

    const result = await optionalProjectId();

    expect(projectIdSpy).toHaveBeenCalledWith(false);
    expect(result).toBe("resolved-project");
  });

  it("returns undefined when no project ID can be determined", async () => {
    projectIdSpy.mockResolvedValue("unknown-project");

    await expect(optionalProjectId()).resolves.toBeUndefined();
  });
});

describe("storageErrorResult", () => {
  it("includes the error message from an Error instance", () => {
    const result = storageErrorResult("List Buckets", new Error("Boom"));

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "# List Buckets Failed\n\nBoom",
    });
  });

  it("coerces non-Error inputs into strings", () => {
    const result = storageErrorResult("Get Object", 42);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Get Object Failed");
    expect(result.content[0].text).toContain("42");
  });
});
