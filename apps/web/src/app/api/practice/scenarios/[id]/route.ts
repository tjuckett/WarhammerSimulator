import { NextResponse } from 'next/server';
import { prismaPracticeScenarioRepository } from '../../../../../server/practice/prismaPracticeScenarioRepository';
import { practiceApiError } from '../../../../../server/apiErrors';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await prismaPracticeScenarioRepository.loadScenario(id));
  } catch (error) {
    return practiceApiError('Failed to load practice scenario. Check that Postgres is running and migrations are applied.', error);
  }
}
