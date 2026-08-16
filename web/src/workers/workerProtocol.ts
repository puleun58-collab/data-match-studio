import type { Table } from '../engine/contracts';
import type { ComparisonConfig, ComparisonResult } from '../engine/comparisonEngine';
export type CompareRequest = { type: 'compare'; requestId: string; left: Table; right: Table; config: ComparisonConfig };
export type CancelRequest = { type: 'cancel'; requestId: string };
export type WorkerRequest = CompareRequest | CancelRequest;
export type WorkerProgress = { type: 'progress'; requestId: string; completed: number; total: number };
export type WorkerResult = { type: 'result'; requestId: string; result: ComparisonResult };
export type WorkerError = { type: 'error'; requestId: string; message: string; code?: string };
export type WorkerResponse = WorkerProgress | WorkerResult | WorkerError;
export function isWorkerRequest(value: unknown): value is WorkerRequest { return !!value && typeof value === 'object' && (((value as any).type === 'compare') || ((value as any).type === 'cancel')); }
