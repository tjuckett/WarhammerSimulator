import { NextResponse } from 'next/server';
import { prismaPracticeScenarioRepository } from '../../../../../../server/practice/prismaPracticeScenarioRepository';
import { issuePracticeSeatGrant } from '../../../../../../server/practice/seatGrantRepository';
import { practiceApiError } from '../../../../../../server/apiErrors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json() as { side?: 0 | 1; playerId?: string };
    if ((body.side !== 0 && body.side !== 1) || !body.playerId?.trim()) {
      return NextResponse.json({ error: 'Expected side and playerId.' }, { status: 400 });
    }
    const scenario = await prismaPracticeScenarioRepository.loadScenario(id);
    if (!scenario || !scenario.metadata.gameId) {
      return NextResponse.json({ error: 'Practice scenario not found.' }, { status: 404 });
    }
    return NextResponse.json(await issuePracticeSeatGrant(scenario.metadata.gameId, body.side, body.playerId.trim()));
  } catch (error) {
    return practiceApiError('Failed to issue controller seat credentials.', error);
  }
}
