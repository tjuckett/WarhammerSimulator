import { NextResponse } from 'next/server';
import { isImportedArmy } from '@warhammer-simulator/core/engine/armyUnits';
import { savedArmyRepository } from '../../../server/army/savedArmyRepository';
import { errorMessage } from '../../../server/apiErrors';

function parseSlot(value: string | null): number | null {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 0 && slot <= 1 ? slot : null;
}

export async function GET(request: Request) {
  try {
    const slot = parseSlot(new URL(request.url).searchParams.get('slot'));
    if (slot === null) return NextResponse.json({ error: 'Slot must be 0 or 1.' }, { status: 400 });
    return NextResponse.json(await savedArmyRepository.load(slot));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load saved army.', detail: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { slot?: number; army?: unknown };
    if (!Number.isInteger(body.slot) || body.slot < 0 || body.slot > 1 || !isImportedArmy(body.army)) {
      return NextResponse.json({ error: 'A valid slot (0 or 1) and army are required.' }, { status: 400 });
    }
    return NextResponse.json(await savedArmyRepository.save(body.slot, body.army));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save army.', detail: errorMessage(error) }, { status: 500 });
  }
}
