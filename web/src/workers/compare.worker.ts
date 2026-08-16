import { compareTables } from '../engine/comparisonEngine';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

const cancelled = new Set<string>();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};
scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') { cancelled.add(request.requestId); return; }
  const { requestId, left, right, config } = request;
  try {
    if (cancelled.has(requestId)) return;
    scope.postMessage({ type: 'progress', requestId, completed: 0, total: left.rows.length + right.rows.length } satisfies WorkerResponse);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (cancelled.has(requestId)) { cancelled.delete(requestId); return; }
    scope.postMessage({ type: 'progress', requestId, completed: Math.floor((left.rows.length + right.rows.length) / 4), total: left.rows.length + right.rows.length } satisfies WorkerResponse);
    const result = compareTables(left, right, config);
    if (cancelled.has(requestId)) { cancelled.delete(requestId); return; }
    scope.postMessage({ type: 'progress', requestId, completed: left.rows.length + right.rows.length, total: left.rows.length + right.rows.length } satisfies WorkerResponse);
    scope.postMessage({ type: 'result', requestId, result } satisfies WorkerResponse);
  } catch (error) { scope.postMessage({ type: 'error', requestId, code: 'COMPARE_FAILED', message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse); }
};
