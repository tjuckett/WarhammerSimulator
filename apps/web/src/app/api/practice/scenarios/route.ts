import { NextResponse } from 'next/server';
import type { PracticeScenario } from '@warhammer-simulator/core/practice/scenarios';
import { prismaPracticeScenarioRepository } from '../../../../server/practice/prismaPracticeScenarioRepository';
import { practiceApiError } from '../../../../server/apiErrors';

async function requestJson<T>(request: Request): Promise<T> {
  if (request.headers.get('content-encoding')?.toLowerCase() !== 'gzip') {
    return request.json() as Promise<T>;
  }
  const compressed = await request.arrayBuffer();
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}

export async function GET() {
  try {
    return NextResponse.json(await prismaPracticeScenarioRepository.listSummaries());
  } catch (error) {
    return practiceApiError('Failed to load practice saves. Check that Postgres is running and migrations are applied.', error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await requestJson<{ scenario?: PracticeScenario }>(request);
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
