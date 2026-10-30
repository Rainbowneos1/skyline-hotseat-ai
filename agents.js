/* 智能体：随机 / 贪心 / 启发式。移植自 engine/skyline/agents.py 与 training/policies/heuristic.py。
 * 每个策略：`choose(game) -> action`，只用 game.legalActions() 提供的动作。
 */
(function (global) {
  'use strict';
  const D = SkyData;
  const E = SkyEngine;
  const R = SkyRng;

  // ---------------------------------------------------------------- 随机
  class RandomAgent {
    constructor(seed) { this.rand = R.mulberry32((seed || 1) >>> 0); }
    choose(game) {
      const acts = game.legalActions();
      return acts[Math.floor(this.rand() * acts.length)];
    }
  }

  // ---------------------------------------------------------------- 贪心
  function typeNeed(game) {
    const board = game.buildings[game.current];
    const need = { 0: 0, 1: 0, 2: 0 };
    for (const v of board) {
      for (const f of ['D', 'E', 'F', 'G', 'H']) {
        const nv = D.extendColumn(v, f);
        if (nv === null) continue;
        const gain = D.score(nv) - D.score(v);
        if (gain < 0) continue;
        let weight = 1 + Math.max(0, gain) * 0.5;
        if (nv >= 18) weight += 2;
        need[D.FACE_TYPE[f]] += weight;
      }
    }
    need[0] += Math.max(0, 5 - board.length) * 0.6;
    return need;
  }

  class GreedyAgent {
    choose(game) {
      const acts = game.legalActions();
      if (!acts.length) throw new Error('没有合法动作');

      if (game.phase === E.CHOOSE) {
        const need = typeNeed(game);
        const picks = [0, 1, 2].slice().sort((a, b) => (need[b] - need[a]) || (a - b)).slice(0, 3);
        const target = picks.slice().sort((a, b) => a - b);
        const want = target.join(',');
        const matched = acts.find((a) => a.type === 'take_dice' && a.types.slice().sort((x, y) => x - y).join(',') === want);
        return matched || acts.find((a) => a.type === 'take_dice');
      }

      if (game.phase === E.ROLL) return acts.find((a) => a.type === 'roll');

      const builds = acts.filter((a) => a.type === 'build');
      if (builds.length) {
        const board = game.buildings[game.current];
        let best = null;
        let bestKey = null;
        for (const a of builds) {
          const face = game.dice[a.die];
          const prev = a.slot === board.length ? null : board[a.slot];
          const nv = D.buildValue(prev, face);
          const gain = D.score(nv) - (prev === null ? 0 : D.score(prev));
          const key = [gain, D.height(nv), a.slot < board.length ? 1 : 0];
          if (bestKey === null || key[0] > bestKey[0]
            || (key[0] === bestKey[0] && key[1] > bestKey[1])
            || (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])) {
            best = a;
            bestKey = key;
          }
        }
        return best;
      }

      const finish = acts.find((a) => a.type === 'finish_turn');
      if (finish) return finish;
      const abandons = acts.filter((a) => a.type === 'abandon');
      if (abandons.length) {
        return abandons.reduce((best, a) => (a.dice.length > best.dice.length ? a : best));
      }
      return acts.find((a) => a.type === 'finish_turn');
    }
  }

  // ---------------------------------------------------------------- 启发式
  const DEFAULT_POT = {
    A: 1.0,
    B: 1.0, BE: 2.2, BEE: 3.6,
    C: 0.8, CF: 1.6, CFF: 2.8, CFFF: 4.2, CFFFF: 6.0,
  };
  const SEED_DECAY = 0.5;
  const REROLL_FACTOR = 1.0;
  const BASE_VALUE = 3.0;
  const DUPLICATE_DECAY = [1.0, 0.6, 0.4];
  const COLOR_ZH = { purple: '紫', blue: '蓝', orange: '橙' };

  class HeuristicAgent {
    constructor(seed) {
      this.pot = Object.assign({}, DEFAULT_POT);
      this.base = BASE_VALUE;
      this.rerollFactor = REROLL_FACTOR;
      this.dup = DUPLICATE_DECAY.slice();
      this.useDistrict = true;
      this.useReroll = true;
      this.turnKey = null;
    }

    value(building) {
      if (building >= 18) return D.score(building);
      return this.pot[D.COLUMNS[building]] || 0;
    }

    boardValue(board) {
      return board.reduce((s, v) => s + this.value(v), 0);
    }

    seedFactor(board, face) {
      const color = D.FACE_COLOR[face];
      let n = 0;
      for (const v of board) {
        if (v < 18 && D.FACE_COLOR[D.COLUMNS[v][0]] === color) n += 1;
      }
      return 1 / (1 + SEED_DECAY * n);
    }

    /** [(ΔV, slot)]，按 ΔV 降序（同分时 slot 大的在前，与 Python 元组排序一致）。 */
    placements(board, face) {
      const out = [];
      const newCol = D.columnForFace(face);
      if (newCol !== null) out.push([this.value(newCol) * this.seedFactor(board, face), board.length]);
      board.forEach((v, slot) => {
        const nv = D.extendColumn(v, face);
        if (nv === null) return;
        out.push([this.value(nv) - this.value(v), slot]);
      });
      out.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
      return out;
    }

    faceGain(board, face) {
      const ps = this.placements(board, face);
      return ps.length ? Math.max(0, ps[0][0]) : 0;
    }

    typeValue(board, dieType) {
      const faces = D.DICE_FACES[dieType];
      let total = 0;
      for (const f of faces) total += this.faceGain(board, f);
      return total / faces.length;
    }

    rerollExpectation(board, face) {
      return this.typeValue(board, D.FACE_TYPE[face]);
    }

    dupAt(k) {
      if (k < this.dup.length) return this.dup[k];
      let factor = this.dup[this.dup.length - 1];
      for (let i = 0; i < k - this.dup.length + 1; i += 1) factor *= 0.7;
      return factor;
    }

    takeScore(types, need) {
      let score = 0;
      const seen = { 0: 0, 1: 0, 2: 0 };
      for (const t of types) {
        score += (this.base + need[t]) * this.dupAt(seen[t]);
        seen[t] += 1;
      }
      return score;
    }

    chooseTake(game) {
      const board = game.buildings[game.current];
      const need = { 0: this.typeValue(board, 0), 1: this.typeValue(board, 1), 2: this.typeValue(board, 2) };
      const acts = game.legalActions();
      let best = null;
      let bestScore = null;
      for (let a = 0; a < 3; a += 1) {
        for (let b = a; b < 3; b += 1) {
          for (let c = b; c < 3; c += 1) {
            const picks = [a, b, c];
            const score = this.takeScore(picks, need);
            if (bestScore === null || score > bestScore) {
              best = picks.slice();
              bestScore = score;
            }
          }
        }
      }
      if (this.useDistrict && game.abandoned.length) {
        const districtTypes = game.abandoned.map((f) => D.FACE_TYPE[f]).sort((x, y) => x - y);
        if (this.takeScore(districtTypes, need) > bestScore) {
          const pile = acts.find((x) => x.type === 'take_abandoned');
          if (pile) return pile;
        }
      }
      const want = best.join(',');
      const matched = acts.find((x) => x.type === 'take_dice' && x.types.slice().sort((p, q) => p - q).join(',') === want);
      return matched || acts.find((x) => x.type === 'take_dice');
    }

    bestBuild(game) {
      const board = game.buildings[game.current];
      let best = null;
      let bestGain = 0;
      for (const action of game.legalActions()) {
        if (action.type !== 'build') continue;
        const hit = this.placements(board, game.dice[action.die]).find((p) => p[1] === action.slot);
        if (hit && hit[0] > bestGain) {
          best = action;
          bestGain = hit[0];
        }
      }
      return best;
    }

    chooseResolve(game) {
      const board = game.buildings[game.current];
      const build = this.bestBuild(game);
      if (build) return build;

      const acts = game.legalActions();
      const key = game.round + ':' + game.current;
      if (this.useReroll && key !== this.turnKey) {
        const rolls = acts.filter((a) => a.type === 'roll');
        const dead = [];
        game.dice.forEach((f, i) => { if (this.faceGain(board, f) === 0) dead.push(i); });
        const worthwhile = dead.some((i) => this.rerollExpectation(board, game.dice[i]) >= 0.5);
        if (rolls.length && dead.length && dead.length === game.dice.length && worthwhile) {
          this.turnKey = key;
          const want = dead.join(',');
          const matched = rolls.find((a) => a.dice.join(',') === want);
          return matched || { type: 'roll', dice: dead };
        }
      }

      const finish = acts.find((a) => a.type === 'finish_turn');
      if (finish) return finish;

      const abandons = acts.filter((a) => a.type === 'abandon');
      if (abandons.length) {
        let worst = 0;
        game.dice.forEach((f, i) => { if (this.faceGain(board, f) < this.faceGain(board, game.dice[worst])) worst = i; });
        const matched = abandons.find((a) => a.dice.length === 1 && a.dice[0] === worst);
        return matched || abandons[0];
      }
      return acts.find((a) => a.type === 'finish_turn');
    }

    choose(game) {
      if (game.phase === E.CHOOSE) return this.chooseTake(game);
      if (game.phase === E.ROLL) return game.legalActions().find((a) => a.type === 'roll');
      return this.chooseResolve(game);
    }
  }

  // ---------------------------------------------------------------- 求解器（难度 4–6）
  class SolverAgent {
    /**
     * @param {number} level 4=求解器+手工估值  5=+线性估值  6=+取骰搜索（冠军）
     */
    constructor(level, seed) {
      this.level = level;
      this.base = new HeuristicAgent(1);
      this.model = level >= 5 && global.SkyValue ? new global.SkyValue.LinearValue() : null;
      this.takeSearch = level >= 6 ? { topK: 3, samples: 8 } : null;
      this.rng = R.mulberry32(((seed || 1) * 2654435761) >>> 0);
      this.valueTurns = 8;
      this.solver = new global.SkySolver.TurnSolver((board) => (
        this.model ? this.model.value(board, this.valueTurns) : this.base.boardValue(board)
      ));
      this.skipTurn = null;
    }

    choose(game) {
      const S = global.SkySolver;
      const turns = D.MAX_ROUNDS - game.round;

      if (game.phase === E.CHOOSE) {
        if (this.takeSearch) {
          return S.chooseTake(game, this.base, this.solver, this.rng,
            this.takeSearch.topK, this.takeSearch.samples);
        }
        return this.base.chooseTake(game);
      }
      if (game.phase === E.ROLL) return game.legalActions().find((a) => a.type === 'roll');

      this.valueTurns = turns;
      const key = game.round + ':' + game.current;
      if (this.solver.turnKey !== key) {
        this.solver.turnKey = key;
        this.solver.reset();
      }
      if (this.skipTurn === key) return this.base.chooseResolve(game);

      const board = game.buildings[game.current].slice().sort((a, b) => a - b);
      const dice = game.dice.slice().sort();
      try {
        const out = this.solver.solve(board, dice, !!game.resolved);
        const action = S.toEngineAction(game, out[1]);
        return action || this.base.chooseResolve(game);
      } catch (err) {
        if (err instanceof S.SolverBudget) {
          this.skipTurn = key;
          return this.base.chooseResolve(game);
        }
        throw err;
      }
    }
  }

  const api = { RandomAgent, GreedyAgent, HeuristicAgent, SolverAgent, DEFAULT_POT };
  global.SkyAgents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
