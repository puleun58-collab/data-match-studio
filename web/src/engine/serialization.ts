import type { ScalarV1, ScalarType } from './contracts';

const types: ReadonlySet<ScalarType> = new Set(['null', 'string', 'bool', 'int', 'float', 'decimal', 'date', 'datetime', 'nonfinite', 'json']);
const decimalPattern = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;


function jsonSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = jsonSafe((value as Record<string, unknown>)[key]);
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number must use the nonfinite scalar tag');
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function encodeScalar(value: unknown): ScalarV1 {
  if (value === null || value === undefined) return { version: 1, type: 'null', value: null };
  if (typeof value === 'boolean') return { version: 1, type: 'bool', value };
  if (typeof value === 'string') return { version: 1, type: 'string', value };
  if (typeof value === 'bigint') {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return { version: 1, type: 'int', value: numeric };
    return { version: 1, type: 'decimal', value: value.toString() };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { version: 1, type: 'nonfinite', value: Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf' };
    return { version: 1, type: Number.isInteger(value) ? 'int' : 'float', value };
  }
  if (value instanceof Date) return { version: 1, type: 'datetime', value: value.toISOString() };
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return { version: 1, type: 'json', value: jsonSafe(value) as unknown[] | Record<string, unknown> };
  throw new TypeError(`unsupported scalar type: ${typeof value}`);
}

export function decodeScalar(scalar: ScalarV1): unknown {
  if (!scalar || scalar.version !== 1 || !types.has(scalar.type)) throw new TypeError('invalid ScalarV1 envelope');
  if (Object.keys(scalar as unknown as Record<string, unknown>).some((key) => !['version', 'type', 'value'].includes(key))) throw new TypeError('unknown ScalarV1 field');
  const value = scalar.value;
  if (scalar.type === 'null') { if (value !== null) throw new TypeError('null scalar must have null value'); return null; }
  if (scalar.type === 'string') { if (typeof value !== 'string') throw new TypeError('invalid string scalar'); return value; }
  if (scalar.type === 'bool') { if (typeof value !== 'boolean') throw new TypeError('invalid bool scalar'); return value; }
  if (scalar.type === 'int') { if (typeof value !== 'number' || !Number.isSafeInteger(value) || !Number.isInteger(value)) throw new TypeError('invalid int scalar'); return value; }
  if (scalar.type === 'float') { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('invalid float scalar'); return value; }
  if (scalar.type === 'decimal') { if (typeof value !== 'string' || !decimalPattern.test(value)) throw new TypeError('invalid decimal scalar'); return value; }
  if (scalar.type === 'date') { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TypeError('invalid date scalar'); return value; }
  if (scalar.type === 'datetime') { if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError('invalid datetime scalar'); return new Date(value); }
  if (scalar.type === 'nonfinite') { if (value === 'nan') return Number.NaN; if (value === 'inf') return Number.POSITIVE_INFINITY; if (value === '-inf') return Number.NEGATIVE_INFINITY; throw new TypeError('invalid nonfinite scalar'); }
  if (!Array.isArray(value) && (typeof value !== 'object' || value === null)) throw new TypeError('invalid json scalar');
  return value;
}

export function serializeDeterministic(value: unknown): string { return JSON.stringify(jsonSafe(value)); }
export function deserializeDeterministic<T = unknown>(text: string): T { return JSON.parse(text) as T; }
