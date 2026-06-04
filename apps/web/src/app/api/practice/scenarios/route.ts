import { NextResponse } from 'next/server';
import type { PracticeScenario } from '@warhammer-simulator/core/practice/scenarios';
import { prismaPracticeScenarioRepository } from '../../../../server/practice/prismaPracticeScenarioRepository';
import { practiceApiError } from '../../../../server/apiErrors';

export async function GET() {
  try {
    return NextResponse.json(await prismaPracticeScenarioRepository.listSummaries());
  } catch (error) {
    return practiceApiError('Failed to load practice saves. Check that Postgres is running and migrations are applied.', error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { scenario?: PracticeScenario };
    if (!body.scenario) {
      return NextResponse.json({ error: 'Missing scenario.' }, { status: 400 });
    }
    return NextResponse.json(await prismaPracticeScenarioRepository.saveScenario(body.scenario));
  } catch (error) {
    return practiceApiError('Failed to save practice scenario. Check that Postgres is running and migrations are applied.', error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { ids?: string[] };
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ error: 'Missing ids.' }, { status: 400 });
    }
    return NextResponse.json(await prismaPracticeScenarioRepository.deleteScenarios(body.ids));
  } catch (error) {
    return practiceApiError('Failed to delete practice scenarios. Check that Postgres is running and migrations are applied.', error);
  }
}
