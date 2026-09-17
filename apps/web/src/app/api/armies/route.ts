import { NextResponse } from 'next/server';
import { isImportedArmy } from '@warhammer-simulator/core/engine/armyUnits';
import { savedArmyRepository } from '../../../server/army/savedArmyRepository';
import { errorMessage } from '../../../server/apiErrors';

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    return NextResponse.json(id ? await savedArmyRepository.load(id) : await savedArmyRepository.list());
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load saved armies.', detail: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { army?: unknown };
    if (!isImportedArmy(body.army)) {
      return NextResponse.json({ error: 'A valid army is required.' }, { status: 400 });
    }
    return NextResponse.json(await savedArmyRepository.save(body.army));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save army.', detail: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; army?: unknown };
    if (typeof body.id !== 'string' || !body.id || !isImportedArmy(body.army)) {
      return NextResponse.json({ error: 'A saved army id and valid army are required.' }, { status: 400 });
    }
    return NextResponse.json(await savedArmyRepository.save(body.army, body.id));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update army.', detail: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'A saved army id is required.' }, { status: 400 });
    await savedArmyRepository.delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete army.', detail: errorMessage(error) }, { status: 500 });
  }
}
