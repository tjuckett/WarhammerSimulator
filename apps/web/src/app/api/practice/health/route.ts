import { NextResponse } from 'next/server';
import { errorMessage } from '../../../../server/apiErrors';
import { checkDatabaseConnection } from '../../../../server/db';

export async function GET() {
  try {
    await checkDatabaseConnection();
    return NextResponse.json({
      status: 'ok',
      storage: 'database',
      message: 'Practice saves are using Postgres.',
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unavailable',
      storage: 'local',
      message: 'Postgres is unavailable. Practice saves will use browser storage until the database is running.',
      ...(process.env.NODE_ENV !== 'production' ? { detail: errorMessage(error) } : {}),
    });
  }
}
