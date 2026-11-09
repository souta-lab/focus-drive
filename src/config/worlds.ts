import type { StimulusToken, WorldDefinition, WorldId } from '../core/types';

const token = (id: string, shape: StimulusToken['shape'], color: string, label: string): StimulusToken => ({ id, shape, color, label });
const mint = '#51efbc';
/** W1/W2 sets follow the published descriptions; W3/W4 are explicit substitutes. */
export const WORLDS: readonly WorldDefinition[] = [
  { id: 1, name: 'Coastal Dawn', subtitle: '海岸の夜明け', theme: 'coast',
    target: token('w1-green', 'circle', mint, '緑の円'),
    distractors: [token('w1-orange', 'circle', '#ffad66', 'オレンジの円'), token('w1-violet', 'circle', '#aa92ff', '紫の円')],
    rule: '緑の円だけに反応。同じ形・3色の識別。', evidence: 'PUBLISHED' },
  { id: 2, name: 'Alpine Pass', subtitle: '森を抜ける峠', theme: 'alpine',
    target: token('w2-diamond', 'diamond', mint, '緑のひし形'),
    distractors: [token('w2-circle', 'circle', mint, '緑の円'), token('w2-triangle', 'triangle', mint, '緑の三角'), token('w2-square', 'square', mint, '緑の四角'), token('w2-pentagon', 'pentagon', mint, '緑の五角形'), token('w2-hexagon', 'hexagon', mint, '緑の六角形')],
    rule: '緑のひし形だけに反応。同色・6種類の形状識別。', evidence: 'PUBLISHED' },
  { id: 3, name: 'Night Express', subtitle: '静かな夜の高速', theme: 'night',
    target: token('w3-mint-triangle', 'triangle', mint, '緑の三角'),
    distractors: [token('w3-orange-triangle', 'triangle', '#ffad66', 'オレンジの三角'), token('w3-mint-circle', 'circle', mint, '緑の円'), token('w3-purple-square', 'square', '#aa92ff', '紫の四角')],
    rule: '緑＋三角の組み合わせだけに反応。暫定の推定ルール。', evidence: 'INFERRED' },
  { id: 4, name: 'Sky Circuit', subtitle: '雲上のサーキット', theme: 'sky',
    target: token('w4-mint-diamond', 'diamond', mint, '緑のひし形'),
    alternateTarget: token('w4-orange-circle', 'circle', '#ffad66', 'オレンジの円'),
    distractors: [token('w4-mint-circle', 'circle', mint, '緑の円'), token('w4-orange-diamond', 'diamond', '#ffad66', 'オレンジのひし形'), token('w4-purple-hexagon', 'hexagon', '#aa92ff', '紫の六角形')],
    rule: '30秒ごとに表示される指定を切替。暫定の推定ルール。', evidence: 'INFERRED' },
];
export function getWorld(id: WorldId): WorldDefinition {
  const world = WORLDS.find((entry) => entry.id === id);
  if (!world) throw new RangeError(`Unknown world: ${id}`);
  return world;
}
/**
 * Every token a world can show. The designated target is drawn from this set per mission, so
 * the task is not always the same colour while the published rule structure (three colours,
 * six shapes, conjunction, alternating) is preserved.
 */
const POOLS: Record<WorldId, readonly StimulusToken[]> = {
  1: [WORLDS[0]!.target, ...WORLDS[0]!.distractors],
  2: [WORLDS[1]!.target, ...WORLDS[1]!.distractors],
  3: [WORLDS[2]!.target, ...WORLDS[2]!.distractors],
  4: [WORLDS[3]!.target, WORLDS[3]!.alternateTarget!, ...WORLDS[3]!.distractors],
};
export interface MissionTokens { target: StimulusToken; alternate?: StimulusToken; distractors: StimulusToken[] }
/**
 * Which token this mission asks for. World 1 and 2 rotate the designated token by mission seed
 * (any of the three circles / six shapes may be the target); World 3 keeps its inferred
 * conjunction rule fixed; World 4 keeps its published 30s alternation.
 */
export function missionTokens(id: WorldId, seed = 0): MissionTokens {
  const world = getWorld(id);
  const pool = POOLS[id];
  if (id === 3) return { target: world.target, distractors: [...world.distractors] };
  if (id === 1 || id === 2) {
    const target = pool[((seed % pool.length) + pool.length) % pool.length]!;
    return { target, distractors: pool.filter((entry) => entry.id !== target.id) };
  }
  const flip = seed % 2 === 0;
  const target = flip ? world.target : world.alternateTarget!;
  const alternate = flip ? world.alternateTarget! : world.target;
  return { target, alternate, distractors: pool.filter((entry) => entry.id !== target.id && entry.id !== alternate.id) };
}
export function targetForTime(id: WorldId, elapsedMs: number, seed = 0): StimulusToken {
  const { target, alternate } = missionTokens(id, seed);
  return alternate && Math.floor(elapsedMs / 30_000) % 2 === 1 ? alternate : target;
}
