/* 线性估值：V(盘面, T) = 已落袋分 + Σ W[T][楼层串] × 计数 + W[T][末位]。
 * 权重来自 tools/export_weights.py（训练脚本 training/learn/train_value.py）。
 */
(function (global) {
  'use strict';
  const D = SkyData;

  const N_COLS = 17;

  function builtinWeights() {
    if (global.SkyWeights) return global.SkyWeights;
    if (typeof require === 'function') {
      try { return require('./weights.js'); } catch (err) { /* 浏览器里没有 require */ }
    }
    throw new Error('缺少线性估值权重（web/js/agents/weights.js）');
  }

  class LinearValue {
    constructor(weights) {
      const src = weights || builtinWeights();
      this.W = src.W;
      this.codes = src.codes || null;
      this.countCache = new Map();
      this.bankedCache = new Map();
    }

    counts(board) {
      const key = board.join(',');
      let c = this.countCache.get(key);
      if (c) return c;
      c = new Array(N_COLS).fill(0);
      for (const v of board) {
        if (v < 18) c[v - 1] += 1; // 未完成楼的值 1..17 对应 feature 索引 0..16
      }
      if (this.countCache.size > 200000) this.countCache.clear();
      this.countCache.set(key, c);
      return c;
    }

    banked(board) {
      const key = board.join(',');
      let s = this.bankedCache.get(key);
      if (s !== undefined) return s;
      s = 0;
      for (const v of board) s += D.score(v);
      if (this.bankedCache.size > 200000) this.bankedCache.clear();
      this.bankedCache.set(key, s);
      return s;
    }

    future(board, turns) {
      const t = Math.max(0, Math.min(turns | 0, this.W.length - 1));
      const w = this.W[t];
      const c = this.counts(board);
      let total = w[w.length - 1];
      for (let i = 0; i < N_COLS; i += 1) if (c[i]) total += c[i] * w[i];
      return total;
    }

    value(board, turns) {
      return this.banked(board) + this.future(board, turns);
    }
  }

  const api = { LinearValue };
  global.SkyValue = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
