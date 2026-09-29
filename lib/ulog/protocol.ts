// Messages between the page and the log worker. Type-only on both sides.
import type { FlightSummary, SeriesData } from './analysis.ts';

export type WorkerRequest =
  | { type: 'open'; id: string; buffer: ArrayBuffer }
  | { type: 'series'; id: string; requestId: number; topic: string; fields: string[] }
  | { type: 'close'; id: string };

export type WorkerResponse =
  | { type: 'opened'; id: string; summary: FlightSummary }
  | { type: 'failed'; id: string; message: string }
  | { type: 'series'; requestId: number; series: SeriesData[] }
  | { type: 'seriesFailed'; requestId: number; message: string };
