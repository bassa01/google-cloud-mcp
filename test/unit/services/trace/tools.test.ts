import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceStatus } from "../../../../src/services/trace/types.js";

const buildStructuredResponseMock = vi.fn();
const previewListMock = vi.fn();
const previewRecordEntriesMock = vi.fn();
const createTextPreviewMock = vi.fn();

vi.mock("../../../../src/utils/output.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/utils/output.js")
  >("../../../../src/utils/output.js");
  return {
    ...actual,
    buildStructuredResponse: buildStructuredResponseMock,
    previewList: previewListMock,
    previewRecordEntries: previewRecordEntriesMock,
    createTextPreview: createTextPreviewMock,
  };
});

describe("trace tool helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    buildStructuredResponseMock.mockReset();
    previewListMock.mockReset();
    previewRecordEntriesMock.mockReset();
    createTextPreviewMock.mockReset();
  });

  it("calculates trace durations across units", async () => {
    const { calculateDuration } = await import(
      "../../../../src/services/trace/tools.js"
    );

    expect(
      calculateDuration(
        "2024-01-01T00:00:00.000Z",
        "2024-01-01T00:00:00.500Z",
      ),
    ).toBe("500ms");
    expect(
      calculateDuration(
        "2024-01-01T00:00:00.000Z",
        "2024-01-01T00:00:01.250Z",
      ),
    ).toBe("1.25s");
    expect(
      calculateDuration(
        "2024-01-01T00:00:00.000Z",
        "2024-01-01T00:01:30.000Z",
      ),
    ).toBe("1m 30.00s");
  });

  it("summarizes spans with attribute previews", async () => {
    previewRecordEntriesMock.mockReturnValue({
      displayed: { "/http/method": "GET" },
      omitted: 2,
    });

    const { summarizeSpan } = await import(
      "../../../../src/services/trace/tools.js"
    );

    const summary = summarizeSpan({
      spanId: "abc",
      displayName: "HTTP GET /books",
      parentSpanId: "root",
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-01T00:00:01.000Z",
      kind: "SPAN_KIND_SERVER",
      status: TraceStatus.OK,
      attributes: {
        "/http/method": "GET",
        "/http/status_code": "200",
      },
    } as any);

    expect(previewRecordEntriesMock).toHaveBeenCalledWith(
      {
        "/http/method": "GET",
        "/http/status_code": "200",
      },
      expect.any(Number),
    );
    expect(summary).toMatchObject({
      spanId: "abc",
      parentSpanId: "root",
      durationMs: 1000,
      status: TraceStatus.OK,
      attributes: { "/http/method": "GET" },
      attributesOmitted: 2,
    });
  });

  it("summarizes traces for list responses", async () => {
    const { summarizeTraceListItem } = await import(
      "../../../../src/services/trace/tools.js"
    );

    const summary = summarizeTraceListItem(
      {
        traceId: "trace-1",
        displayName: "Checkout",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T00:01:15.500Z",
        spans: [{}, {}, {}],
        status: { code: 2 },
      },
      "project-1",
    );

    expect(summary).toEqual({
      traceId: "trace-1",
      projectId: "project-1",
      displayName: "Checkout",
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-01T00:01:15.500Z",
      duration: "1m 15.50s",
      spanCount: 3,
      statusCode: 2,
    });
  });

  it("formats trace list responses with previews", async () => {
    const traces = [
      {
        traceId: "trace-1",
        displayName: "Checkout",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T00:00:01.000Z",
        spans: [],
      },
      {
        traceId: "trace-2",
        displayName: "Search",
        startTime: "2024-01-01T00:00:02.000Z",
        endTime: "2024-01-01T00:00:03.000Z",
        spans: [],
      },
    ];

    previewListMock.mockReturnValue({
      displayed: [traces[0]],
      omitted: traces.length - 1,
    });
    buildStructuredResponseMock.mockReturnValue("structured trace list");

    const { formatTracesResponse } = await import(
      "../../../../src/services/trace/tools.js"
    );

    const start = new Date("2024-01-01T00:00:00.000Z");
    const end = new Date("2024-01-01T01:00:00.000Z");

    const response = formatTracesResponse(
      { traces },
      "demo-project",
      start,
      end,
      "status.code != 0",
    );

    expect(previewListMock).toHaveBeenCalledWith(
      traces,
      expect.any(Number),
    );
    expect(buildStructuredResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Trace List",
        metadata: expect.objectContaining({
          projectId: "demo-project",
          totalTraces: traces.length,
          filter: "status.code != 0",
        }),
        dataLabel: "traces",
      }),
    );
    expect(response).toEqual({
      content: [{ type: "text", text: "structured trace list" }],
    });
  });
});
