type DbLikeError = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

export function formatDbError(error: unknown, fallback = '요청 처리 중 오류가 발생했습니다.') {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const dbError = error as DbLikeError;
  const code = dbError.code ?? '';
  const message = dbError.message ?? '';
  const details = dbError.details ?? '';
  const joined = `${message} ${details}`.toLowerCase();

  if (
    joined.includes('failed to fetch') ||
    joined.includes('network request failed') ||
    joined.includes('load failed')
  ) {
    return '네트워크 연결에 실패했습니다. 인터넷 연결과 Supabase 설정을 확인해 주세요.';
  }

  if (joined.includes('응답 시간이 초과')) {
    return message || '요청 응답 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }

  if (code === '23505' || joined.includes('duplicate key')) {
    if (joined.includes('vehicle')) {
      return '이미 등록된 차량번호입니다. 차량번호를 확인해 주세요.';
    }

    return '이미 등록된 값입니다. 중복 여부를 확인해 주세요.';
  }

  if (code === '23503' || joined.includes('foreign key')) {
    return '연결된 운행 기록이 있어 이 작업을 완료할 수 없습니다.';
  }

  if (code === '23514' || joined.includes('check constraint')) {
    if (joined.includes('status')) {
      return 'DB 상태값 제약에 현재 운행 상태가 포함되어 있지 않습니다. docs/schema.sql 기준으로 상태값을 확인해 주세요.';
    }

    return 'DB 제약 조건 때문에 저장할 수 없습니다. 입력값을 확인해 주세요.';
  }

  if (code === '42501' || joined.includes('row-level security') || joined.includes('permission denied')) {
    return 'Supabase 권한 설정 때문에 요청이 거부되었습니다. 테이블 권한 또는 RLS 정책을 확인해 주세요.';
  }

  if (message) {
    return message;
  }

  return fallback;
}
