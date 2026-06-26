import { supabase } from './supabase';
import { withTimeout } from './request';

const ACCESS_COUNTER_NAME = 'app_open';

export type AccessCounterStats = {
  totalCount: number;
  updatedAt: string | null;
};

let accessRecordedThisSession = false;

function normalizeCounterRow(row: unknown): AccessCounterStats | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const value = row as { total_count?: unknown; updated_at?: unknown };
  const totalCount = typeof value.total_count === 'number' ? value.total_count : Number(value.total_count);

  if (!Number.isFinite(totalCount)) {
    return null;
  }

  return {
    totalCount,
    updatedAt: typeof value.updated_at === 'string' ? value.updated_at : null,
  };
}

export async function recordAppAccess(): Promise<AccessCounterStats | null> {
  if (accessRecordedThisSession) {
    return null;
  }

  accessRecordedThisSession = true;

  try {
    const result = await withTimeout(
      supabase.rpc('increment_access_counter', { counter_name: ACCESS_COUNTER_NAME }),
      '접속 카운터 저장'
    );

    if (result.error) {
      return null;
    }

    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return normalizeCounterRow(row);
  } catch {
    return null;
  }
}

export async function getAppAccessCounter(): Promise<AccessCounterStats | null> {
  try {
    const result = await withTimeout(
      supabase
        .from('app_access_counters')
        .select('total_count, updated_at')
        .eq('name', ACCESS_COUNTER_NAME)
        .maybeSingle(),
      '접속 카운터 조회'
    );

    if (result.error) {
      return null;
    }

    return normalizeCounterRow(result.data);
  } catch {
    return null;
  }
}
