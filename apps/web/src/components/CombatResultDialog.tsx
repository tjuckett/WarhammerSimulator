import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { LogEntry } from '@warhammer-simulator/core/types/battle';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WeaponStats { bs: number; strength: number; ap: number; damage: string; toughness?: number; hasCover: boolean; coverBonus: number }

interface DiceGroup {
  label: string;
  sublabel?: string;
  target: number;
  rolls: number[];
  successCount: number;
  isSave: boolean;
  isCritAt6: boolean;
  note?: string;
  resultText?: string;
}

interface AttackRoll { expr: string; rolls: number[]; total: number }
interface DamageRoll { expr: string; rolls: number[]; total: number }

interface Outcome { text: string; kind: 'kill' | 'wound' | 'death' }

interface AttackBlock {
  emoji: string;
  weaponName: string;
  attackerName: string;
  defenderName: string;
  modelCount: number;
  attacksExpr: string;
  totalAttacks: number;
  stats?: WeaponStats;
  toughness?: number;
  woundTarget?: number;
  attackRoll?: AttackRoll;
  hitGroup?: DiceGroup;
  woundGroup?: DiceGroup;
  woundRerollGroup?: DiceGroup;
  saveGroup?: DiceGroup;
  noSaveText?: string;
  damageRolls: DamageRoll[];
  mortals: number;
  notes: string[];
  outcomes: Outcome[];
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function extractRolls(msg: string): number[] {
  const m = msg.match(/\[([^\]]+)\]/);
  if (!m) return [];
  return m[1].split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
}

function parseBlocks(entries: LogEntry[]): AttackBlock[] {
  const blocks: AttackBlock[] = [];
  let cur: AttackBlock | null = null;

  for (const e of entries) {
    const msg = e.message;

    // New weapon block
    if (e.type === 'shoot' || e.type === 'fight') {
      const m = msg.match(/(\S+)\s+(.+?)\s+—\s+(\d+)\s+model\(s\)\s+×\s+(\S+)\s+=\s+(\d+)\s+attacks\s+vs\s+(.+)/u);
      cur = {
        emoji: m?.[1] ?? (e.type === 'shoot' ? '🔫' : '⚔️'),
        weaponName: m?.[2] ?? msg.trim(),
        attackerName: e.unitName,
        defenderName: m?.[6] ?? '',
        modelCount: m ? parseInt(m[3]) : 0,
        attacksExpr: m?.[4] ?? '',
        totalAttacks: m ? parseInt(m[5]) : 0,
        damageRolls: [],
        mortals: 0,
        notes: [],
        outcomes: [],
      };
      blocks.push(cur);
      continue;
    }

    if (!cur) continue;

    // Combat stats
    if (e.type === 'info' && msg.includes('[combat-stats]')) {
      const skill = msg.match(/skill=(\d+)/)?.[1];
      const s = msg.match(/\bs=(\d+)/)?.[1];
      const ap = msg.match(/ap=(-?\d+)/)?.[1];
      const d = msg.match(/\bd=(\S+)/)?.[1];
      const t = msg.match(/\bt=(\d+)/)?.[1];
      const hasCover = msg.includes('cover=1');
      if (skill && s && ap && d) {
        const apNum = parseInt(ap);
        // cover=1 means cover was detected; bonus is +1 for infantry (we show +1 conservatively here)
        const coverBonus = hasCover ? 1 : 0;
        cur.stats = { bs: parseInt(skill), strength: parseInt(s), ap: apNum, damage: d, toughness: t ? parseInt(t) : undefined, hasCover, coverBonus };
      }
      continue;
    }

    if (e.type === 'info') {
      const text = msg.trim().replace(/^\s+/, '');
      if (text) cur.notes.push(text);
      continue;
    }

    if (e.type === 'roll') {
      // Attack rolls (D6): [4, 3, 5] = 12 attacks
      const atk = msg.match(/Attack rolls? \(([^)]+)\):\s*\[[^\]]*\]\s*=\s*(\d+)\s+attacks?/);
      if (atk) {
        cur.attackRoll = { expr: atk[1], rolls: extractRolls(msg), total: parseInt(atk[2]) };
        continue;
      }
      // Hit rolls (3+): [...] → 4 hits
      const hit = msg.match(/Hit rolls \((\d+)\+\):\s*\[[^\]]*\]\s*→\s*(\d+)\s+hits(.*)?/);
      if (hit) {
        const note = hit[3]?.match(/\[([^\]]+)\]/)?.[1];
        cur.hitGroup = {
          label: 'Hit Rolls', target: parseInt(hit[1]), rolls: extractRolls(msg),
          successCount: parseInt(hit[2]), isSave: false, isCritAt6: true, note,
        };
        continue;
      }
      // Torrent: N auto-hit(s)
      const torrent = msg.match(/Torrent:\s+(\d+)\s+auto-hit/);
      if (torrent) {
        cur.hitGroup = {
          label: 'Hit Rolls', target: 0, rolls: [], successCount: parseInt(torrent[1]),
          isSave: false, isCritAt6: false, note: 'Torrent — auto-hits',
        };
        continue;
      }
      // Wound rolls (S4 vs T4, 4+): [...] → 2 wounds
      const wnd = msg.match(/Wound rolls \(S(\d+) vs T(\d+),\s*(\d+)\+\):\s*\[[^\]]*\]\s*→\s*(\d+)\s+wounds(.*)?/);
      if (wnd) {
        const note = wnd[5]?.match(/\[([^\]]+)\]/)?.[1];
        cur.toughness = parseInt(wnd[2]);
        cur.woundTarget = parseInt(wnd[3]);
        cur.woundGroup = {
          label: 'Wound Rolls', sublabel: `S${wnd[1]} vs T${wnd[2]}`,
          target: parseInt(wnd[3]), rolls: extractRolls(msg),
          successCount: parseInt(wnd[4]), isSave: false, isCritAt6: true, note,
        };
        continue;
      }
      // Twin-linked wound rerolls (4+): [...] -> 1 wounds
      const twin = msg.match(/Twin-linked wound rerolls \((\d+)\+\):\s*\[[^\]]*\]\s*->\s*(\d+)\s+wounds/);
      if (twin) {
        cur.woundRerollGroup = {
          label: 'Wound Rerolls', sublabel: 'Twin-linked',
          target: parseInt(twin[1]), rolls: extractRolls(msg),
          successCount: parseInt(twin[2]), isSave: false, isCritAt6: true,
        };
        continue;
      }
      // No save possible
      if (msg.includes('No save possible')) {
        cur.noSaveText = msg.trim().replace(/^\s+/, '');
        continue;
      }
      // Save rolls (4+): [...] → 1 saved, 2 failed
      const save = msg.match(/Save rolls \((\d+)\+([^)]*)\):\s*\[[^\]]*\]\s*→\s*(\d+)\s+saved,\s*(\d+)\s+failed/);
      if (save) {
        const cover = save[2].match(/cover \+(\d+)/)?.[1];
        cur.saveGroup = {
          label: 'Save Rolls', target: parseInt(save[1]), rolls: extractRolls(msg),
          successCount: parseInt(save[3]), isSave: true, isCritAt6: false,
          note: cover ? `cover +${cover}` : undefined,
          resultText: `${save[3]} saved · ${save[4]} failed`,
        };
        continue;
      }
      // Damage roll (D3): [2] = 2
      const dmgRoll = msg.match(/Damage roll \(([^)]+)\):\s*\[[^\]]*\]\s*=\s*(\d+)/);
      if (dmgRoll) {
        cur.damageRolls.push({ expr: dmgRoll[1], rolls: extractRolls(msg), total: parseInt(dmgRoll[2]) });
        continue;
      }
      // Lethal Hits note
      if (msg.includes('Lethal Hits:')) {
        cur.notes.push(msg.trim().replace(/^\s+/, ''));
        continue;
      }
      continue;
    }

    if (e.type === 'damage') {
      // Mortal wounds
      const mortal = msg.match(/\+(\d+)\s+mortal wound/);
      if (mortal) { cur.mortals += parseInt(mortal[1]); continue; }
      // Kills with remaining count
      const kill = msg.match(/(\d+)\s+model\(s\)\s+slain.*\((\d+)\/(\d+)\s+remain\)/);
      if (kill) {
        cur.outcomes.push({ text: `${kill[1]} model${kill[1] === '1' ? '' : 's'} slain  (${kill[2]}/${kill[3]} remain)`, kind: 'kill' });
        continue;
      }
      // Deferred kills (select casualties)
      const deferKill = msg.match(/(\d+)\s+model\(s\)\s+slain\s*-\s*select\s+(\d+)\s+casualty/);
      if (deferKill) {
        cur.outcomes.push({ text: `${deferKill[1]} model${deferKill[1] === '1' ? '' : 's'} slain  (select ${deferKill[2]} to remove)`, kind: 'kill' });
        continue;
      }
      // Damage absorbed
      const abs = msg.match(/(\d+)\s+damage\s+absorbed\s+\((\d+)W\s+left/);
      if (abs) {
        cur.outcomes.push({ text: `${abs[1]} damage absorbed  (${abs[2]}W left on lead model)`, kind: 'wound' });
        continue;
      }
      // Melta note
      if (msg.includes('Melta:')) {
        cur.notes.push(msg.trim().replace(/^\s+/, ''));
        continue;
      }
      continue;
    }

    if (e.type === 'death') {
      cur.outcomes.push({ text: msg.trim().replace(/^\s+/, '').replace(/^💀\s*/, ''), kind: 'death' });
    }
  }

  return blocks;
}

// ── Styling helpers ───────────────────────────────────────────────────────────

function woundTargetColor(wt: number): string {
  if (wt <= 2) return '#4caf50';
  if (wt === 3) return '#8bc34a';
  if (wt === 4) return '#cddc39';
  if (wt === 5) return '#ffc107';
  return '#ff5722';
}

interface DiceStyle { bg: string; border: string; color: string }

function diceStyle(value: number, target: number, isSave: boolean, isCritAt6: boolean): DiceStyle {
  if (isSave) {
    const saved = value >= target;
    return saved
      ? { bg: '#111', border: '#2a2a2a', color: '#444' }
      : { bg: '#2a1500', border: '#6b3800', color: '#d07030' };
  }
  if (isCritAt6 && value === 6) {
    return { bg: '#2a1e00', border: '#a07800', color: '#ffd700' };
  }
  const success = value >= target;
  return success
    ? { bg: '#0d260d', border: '#2a5c2a', color: '#78d786' }
    : { bg: '#1a0d0d', border: '#3a1818', color: '#664444' };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Die({ value, target, isSave, isCritAt6 }: { value: number; target: number; isSave: boolean; isCritAt6: boolean }) {
  const s = diceStyle(value, target, isSave, isCritAt6);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 26, height: 26, borderRadius: 5,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      fontSize: 13, fontWeight: 700, flexShrink: 0,
    }}>
      {value}
    </span>
  );
}

function RollRow({ group }: { group: DiceGroup }) {
  const isAutoHit = group.rolls.length === 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase' }}>
          {group.label}
        </span>
        {group.sublabel && (
          <span style={{ fontSize: 11, color: '#888' }}>{group.sublabel}</span>
        )}
        {group.target > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#aaa',
            background: '#1e2a36', borderRadius: 3, padding: '1px 6px', border: '1px solid #2a3d52',
          }}>
            {group.target}+
          </span>
        )}
        {group.note && (
          <span style={{ fontSize: 10, color: '#c9a84c', fontStyle: 'italic' }}>{group.note}</span>
        )}
      </div>
      {isAutoHit ? (
        <span style={{ fontSize: 12, color: '#78d786' }}>
          {group.successCount} auto-hits
        </span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}>
          {group.rolls.map((v, i) => (
            <Die key={i} value={v} target={group.target} isSave={group.isSave} isCritAt6={group.isCritAt6} />
          ))}
          <span style={{ fontSize: 12, color: '#999', marginLeft: 6 }}>
            {group.resultText ?? `→  ${group.successCount}`}
          </span>
        </div>
      )}
    </div>
  );
}

function DamageDie({ value }: { value: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 26, height: 26, borderRadius: 5,
      background: '#1a1040', border: '1px solid #4a3a80', color: '#9b8fd4',
      fontSize: 13, fontWeight: 700, flexShrink: 0,
    }}>
      {value}
    </span>
  );
}

function AttackCard({ block }: { block: AttackBlock }) {
  const { stats, woundTarget } = block;
  const toughness = stats?.toughness ?? block.toughness;

  const totalKilled = block.outcomes
    .filter(o => o.kind === 'kill')
    .reduce((sum, o) => {
      const m = o.text.match(/^(\d+)/);
      return sum + (m ? parseInt(m[1]) : 0);
    }, 0);

  return (
    <div style={{
      background: '#0d1b26', border: '1px solid #1e3048', borderRadius: 8,
      overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', background: '#0a1520', borderBottom: '1px solid #1e3048' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{block.emoji}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#e0e8f0' }}>{block.weaponName}</span>
        </div>
        <div style={{ fontSize: 11, color: '#6a8aaa', marginTop: 2 }}>
          {block.attackerName}  →  {block.defenderName}
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
          borderBottom: '1px solid #1e3048',
        }}>
          {/* BS */}
          <div style={{ padding: '8px 12px', borderRight: '1px solid #1e3048', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#556', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
              BS / WS
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#8ab4ff' }}>{stats.bs}+</div>
          </div>
          {/* S vs T */}
          <div style={{ padding: '8px 12px', borderRight: '1px solid #1e3048', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#556', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
              S vs T
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#aac8e8' }}>S{stats.strength}</span>
              <span style={{ fontSize: 11, color: '#445' }}>vs</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#aac8e8' }}>T{toughness ?? '?'}</span>
            </div>
            {woundTarget && (
              <div style={{
                marginTop: 4, fontSize: 12, fontWeight: 700,
                color: woundTargetColor(woundTarget),
              }}>
                wounds on {woundTarget}+
              </div>
            )}
          </div>
          {/* AP + Cover */}
          <div style={{ padding: '8px 12px', borderRight: '1px solid #1e3048', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#556', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
              AP
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: stats.ap < 0 ? '#ff9f43' : '#667' }}>
              {stats.ap === 0 ? '0' : stats.ap}
            </div>
            {stats.hasCover && (
              <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: stats.coverBonus > 0 ? '#00dcc3' : '#558' }}>
                ⛨ {stats.coverBonus > 0 ? `+${stats.coverBonus} save` : 'cover (no bonus)'}
              </div>
            )}
          </div>
          {/* Damage */}
          <div style={{ padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#556', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
              Damage
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#9b8fd4' }}>{stats.damage}</div>
          </div>
        </div>
      )}

      {/* Roll sections */}
      <div style={{ padding: '12px 14px' }}>
        {/* Attacks (if variable) */}
        {block.attackRoll && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase', marginBottom: 5 }}>
              Attack Roll  <span style={{ color: '#888', fontWeight: 400, fontSize: 10 }}>({block.attackRoll.expr})</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}>
              {block.attackRoll.rolls.map((v, i) => <DamageDie key={i} value={v} />)}
              <span style={{ fontSize: 12, color: '#999', marginLeft: 6 }}>
                = {block.attackRoll.total} attacks
              </span>
            </div>
          </div>
        )}

        {/* Notes */}
        {block.notes.map((n, i) => (
          <div key={i} style={{ fontSize: 11, color: '#c9a84c', marginBottom: 6, fontStyle: 'italic' }}>{n}</div>
        ))}

        {block.hitGroup && <RollRow group={block.hitGroup} />}
        {block.woundGroup && <RollRow group={block.woundGroup} />}
        {block.woundRerollGroup && <RollRow group={block.woundRerollGroup} />}

        {/* No save */}
        {block.noSaveText && (
          <div style={{ marginBottom: 10, fontSize: 11, color: '#d07030', fontStyle: 'italic' }}>
            {block.noSaveText}
          </div>
        )}
        {block.saveGroup && <RollRow group={block.saveGroup} />}

        {/* Damage rolls (variable) */}
        {block.damageRolls.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase' }}>
                Damage Rolls
              </span>
              <span style={{ fontSize: 10, color: '#888' }}>({block.damageRolls[0].expr})</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {block.damageRolls.map((dr, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {dr.rolls.map((v, j) => <DamageDie key={j} value={v} />)}
                  <span style={{ fontSize: 11, color: '#667', marginRight: 4 }}>=</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#9b8fd4' }}>{dr.total}</span>
                  {i < block.damageRolls.length - 1 && (
                    <span style={{ color: '#445', marginLeft: 4 }}>·</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Mortal wounds */}
        {block.mortals > 0 && (
          <div style={{ marginBottom: 8, fontSize: 12, color: '#ff6f6f' }}>
            +{block.mortals} mortal wound{block.mortals !== 1 ? 's' : ''}
          </div>
        )}

        {/* Outcomes */}
        {block.outcomes.length > 0 && (
          <div style={{
            marginTop: 8, paddingTop: 10, borderTop: '1px solid #1e3048',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {block.outcomes.map((o, i) => {
              if (o.kind === 'death') {
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 16 }}>💀</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#ff6f6f' }}>{o.text} DESTROYED</span>
                  </div>
                );
              }
              if (o.kind === 'kill') {
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>⚠️</span>
                    <span style={{ fontSize: 13, color: '#f9a825' }}>{o.text}</span>
                  </div>
                );
              }
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14 }}>🩸</span>
                  <span style={{ fontSize: 12, color: '#d07030' }}>{o.text}</span>
                </div>
              );
            })}
            {totalKilled === 0 && block.outcomes.length === 0 && (
              <div style={{ fontSize: 12, color: '#445' }}>No casualties</div>
            )}
          </div>
        )}
        {block.outcomes.length === 0 && !block.noSaveText && (
          <div style={{ marginTop: 4, fontSize: 12, color: '#334', fontStyle: 'italic' }}>No casualties</div>
        )}
      </div>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  entries: LogEntry[];
  hasPendingCasualties: boolean;
  onClose: () => void;
}

export function CombatResultDialog({ open, entries, hasPendingCasualties, onClose }: Props) {
  const blocks = parseBlocks(entries);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1, fontSize: 16, fontWeight: 700, color: '#e0e8f0' }}>
        Shooting Result
      </DialogTitle>
      <DialogContent dividers sx={{ p: 2 }}>
        {blocks.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No attack data.</Typography>
        ) : (
          blocks.map((block, i) => <AttackCard key={i} block={block} />)
        )}
        {hasPendingCasualties && (
          <Typography variant="caption" sx={{ display: 'block', color: '#c9b66a', mt: 1 }}>
            Select the target model(s) on the battlefield, then use Remove Casualty.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
