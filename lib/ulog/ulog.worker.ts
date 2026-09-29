// The log worker: reading and analysing a log happens here, off the page's
// thread, so a large file never freezes the screen. Parsed logs stay in the
// worker; the page asks for series by name when a custom plot wants them.
/// <reference lib="webworker" />
import { ULog } from './parser.ts';
import { customSeries, summarize, type FlightSummary, type SeriesData } from './analysis.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const logs = new Map<string, ULog>();

/** Every distinct buffer in a list of series, for a zero-copy hand-over. */
function buffersOf(series: SeriesData[], into: Set<ArrayBuffer>): void {
  for (const s of series) {
    into.add(s.t.buffer as ArrayBuffer);
    into.add(s.v.buffer as ArrayBuffer);
  }
}

function transferList(summary: FlightSummary): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const c of summary.charts) buffersOf(c.series, set);
  if (summary.track) {
    set.add(summary.track.t.buffer as ArrayBuffer);
    set.add(summary.track.lat.buffer as ArrayBuffer);
    set.add(summary.track.lng.buffer as ArrayBuffer);
  }
  return [...set];
}

function reply(message: WorkerResponse, transfer: ArrayBuffer[] = []): void {
  self.postMessage(message, transfer);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === 'open') {
    try {
      const log = new ULog(req.buffer);
      logs.set(req.id, log);
      const summary = summarize(log);
      reply({ type: 'opened', id: req.id, summary }, transferList(summary));
    } catch (err) {
      logs.delete(req.id);
      reply({
        type: 'failed',
        id: req.id,
        message: err instanceof Error ? err.message : 'The file could not be read.',
      });
    }
  } else if (req.type === 'series') {
    const log = logs.get(req.id);
    if (!log) {
      reply({ type: 'seriesFailed', requestId: req.requestId, message: 'That log is no longer open.' });
      return;
    }
    try {
      const series = customSeries(log, req.topic, req.fields);
      const set = new Set<ArrayBuffer>();
      buffersOf(series, set);
      reply({ type: 'series', requestId: req.requestId, series }, [...set]);
    } catch (err) {
      reply({
        type: 'seriesFailed',
        requestId: req.requestId,
        message: err instanceof Error ? err.message : 'Those fields could not be read.',
      });
    }
  } else {
    logs.delete(req.id);
  }
};
