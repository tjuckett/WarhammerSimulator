import { NextResponse } from 'next/server';
import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import { currentTimelineState, appendResolvedTimelineAction } from '@warhammer-simulator/core/practice/timeline';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { applyControllerAction } from '@warhammer-simulator/core/engine/controllers';
import { prismaPracticeScenarioRepository } from '../../../../../../server/practice/prismaPracticeScenarioRepository';
import { authenticatePracticeSeatGrant } from '../../../../../../server/practice/seatGrantRepository';
import { practiceApiError } from '../../../../../../server/apiErrors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json() as { side?: 0 | 1; action?: GameAction };
    if ((body.side !== 0 && body.side !== 1) || !body.action || typeof body.action.type !== 'string') {
      return NextResponse.json({ error: 'Expected side and intended action.' }, { status: 400 });
    }

    const scenario = await prismaPracticeScenarioRepository.loadScenario(id);
    if (!scenario) return NextResponse.json({ error: 'Practice scenario not found.' }, { status: 404 });
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token || !scenario.metadata.gameId || !await authenticatePracticeSeatGrant(scenario.metadata.gameId, body.side, token)) {
      return NextResponse.json({ error: 'Valid controller seat credentials are required.' }, { status: 401 });
    }

    const stateBefore = currentTimelineState(scenario.timeline);
    const rules = rulesEditionForRuleset(stateBefore.ruleset);
    const stateAfter = applyControllerAction(stateBefore, { side: body.side, action: body.action }, rules);
    const timeline = appendResolvedTimelineAction(scenario.timeline, body.action, { stateBefore, stateAfter });
    const saved = await prismaPracticeScenarioRepository.saveScenario({
      ...scenario,
      timeline,
      metadata: {
        ...scenario.metadata,
        updatedAt: timeline.metadata.updatedAt,
        timelineCursor: timeline.cursor,
      },
    });
    return NextResponse.json(saved);
  } catch (error) {
    return practiceApiError('Failed to apply controller action.', error, 400);
  }
}
