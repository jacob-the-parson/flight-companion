// The page's side of the log worker: a promise for every request. Browser only.
import type { FlightSummary, SeriesData } from './analysis.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

let worker: Worker | null = null;
let nextRequest = 1;
const opening = new Map<string, { resolve: (s: FlightSummary) => void; reject: (e: Error) => void }>();
const asking = new Map<number, { resolve: (s: SeriesData[]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ulog.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    if (msg.type === 'opened') {
      opening.get(msg.id)?.resolve(msg.summary);
      opening.delete(msg.id);
    } else if (msg.type === 'failed') {
      opening.get(msg.id)?.reject(new Error(msg.message));
      opening.delete(msg.id);
    } else if (msg.type === 'series') {
      asking.get(msg.requestId)?.resolve(msg.series);
      asking.delete(msg.requestId);
    } else {
      asking.get(msg.requestId)?.reject(new Error(msg.message));
      asking.delete(msg.requestId);
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The log reader stopped unexpectedly.');
    for (const p of opening.values()) p.reject(error);
    for (const p of asking.values()) p.reject(error);
    opening.clear();
    asking.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(req: WorkerRequest, transfer: Transferable[] = []): void {
  getWorker().postMessage(req, transfer);
}

/** Read and analyse a log. The buffer is handed to the worker and is empty afterwards. */
export function openLog(id: string, buffer: ArrayBuffer): Promise<FlightSummary> {
  return new Promise((resolve, reject) => {
    opening.set(id, { resolve, reject });
    try {
      send({ type: 'open', id, buffer }, [buffer]);
    } catch (err) {
      opening.delete(id);
      reject(err instanceof Error ? err : new Error('The log reader could not be started.'));
    }
  });
}

export function requestSeries(id: string, topic: string, fields: string[]): Promise<SeriesData[]> {
  return new Promise((resolve, reject) => {
    const requestId = nextRequest++;
    asking.set(requestId, { resolve, reject });
    try {
      send({ type: 'series', id, requestId, topic, fields });
    } catch (err) {
      asking.delete(requestId);
      reject(err instanceof Error ? err : new Error('The log reader could not be reached.'));
    }
  });
}

export function closeLog(id: string): void {
  if (worker) send({ type: 'close', id });
}
