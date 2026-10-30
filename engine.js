/* Skyline 规则引擎（JS 版）：状态机 + 合法动作 + 计分。
 * 严格移植自 engine/skyline/engine.py，规则依据见 RULES-VERIFICATION.md（34 条结论）。
 * 浏览器挂全局 SkyEngine；Node 里可 require（golden 对拍用）。
 */
(function (global) {
  'use strict';

  const D = (typeof SkyData !== 'undefined') ? SkyData : require('./data.js');
  const R = (typeof SkyRng !== 'undefined') ? SkyRng : require('./rng.js');

  const CHOOSE = 0, ROLL = 1, RESOLVE = 2;
  const PHASE_NAMES = { 0: '取骰', 1: '掷骰', 2: '结算' };
  const MAX_SUBSET_DICE = 8;

  class IllegalAction extends Error {}

  function combinations(n) {
    // 返回 1..n 的全部非空子集（按长度、字典序，与 Python itertools.combinations 顺序一致）
    const out = [];
    for (let k = 1; k <= n; k += 1) {
      const idx = [];
      const rec = (start, depth) => {
        if (depth === k) { out.push(idx.slice()); return; }
        for (let i = start; i < n; i += 1) {
          idx.push(i);
          rec(i + 1, depth + 1);
          idx.pop();
        }
      };
      rec(0, 0);
    }
    return out;
  }

  class Game {
    constructor(players = 2, opts = {}) {
      if (![2, 3, 4].includes(players)) throw new Error('Skyline 支持 2-4 人');
      const start = opts.start || 0;
      if (!(start >= 0 && start < players)) throw new Error('start 必须是合法座位号');
      this.numPlayers = players;
      this.names = opts.names ? opts.names.slice() : Array.from({ length: players }, (_, i) => 'P' + (i + 1));
      if (this.names.length !== players) throw new Error('names 数量必须等于人数');
      this.nineRounds = !!opts.nineRounds;
      this.start = start;
      this.round = 1;
      this.current = start;
      this.phase = CHOOSE;
      this.dice = [];
      this.abandoned = D.DISTRICT_FILL.slice();
      this.resolved = false;
      this.finalRound = false;
      this.ended = false;
      this.seed = (opts.seed === undefined || opts.seed === null)
        ? Math.floor(Math.random() * 0x7fffffff)   // 每局默认随机种子，否则每局骰子都一样
        : opts.seed;
      this.source = opts.diceSource || new R.DiceSource(this.seed, opts.diceQueue);
      this.buildings = Array.from({ length: players }, () => []);
      // 开局赠送：按回合顺序 起始 C、第二 B、第三 A、第四无
      D.START_BUILDINGS.forEach((value, k) => {
        if (k < players) this.buildings[(start + k) % players].push(value);
      });
    }

    // ------------------------------------------------------------ 基本查询
    get gameOver() { return this.ended; }
    me() { return this.current; }
    turnOrder() {
      return Array.from({ length: this.numPlayers }, (_, k) => (this.start + k) % this.numPlayers);
    }
    lastSeat() { return (this.start - 1 + this.numPlayers) % this.numPlayers; }

    scoreBreakdown(p) {
      const b = this.buildings[p];
      const byHeight = {};
      for (const v of b) {
        if (v >= 18) { const h = D.height(v); byHeight[h] = (byHeight[h] || 0) + 1; }
      }
      return {
        player: p,
        name: this.names[p],
        score: D.totalScore(b),
        completed: D.completedCount(b),
        by_height: byHeight,
        unfinished_a: b.filter((v) => v < 18 && D.COLUMNS[v] === 'A').length,
        buildings: b.map(D.describe),
      };
    }

    results() {
      const rows = this.buildings.map((_, p) => this.scoreBreakdown(p));
      const order = rows.slice().sort((a, b) => (b.score - a.score) || (b.completed - a.completed) || (a.player - b.player));
      const ranked = [];
      let rank = 0;
      order.forEach((r, i) => {
        const prev = order[i - 1];
        if (i && r.score === prev.score && r.completed === prev.completed) {
          r.rank = ranked[ranked.length - 1].rank;
        } else {
          rank += 1;
          r.rank = rank;
        }
        ranked.push(r);
      });
      const top = ranked[0];
      const winners = ranked.filter((r) => r.rank === top.rank).map((r) => r.player);
      return {
        players: rows,
        ranking: ranked,
        winner: winners.length === 1 ? winners[0] : null,
        winners,
        tie: winners.length > 1,
      };
    }

    // ------------------------------------------------------------ 合法动作
    subsets(n) {
      if (n <= MAX_SUBSET_DICE) return combinations(n);
      const out = [];
      for (let i = 0; i < n; i += 1) out.push([i]);
      out.push(Array.from({ length: n }, (_, i) => i));
      return out;
    }

    legalActions() {
      if (this.ended) return [];
      const acts = [];
      if (this.phase === CHOOSE) {
        for (let t0 = 0; t0 < 3; t0 += 1) {
          for (let t1 = 0; t1 < 3; t1 += 1) {
            for (let t2 = 0; t2 < 3; t2 += 1) {
              acts.push({
                type: 'take_dice',
                types: [t0, t1, t2],
                desc: '从工地取 3 颗：' + [t0, t1, t2].map((t) => D.TYPE_NAMES[t]).join('、'),
              });
            }
          }
        }
        acts.push({
          type: 'take_abandoned',
          desc: '拿光废弃区（' + this.abandoned.map(D.describeFace).join('、') + '），随后补满 A/E/H',
        });
      } else if (this.phase === ROLL) {
        acts.push({
          type: 'roll',
          dice: this.dice.map((_, i) => i),
          desc: '掷全部骰子：' + this.dice.join(' '),
        });
      } else {
        const board = this.buildings[this.current];
        if (this.dice.length) {
          if (this.resolved) {
            for (const sub of this.subsets(this.dice.length)) {
              acts.push({
                type: 'roll',
                dice: sub,
                desc: '重掷 ' + sub.map((i) => this.dice[i]).join(' '),
              });
            }
          }
          this.dice.forEach((face, die) => {
            const slot = board.length;
            if (D.columnForFace(face) !== null) {
              acts.push({
                type: 'build', die, slot,
                desc: '用 ' + D.describeFace(face) + ' 新建' + (D.COLOR_ZH[D.FACE_COLOR[face]] || '') + '楼',
              });
            }
            board.forEach((v, s) => {
              const nv = D.extendColumn(v, face);
              if (nv !== null) {
                acts.push({
                  type: 'build', die, slot: s,
                  desc: '用 ' + D.describeFace(face) + ' 加高第' + (s + 1) + '栋 ' + D.describe(v) + ' -> ' + D.describe(nv),
                });
              }
            });
          });
          for (const sub of this.subsets(this.dice.length)) {
            acts.push({
              type: 'abandon',
              dice: sub,
              desc: '弃置 ' + sub.map((i) => this.dice[i]).join(' ') + ' 到废弃区',
            });
          }
          this.dice.forEach((face, die) => {
            board.forEach((v, s) => {
              acts.push({
                type: 'demolish', die, slot: s,
                desc: '用 ' + D.describeFace(face) + ' 拆除第' + (s + 1) + '栋 ' + D.describe(v),
              });
            });
          });
          if (this.resolved) {
            acts.push({ type: 'finish_turn', desc: '结束回合，把剩下的 ' + this.dice.length + ' 颗骰子退回工地' });
          }
        } else {
          acts.push({ type: 'finish_turn', desc: '结束回合' });
        }
      }
      return acts;
    }

    // ------------------------------------------------------------ 执行
    apply(action) {
      if (this.ended) throw new IllegalAction('对局已结束');
      switch (action && action.type) {
        case 'take_dice': this._takeDice(action.types); break;
        case 'take_abandoned': this._takeAbandoned(); break;
        case 'roll': this._roll(action.dice); break;
        case 'build': this._build(action.die, action.slot); break;
        case 'abandon': this._abandon(action.dice); break;
        case 'demolish': this._demolish(action.die, action.slot); break;
        case 'finish_turn': this._finishTurn(); break;
        default: throw new IllegalAction('未知动作类型 ' + JSON.stringify(action));
      }
    }

    _takeDice(types) {
      if (this.phase !== CHOOSE) throw new IllegalAction('现在不是取骰阶段');
      if (!Array.isArray(types) || types.length !== 3) throw new IllegalAction('必须指定正好 3 颗骰子的类型');
      if (types.some((t) => ![0, 1, 2].includes(t))) throw new IllegalAction('骰子类型必须是 0/1/2');
      this.dice = types.map((t) => this.source.roll(t));
      this.phase = ROLL;
      this.resolved = false;
    }

    _takeAbandoned() {
      if (this.phase !== CHOOSE) throw new IllegalAction('现在不是取骰阶段');
      if (!this.abandoned.length) throw new IllegalAction('废弃区是空的');
      this.dice = this.abandoned.slice();
      this.abandoned = D.DISTRICT_FILL.slice();
      this.phase = ROLL;
      this.resolved = false;
    }

    _roll(dice) {
      if (!Array.isArray(dice) || !dice.length) throw new IllegalAction('必须选择至少一颗骰子');
      const idx = Array.from(new Set(dice)).sort((a, b) => a - b);
      if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= this.dice.length)) {
        throw new IllegalAction('骰子下标越界');
      }
      if (this.phase === ROLL) {
        if (idx.length !== this.dice.length) throw new IllegalAction('拿到骰子后的第一掷必须掷全部骰子');
      } else if (this.phase === RESOLVE) {
        if (!this.resolved) throw new IllegalAction('必须先结算至少一颗骰子才能重掷');
      } else {
        throw new IllegalAction('现在不是掷骰阶段');
      }
      for (const i of idx) this.dice[i] = this.source.roll(D.FACE_TYPE[this.dice[i]]);
      this.phase = RESOLVE;
      this.resolved = false;
    }

    _build(die, slot) {
      if (this.phase !== RESOLVE) throw new IllegalAction('现在不是结算阶段');
      if (!Number.isInteger(die) || die < 0 || die >= this.dice.length) throw new IllegalAction('骰子下标越界');
      const board = this.buildings[this.current];
      if (!Number.isInteger(slot) || slot < 0 || slot > board.length) throw new IllegalAction('建筑槽位越界');
      const face = this.dice[die];
      const prev = slot === board.length ? null : board[slot];
      const nv = D.buildValue(prev, face);
      if (nv === null) throw new IllegalAction(D.describeFace(face) + ' 不能放在该位置');
      if (slot === board.length) board.push(nv); else board[slot] = nv;
      if (nv >= 18 && D.height(nv) === 6 && !this.nineRounds) this.finalRound = true;
      this.dice.splice(die, 1);
      this.resolved = true;
    }

    _abandon(dice) {
      if (this.phase !== RESOLVE) throw new IllegalAction('现在不是结算阶段');
      if (!Array.isArray(dice) || !dice.length) throw new IllegalAction('至少要弃置一颗骰子');
      const idx = Array.from(new Set(dice)).sort((a, b) => a - b);
      if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= this.dice.length)) throw new IllegalAction('骰子下标越界');
      for (const i of idx) this.abandoned.push(this.dice[i]);
      for (let k = idx.length - 1; k >= 0; k -= 1) this.dice.splice(idx[k], 1);
      this.resolved = true;
    }

    _demolish(die, slot) {
      if (this.phase !== RESOLVE) throw new IllegalAction('现在不是结算阶段');
      if (!Number.isInteger(die) || die < 0 || die >= this.dice.length) throw new IllegalAction('骰子下标越界');
      const board = this.buildings[this.current];
      if (!Number.isInteger(slot) || slot < 0 || slot >= board.length) throw new IllegalAction('建筑槽位越界');
      board.splice(slot, 1);
      this.dice.splice(die, 1);
      this.resolved = true;
    }

    _finishTurn() {
      if (this.phase !== RESOLVE) throw new IllegalAction('现在不是结算阶段');
      if (!this.resolved) throw new IllegalAction('这一掷还没有用掉任何骰子，不能结束回合');
      this.dice = [];
      this.resolved = false;
      if (this.current === this.lastSeat()) {
        if (this.round >= D.MAX_ROUNDS || (this.finalRound && !this.nineRounds)) {
          this.ended = true;
          this.current = this.start;
          this._finalizeBoards();
          return;
        }
        this.round += 1;
        this.current = this.start;
      } else {
        this.current = (this.current + 1) % this.numPlayers;
      }
      this.phase = CHOOSE;
    }

    _finalizeBoards() {
      // 终局清算：未完成的 A 折成 1 层楼块，其余未完成建筑丢弃
      for (const board of this.buildings) {
        const kept = [];
        for (const v of board) {
          if (v >= 18) kept.push(v);
          else if (D.COLUMNS[v] === 'A') kept.push(D.TILE_BASE[1]);
        }
        board.length = 0;
        board.push(...kept);
      }
    }

    // ------------------------------------------------------------ 序列化
    toDict() {
      return {
        num_players: this.numPlayers,
        names: this.names.slice(),
        nine_rounds: this.nineRounds,
        start: this.start,
        round: this.round,
        current: this.current,
        phase: this.phase,
        dice: this.dice.slice(),
        abandoned: this.abandoned.slice(),
        resolved: this.resolved,
        final_round: this.finalRound,
        ended: this.ended,
        buildings: this.buildings.map((b) => b.slice()),
      };
    }

    clone() {
      const g = Object.create(Game.prototype);
      Object.assign(g, this);
      g.names = this.names.slice();
      g.dice = this.dice.slice();
      g.abandoned = this.abandoned.slice();
      g.buildings = this.buildings.map((b) => b.slice());
      g.source = this.source; // 骰子源按引用共享（克隆只用于推演，不回放）
      return g;
    }

    /** 从 `toDict()` 的纯数据快照重建（AI 在 Worker 里用，不需要骰子源）。 */
    static fromDict(d) {
      const g = Object.create(Game.prototype);
      g.numPlayers = d.num_players;
      g.names = d.names.slice();
      g.nineRounds = !!d.nine_rounds;
      g.start = d.start;
      g.round = d.round;
      g.current = d.current;
      g.phase = d.phase;
      g.dice = d.dice.slice();
      g.abandoned = d.abandoned.slice();
      g.resolved = !!d.resolved;
      g.finalRound = !!d.final_round;
      g.ended = !!d.ended;
      g.buildings = d.buildings.map((b) => b.slice());
      g.seed = d.seed === undefined ? null : d.seed;
      g.source = null;
      return g;
    }
  }

  /** 规范化状态串：golden 对拍用（必须与 tools/export_golden.py 的 state_key 完全一致）。 */
  function stateKey(g) {
    return [
      String(g.round),
      String(g.current),
      String(g.phase),
      g.dice.join(','),
      g.abandoned.join(','),
      '' + (g.resolved ? 1 : 0) + (g.finalRound ? 1 : 0) + (g.ended ? 1 : 0),
      g.buildings.map((b) => b.join(',')).join(';'),
    ].join('|');
  }

  const api = { Game, IllegalAction, CHOOSE, ROLL, RESOLVE, PHASE_NAMES, MAX_SUBSET_DICE, stateKey };
  global.SkyEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
