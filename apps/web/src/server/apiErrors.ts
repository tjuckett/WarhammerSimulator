import { NextResponse } from 'next/server';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function practiceApiError(message: string, error: unknown, status = 500) {
  return NextResponse.json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' ? { detail: errorMessage(error) } : {}),
  }, { status });
}
