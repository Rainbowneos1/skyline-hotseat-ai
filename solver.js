/* 回合内精确求解器（移植自 training/policies/turn_solver.py）。
 *
 * 状态 = (盘面多重集, 骰面多重集, 是否已结算)；机会节点只有"重掷"，按骰子类型的 6 个面展开期望。
 * 动作：build(面, 目标值) / abandon(面) / roll(面列表) / finish。
 */
(function (global) {
  'use strict';
  const D = SkyData;

  const MAX_ROLL_DICE = 2;
  const NODE_BUDGET = 20000;

  class SolverBudget extends Error {}

  const succCache = new Map();

  function successors(board, face) {
    const key = board.join(',') + '|' + face;
    const hit = succCache.get(key);
    if (hit) return hit;
    const out = [];
    const seen = new Set();
    const col = D.columnForFace(face);
    if (col !== null) {
      const nb = board.concat([col]).sort((a, b) => a - b);
      seen.add(nb.join(','));
      out.push([nb, null]);
    }
    const distinct = Array.from(new Set(board)).sort((a, b) => a - b);
    for (const v of distinct) {
      const nv = D.extendColumn(v, face);
      if (nv === null) continue;
      const b = board.slice();
      b.splice(b.indexOf(v), 1);
      b.push(nv);
      b.sort((a, b2) => a - b2);
      const k = b.join(',');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([b, v]);
    }
    if (succCache.size > 100000) succCache.clear();
    succCache.set(key, out);
    return out;
  }

  function canPlace(board, face) {
    return successors(board, face).length > 0;
  }

  function removeOne(dice, face) {
    const out = dice.slice();
    out.splice(out.indexOf(face), 1);
    return out;
  }

  function rerollOutcomes(faces) {
    let outcomes = [[1, []]];
    for (const face of faces) {
      const dist = D.DICE_FACES[D.FACE_TYPE[face]];
      const next = [];
      for (const [p, acc] of outcomes) {
        for (const nf of dist) next.push([p / dist.length, acc.concat([nf])]);
      }
      outcomes = next;
    }
    return outcomes;
  }

  class TurnSolver {
    constructor(valueFn, opts) {
      const o = opts || {};
      this.valueFn = valueFn;
      this.maxRollDice = o.maxRollDice === undefined ? MAX_ROLL_DICE : o.maxRollDice;
      this.budget = o.nodeBudget === undefined ? NODE_BUDGET : o.nodeBudget;
      this.memo = new Map();
      this.nodes = 0;
      this.turnKey = null;
      this.abandonCost = 0;
    }

    reset() {
      this.memo.clear();
      this.nodes = 0;
    }

    solve(board, dice, resolved) {
      const b = board.slice().sort((x, y) => x - y);
      const d = dice.slice().sort();
      const key = b.join(',') + '|' + d.join(',') + '|' + (resolved ? 1 : 0);
      const cached = this.memo.get(key);
      if (cached) return cached;

      this.nodes += 1;
      if (this.nodes > this.budget) throw new SolverBudget();

      let bestVal = -Infinity;
      let bestAct = null;
      const consider = (val, act) => {
        if (val > bestVal + 1e-9) { bestVal = val; bestAct = act; }
      };

      if (!d.length) {
        const res = [this.valueFn(b), ['finish']];
        this.memo.set(key, res);
        return res;
      }

      if (resolved) consider(this.valueFn(b), ['finish']);

      const faces = Array.from(new Set(d)).sort();

      for (const face of faces) {
        const succ = successors(b, face);
        for (const pair of succ) {
          const r = this.solve(pair[0], removeOne(d, face), true);
          consider(r[0], ['build', face, pair[1]]);
        }
      }

      for (const face of faces) {
        const r = this.solve(b, removeOne(d, face), true);
        consider(r[0] - this.abandonCost, ['abandon', face]);
      }

      if (resolved) {
        const dead = faces.filter((f) => !canPlace(b, f)).sort();
        if (dead.length) {
          const chosen = dead.slice(0, this.maxRollDice);
          let total = 0;
          for (const [p, nf] of rerollOutcomes(chosen)) {
            let nd = d.slice();
            for (const f of chosen) nd.splice(nd.indexOf(f), 1);
            nd = nd.concat(nf).sort();
            total += p * this.solve(b, nd, false)[0];
          }
          consider(total, ['roll', chosen]);
        }
      }

      const res = [bestVal, bestAct];
      this.memo.set(key, res);
      return res;
    }
  }

  /** 把抽象动作（面/目标值）翻译成引擎动作（下标）。 */
  function toEngineAction(game, action) {
    const board = game.buildings[game.current];
    const acts = game.legalActions();
    const kind = action[0];

    if (kind === 'finish') {
      return acts.find((a) => a.type === 'finish_turn') || null;
    }

    if (kind === 'roll') {
      const faces = action[1].slice();
      const idx = [];
      const pool = game.dice.map((f, i) => [i, f]);
      for (const face of faces) {
        const at = pool.findIndex((p) => p[1] === face);
        if (at < 0) return null;
        idx.push(pool[at][0]);
        pool.splice(at, 1);
      }
      idx.sort((a, b) => a - b);
      const want = idx.join(',');
      const exact = acts.find((a) => a.type === 'roll' && a.dice.join(',') === want);
      return exact || { type: 'roll', dice: idx };
    }

    if (kind === 'abandon') {
      const die = game.dice.indexOf(action[1]);
      if (die < 0) return null;
      return acts.find((a) => a.type === 'abandon' && a.dice.length === 1 && a.dice[0] === die)
        || { type: 'abandon', dice: [die] };
    }

    if (kind === 'build') {
      const face = action[1];
      const target = action[2];
      const die = game.dice.indexOf(face);
      if (die < 0) return null;
      let slot = null;
      if (target === null) slot = board.length;
      else slot = board.indexOf(target);
      if (slot === null || slot < 0) return null;
      return acts.find((a) => a.type === 'build' && a.die === die && a.slot === slot)
        || { type: 'build', die, slot };
    }

    return null;
  }

  // ---------------------------------------------------------------- 取骰搜索（v2）
  function candidateTakes(base, game, topK) {
    const board = game.buildings[game.current];
    const need = {
      0: base.typeValue(board, 0),
      1: base.typeValue(board, 1),
      2: base.typeValue(board, 2),
    };
    const scored = [];
    for (let a = 0; a < 3; a += 1) {
      for (let b = a; b < 3; b += 1) {
        for (let c = b; c < 3; c += 1) {
          const picks = [a, b, c];
          scored.push([base.takeScore(picks, need), picks]);
        }
      }
    }
    // 降序；同分保持原顺序（Python 的 sort 是稳定排序）
    scored.sort((x, y) => y[0] - x[0]);
    return scored.slice(0, topK).map((x) => x[1]);
  }

  function chooseTake(game, base, solver, rng, topK, samples) {
    const board = game.buildings[game.current].slice().sort((a, b) => a - b);
    const cands = candidateTakes(base, game, topK);
    const draws = [];
    for (let s = 0; s < samples; s += 1) draws.push([rng(), rng(), rng()]);

    let best = null;
    let bestVal = null;
    for (const types of cands) {
      let total = 0;
      for (const draw of draws) {
        const dice = types.map((t, i) => D.DICE_FACES[t][Math.floor(draw[i] * 6)]).sort();
        total += solver.solve(board, dice, false)[0];
      }
      const val = total / samples;
      if (bestVal === null || val > bestVal) { best = types; bestVal = val; }
    }
    solver.nodes = 0;

    const baseChoice = base.chooseTake(game);
    if (baseChoice && baseChoice.type === 'take_abandoned') return baseChoice;
    const acts = game.legalActions();
    const want = best.join(',');
    const matched = acts.find((a) => a.type === 'take_dice'
      && a.types.slice().sort((p, q) => p - q).join(',') === want);
    return matched || baseChoice;
  }

  const api = { TurnSolver, SolverBudget, successors, canPlace, removeOne, rerollOutcomes, toEngineAction, chooseTake, candidateTakes };
  global.SkySolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
