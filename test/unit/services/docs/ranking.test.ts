import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rankDocsResults, tokenizeText } from "../../../../src/services/docs/search.js";

describe("rankDocsResults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("boosts fresher entries and tags that match the query", () => {
    const idf = new Map<
      string,
      number
    >(["cloud", "run"].map((token) => [token, 1.5]));

    const sharedTokens = ["cloud", "run", "best", "practices"];
    const sharedVector = {
      weights: new Map([
        ["cloud", 0.75],
        ["run", 0.75],
      ]),
      norm: Math.sqrt(0.75 ** 2 + 0.75 ** 2),
    };

    const taggedEntry = {
      title: "Cloud Run best practices",
      url: "https://cloud.google.com/run/docs/best-practices",
      summary: "Best practices",
      product: "Cloud Run",
      tags: ["Run"],
      lastReviewed: "2023-12-20T00:00:00.000Z",
      tokens: {
        title: [],
        summary: [],
        tags: [],
        product: [],
        combined: sharedTokens,
      },
      vector: sharedVector,
    };

    const untaggedEntry = {
      ...taggedEntry,
      title: "Cloud Run operations",
      url: "https://cloud.google.com/run/docs/operations",
      tags: [],
      lastReviewed: "2023-12-20T00:00:00.000Z",
    };

    const olderEntry = {
      ...taggedEntry,
      title: "Cloud Run legacy guide",
      url: "https://cloud.google.com/run/docs/legacy",
      tags: ["run"],
      lastReviewed: "2020-01-01T00:00:00.000Z",
    };

    const ranked = rankDocsResults("Cloud Run best practices", [
      taggedEntry as any,
      untaggedEntry as any,
      olderEntry as any,
    ], idf);

    expect(ranked[0]?.title).toBe("Cloud Run best practices");
    expect(ranked[1]?.title).toBe("Cloud Run operations");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[2]?.title).toBe("Cloud Run legacy guide");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[2]?.score ?? 0);
  });

  it("falls back to lexical overlap when cosine similarity is zero", () => {
    const idf = new Map<string, number>([["dataflow", 2]]);
    const vectorlessEntry = {
      title: "Dataflow streaming patterns",
      url: "https://cloud.google.com/dataflow/docs/streaming",
      summary: "Streaming guide",
      product: "Dataflow",
      tags: [],
      lastReviewed: "2023-11-01T00:00:00.000Z",
      tokens: {
        title: [],
        summary: [],
        tags: [],
        product: [],
        combined: ["dataflow", "streaming"],
      },
      vector: { weights: new Map(), norm: 1 },
    };

    const unrelatedEntry = {
      ...vectorlessEntry,
      title: "Vertex AI guide",
      lastReviewed: undefined,
      tokens: {
        ...vectorlessEntry.tokens,
        combined: ["vertex", "ai"],
      },
    };

    const ranked = rankDocsResults("Dataflow streaming", [
      vectorlessEntry as any,
      unrelatedEntry as any,
    ], idf);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.title).toBe("Dataflow streaming patterns");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });
});

describe("tokenizeText", () => {
  it("deduplicates tokens and falls back to bigrams", () => {
    const tokens = tokenizeText("Cloud cloud RUN");
    expect(tokens).toEqual(["cloud", "run"]);

    const fallbackTokens = tokenizeText("--");
    expect(fallbackTokens).toEqual(["--"]);
  });
});
