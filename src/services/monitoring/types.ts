/**
 * Type definitions for Google Cloud Monitoring service
 */
import monitoring from "@google-cloud/monitoring";
import { google } from "@google-cloud/monitoring/build/protos/protos.js";
import {
  previewList,
  resolveBoundedNumber,
} from "../../utils/output.js";
const { MetricServiceClient } = monitoring;

/**
 * Interface for Google Cloud Monitoring time series data
 */
export interface TimeSeriesData {
  metric: {
    type: string;
    labels?: Record<string, string>;
  };
  resource: {
    type: string;
    labels: Record<string, string>;
  };
  metricKind: string;
  valueType: string;
  points: Array<{
    interval: {
      startTime: string;
      endTime: string;
    };
    value: {
      boolValue?: boolean;
      int64Value?: string;
      doubleValue?: number;
      stringValue?: string;
      distributionValue?: any;
    };
  }>;
}

/**
 * Initialises the Google Cloud Monitoring client
 *
 * @returns A configured Monitoring client
 */
export function getMonitoringClient() {
  return new MetricServiceClient({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  });
}

/**
 * Formats a time series data point for display
 *
 * @param timeSeries The time series data to format
 * @returns Summaries suitable for compact MCP responses
 */
export function formatTimeSeriesData(
  timeSeries: google.monitoring.v3.ITimeSeries[],
): TimeSeriesFormatResult {
  const seriesList = timeSeries ?? [];
  const { displayed, omitted } = previewList(
    seriesList,
    METRIC_SERIES_PREVIEW_LIMIT,
  );

  const formattedSeries = displayed.map((series) => {
    const points = series.points ?? [];
    const { displayed: pointSubset, omitted: pointOmitted } = previewList(
      points,
      METRIC_POINT_PREVIEW_LIMIT,
    );

    return {
      metricType: series.metric?.type,
      metricLabels:
        series.metric?.labels && Object.keys(series.metric.labels).length > 0
          ? series.metric.labels
          : undefined,
      resource:
        series.resource && (series.resource.type || series.resource.labels)
          ? {
              type: series.resource?.type,
              labels:
                series.resource?.labels &&
                Object.keys(series.resource.labels).length > 0
                  ? series.resource.labels
                  : undefined,
            }
          : undefined,
      metricKind: series.metricKind,
      valueType: series.valueType,
      points: pointSubset.map((point) => ({
        timestamp: toTimestamp(point.interval?.endTime),
        value: extractPointValue(point.value),
      })),
      pointsOmitted: pointOmitted,
    };
  });

  return {
    series: formattedSeries,
    totalSeries: seriesList.length,
    omittedSeries: omitted,
  };
}

export interface TimeSeriesPointSummary {
  timestamp: string;
  value: string | number | boolean | Record<string, unknown>;
}

export interface TimeSeriesSummary {
  metricType?: string;
  metricLabels?: Record<string, string>;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  metricKind?: string;
  valueType?: string;
  points: TimeSeriesPointSummary[];
  pointsOmitted?: number;
}

export interface TimeSeriesFormatResult {
  series: TimeSeriesSummary[];
  totalSeries: number;
  omittedSeries: number;
}

const METRIC_SERIES_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.MONITORING_SERIES_PREVIEW_LIMIT,
  5,
  { min: 1, max: 20 },
);

const METRIC_POINT_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.MONITORING_POINT_PREVIEW_LIMIT,
  12,
  { min: 3, max: 60 },
);

function toTimestamp(
  timestamp?: google.protobuf.ITimestamp | null,
): string {
  if (!timestamp?.seconds) {
    return "unknown";
  }

  const millis =
    Number(timestamp.seconds) * 1000 + Math.floor((timestamp.nanos ?? 0) / 1e6);

  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toISOString();
}

function extractPointValue(
  value?: google.monitoring.v3.TypedValue | null,
): string | number | boolean | Record<string, unknown> {
  if (!value) {
    return "N/A";
  }

  if (value.boolValue !== undefined) {
    return value.boolValue;
  }

  if (value.doubleValue !== undefined) {
    return Number(value.doubleValue);
  }

  if (value.int64Value !== undefined) {
    return value.int64Value;
  }

  if (value.stringValue !== undefined) {
    return value.stringValue;
  }

  if (value.distributionValue) {
    return {
      distribution: {
        mean: value.distributionValue.mean,
        count: value.distributionValue.count,
      },
    };
  }

  return "N/A";
}
