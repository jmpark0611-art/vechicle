export const ELM327_INIT_COMMANDS = ['AT Z', 'AT E0', 'AT L0', 'AT SP 0'] as const;
export const OBD_ODOMETER_PID = '01 A6';

export type ObdParseResult<T> =
  | { ok: true; value: T; rawBytes: number[] }
  | { ok: false; reason: 'empty' | 'no_data' | 'unsupported' | 'invalid_response' };

function getHexBytes(response: string): number[] {
  const normalized = response
    .replace(/\r|\n|>/g, ' ')
    .replace(/SEARCHING\.\.\./gi, ' ')
    .trim();

  const tokens = normalized.match(/[0-9A-Fa-f]{2}/g) ?? [];
  return tokens.map((token) => Number.parseInt(token, 16)).filter((byte) => Number.isFinite(byte));
}

export function parseMode01PidResponse(response: string, pid: number): ObdParseResult<number[]> {
  const upper = response.toUpperCase();
  if (!upper.trim()) return { ok: false, reason: 'empty' };
  if (upper.includes('NO DATA')) return { ok: false, reason: 'no_data' };
  if (upper.includes('UNABLE TO CONNECT') || upper.includes('STOPPED') || upper.includes('?')) {
    return { ok: false, reason: 'unsupported' };
  }

  const bytes = getHexBytes(response);
  const headerIndex = bytes.findIndex((byte, index) => byte === 0x41 && bytes[index + 1] === pid);
  if (headerIndex < 0) return { ok: false, reason: 'invalid_response' };

  const data = bytes.slice(headerIndex + 2);
  if (data.length === 0) return { ok: false, reason: 'invalid_response' };

  return { ok: true, value: data, rawBytes: bytes };
}

export function parseOdometerKilometers(response: string): ObdParseResult<number> {
  const parsed = parseMode01PidResponse(response, 0xa6);
  if (!parsed.ok) return parsed;

  const data = parsed.value;
  if (data.length < 4) return { ok: false, reason: 'invalid_response' };

  const raw = ((data[0] << 24) >>> 0) + (data[1] << 16) + (data[2] << 8) + data[3];
  return {
    ok: true,
    value: raw / 10,
    rawBytes: parsed.rawBytes,
  };
}
