import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { logger } from "../../../src/utils/logger.js";
import { McpSecurityValidator } from "../../../src/utils/security-validator.js";

describe("McpSecurityValidator", () => {
  let validator: McpSecurityValidator;

  beforeEach(() => {
    validator = new McpSecurityValidator();
    vi.clearAllMocks();
  });

  describe("validateOriginHeader", () => {
    it("allows empty origin for MCP clients", () => {
      expect(validator.validateOriginHeader()).toBe(true);
    });

    it("matches configured allowed origins", () => {
      validator.setAllowedOrigins(["https://example.com"]);
      expect(validator.validateOriginHeader("https://example.com/app")).toBe(
        true,
      );
      expect(
        validator.validateOriginHeader("https://malicious.example"),
      ).toBe(false);
    });

    it("copies origin arrays defensively", () => {
      const origins = ["https://tenant1.example"];
      validator.setAllowedOrigins(origins);
      origins.push("https://unexpected.example");
      const exposed = validator.getAllowedOrigins();
      exposed.push("https://tampered.example");

      expect(
        validator.validateOriginHeader("https://unexpected.example"),
      ).toBe(false);
      expect(
        validator.validateOriginHeader("https://tampered.example"),
      ).toBe(false);
    });
  });

  describe("setSecurityHeaders", () => {
    it("applies the hardened header set", () => {
      const headers: Record<string, string> = {};
      const res = {
        setHeader: vi.fn((name: string, value: string) => {
          headers[name] = value;
        }),
        removeHeader: vi.fn(),
      } as const;

      validator.setSecurityHeaders(res);

      expect(headers).toEqual({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Strict-Transport-Security":
          "max-age=31536000; includeSubDomains; preload",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests; block-all-mixed-content",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ambient-light-sensor=(), autoplay=(), encrypted-media=(), fullscreen=(), picture-in-picture=(), sync-xhr=()",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      expect(res.removeHeader).toHaveBeenCalledWith("X-Powered-By");
      expect(res.removeHeader).toHaveBeenCalledWith("Server");
    });
  });

  describe("validateRequestHeaders", () => {
    it("flags suspicious forwarding headers", () => {
      const { valid, errors } = validator.validateRequestHeaders({
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      });

      expect(valid).toBe(false);
      expect(errors).toContain("Suspicious header detected: x-forwarded-for");
      expect(errors).toContain("Suspicious header detected: x-real-ip");
    });

    it("detects known malicious user-agents", () => {
      const { valid, errors } = validator.validateRequestHeaders({
        "user-agent": "sqlmap/1.0",
      });

      expect(valid).toBe(false);
      expect(errors).toContain("Blocked user agent pattern: sqlmap/1.0");
    });

    it("treats standard headers as valid", () => {
      const result = validator.validateRequestHeaders({
        accept: "application/json",
        host: "localhost",
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("checkRateLimit", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("permits 100 requests per minute and blocks the 101st", () => {
      for (let i = 0; i < 100; i += 1) {
        const response = validator.checkRateLimit("clientA", "endpoint");
        expect(response.allowed).toBe(true);
      }

      const limited = validator.checkRateLimit("clientA", "endpoint");
      expect(limited.allowed).toBe(false);
      expect(limited.retryAfter).toBeGreaterThan(0);
    });

    it("resets the rate limit window after one minute", () => {
      for (let i = 0; i < 100; i += 1) {
        validator.checkRateLimit("clientB");
      }
      expect(validator.checkRateLimit("clientB").allowed).toBe(false);

      vi.advanceTimersByTime(60_000);
      const afterWindow = validator.checkRateLimit("clientB");
      expect(afterWindow.allowed).toBe(true);
    });
  });

  describe("sanitiseInput", () => {
    it("strips HTML, control characters, and trims", () => {
      const input = "  <script>alert('x')</script>\u0000  ";
      const result = validator.sanitiseInput(input);

      expect(result).toBe("scriptalert(x)/script");
      expect(result.includes("<")).toBe(false);
      expect(result.includes("\u0000")).toBe(false);
    });

    it("enforces the 1000 character limit", () => {
      const longInput = "a".repeat(1500);
      expect(validator.sanitiseInput(longInput)).toHaveLength(1000);
    });
  });

  describe("validateMethodName", () => {
    it("allows safe identifiers", () => {
      expect(validator.validateMethodName("list_resources_v1")).toBe(true);
    });

    it("rejects disallowed characters", () => {
      expect(validator.validateMethodName("list:resources")).toBe(false);
    });

    it("blocks dangerous prefixes", () => {
      expect(validator.validateMethodName("rpc.internal")).toBe(false);
      expect(validator.validateMethodName("system.reset")).toBe(false);
      expect(validator.validateMethodName("execCommand")).toBe(false);
    });
  });

  describe("logSecurityEvent", () => {
    it("sanitises sensitive fields before logging", () => {
      validator.logSecurityEvent(
        "credential-leak",
        {
          userAgent: "<script>alert('x')</script>",
          clientIp: " \u000010.0.0.1 ",
          extra: "value",
        },
        "high",
      );

      expect(logger.error).toHaveBeenCalledTimes(1);
      const payload = (logger.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(payload).toContain("[SECURITY-HIGH]");

      const json = JSON.parse(payload.replace(/^\[SECURITY-HIGH\]\s*/, ""));
      expect(json.event).toBe("credential-leak");
      expect(json.details.userAgent).not.toContain("<");
      expect(json.details.clientIp).toBe("10.0.0.1");
      expect(json.details.extra).toBe("value");
    });
  });
});
