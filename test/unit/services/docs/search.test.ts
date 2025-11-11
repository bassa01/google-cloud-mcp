import { describe, expect, it } from "vitest";

import {
  parseDocsSearchPage,
  rankDocsResults,
  tokenizeText,
} from "../../../../src/services/docs/search.js";

const SAMPLE_RESULTS = `
Cloud Platform Site Search

About 91,800 results (0.14 seconds)

[**Cloud Storage** | Google Cloud](https://cloud.google.com/storage)

cloud.google.com

https://cloud.google.com/storage

Google Cloud › storage

[**Cloud Storage** | Google Cloud](https://cloud.google.com/storage)

**Cloud Storage** is a managed service for storing unstructured data at scale.

[**Connect to Cloud Storage | Looker Studio**](https://docs.cloud.google.com/looker/docs/studio/connect-to-google-cloud-storage)

docs.cloud.google.com

https://docs.cloud.google.com/looker/docs/studio/connect-to-google-cloud-storage

Google Cloud Documentation › Data analytics › Looker Studio

[**Connect to Cloud Storage | Looker Studio**](https://docs.cloud.google.com/looker/docs/studio/connect-to-google-cloud-storage)

Google Cloud Storage offers world-wide storage and retrieval of any amount of data.
`;

describe("parseDocsSearchPage", () => {
  it("extracts ranked results and snippets", () => {
    const { results, approxTotalResults } = parseDocsSearchPage(SAMPLE_RESULTS, {
      maxCandidates: 5,
    });

    expect(results).toHaveLength(2);
    expect(approxTotalResults).toBe(91800);
    expect(results[0]).toMatchObject({
      title: "Cloud Storage | Google Cloud",
      url: "https://cloud.google.com/storage",
      sourceRank: 1,
    });
    expect(results[1].url).toContain("connect-to-google-cloud-storage");
  });
});

describe("rankDocsResults", () => {
  it("prioritizes results with higher lexical overlap", () => {
    const candidates = [
      {
        title: "BigQuery streaming inserts",
        url: "https://cloud.google.com/bigquery/docs/streaming-data-into-bigquery",
        snippet: "Load event data into BigQuery.",
        sourceRank: 1,
      },
      {
        title: "Create triggers from Cloud Storage events",
        url: "https://docs.cloud.google.com/run/docs/triggering/storage-triggers",
        snippet: "Use Eventarc to trigger Cloud Run services from Cloud Storage.",
        sourceRank: 2,
      },
    ];

    const ranked = rankDocsResults("cloud storage triggers", candidates);
    expect(ranked[0].url).toContain("storage-triggers");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe("tokenizeText", () => {
  it("returns tokens for latin and non-latin queries", () => {
    expect(tokenizeText("Cloud Storage とは")).toContain("cloud");
    const jpTokens = tokenizeText("ストレージを検索");
    expect(jpTokens.length).toBeGreaterThan(0);
  });
});
