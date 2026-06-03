export function d6(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function d3(): number {
  return Math.floor(Math.random() * 3) + 1;
}

export interface DiceResult {
  rolls: number[];
  total: number;
}

// Parses and rolls expressions like "1", "D6", "2D6", "D3", "2D3+1", "3D6-1"
export function rollExpression(expr: string): DiceResult {
  const s = (expr ?? '1').toString().trim().toUpperCase();

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return { rolls: [n], total: n };
  }

  const m = s.match(/^(\d*)D(\d+)([+-]\d+)?$/);
  if (!m) return { rolls: [1], total: 1 };

  const count = parseInt(m[1] || '1', 10);
  const sides = parseInt(m[2], 10);
  const bonus = parseInt(m[3] || '0', 10);

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const total = Math.max(1, rolls.reduce((a, b) => a + b, 0) + bonus);
  return { rolls, total };
}

export function rollMultiple(count: number): number[] {
  return Array.from({ length: count }, () => d6());
}

export function countSuccesses(rolls: number[], target: number): number {
  return rolls.filter(r => r >= target).length;
}
