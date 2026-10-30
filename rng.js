/* 骰子来源：正常用可播种 PRNG；回放用 forced 队列；评估可用 banked（公共随机数）。
 * 与 engine/skyline/engine.py 的 DiceSource / BankedDiceSource 对应。
 */
(function (global) {
  'use strict';

  const D = (typeof SkyData !== 'undefined') ? SkyData : require('./data.js');

  // mulberry32：32 位状态、够快、可播种
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class DiceSource {
    constructor(seed, forced) {
      this.kind = 'rng';
      this.rand = mulberry32((seed === null || seed === undefined) ? 0x5eed : (seed >>> 0));
      this.forced = forced ? forced.slice() : [];
      this.usedForced = 0;
    }

    roll(dieType) {
      if (this.forced.length) {
        const face = this.forced.shift();
        if (D.FACE_TYPE[face] !== dieType) {
          throw new Error('注入骰面 ' + face + ' 不属于类型 ' + dieType);
        }
        this.usedForced += 1;
        return face;
      }
      const faces = D.DICE_FACES[dieType];
      return faces[Math.floor(this.rand() * faces.length)];
    }

    state() {
      return { kind: this.kind, forced_left: this.forced.slice() };
    }
  }

  const MASK64 = (1n << 64n) - 1n;
  const C1 = 0x9E3779B97F4A7C15n;
  const C2 = 0xBF58476D1CE4E5B9n;
  const C3 = 0x94D049BB133111EBn;

  // splitmix 风格混淆：同一组输入永远得到同一个 64 位数（与 Python 版逐位一致）
  function mix64(parts) {
    let x = C1;
    for (const part of parts) {
      x = (x ^ ((BigInt(part) + C1) & MASK64)) & MASK64;
      x = (x * C2) & MASK64;
      x = (x ^ (x >> 30n)) & MASK64;
      x = (x * C3) & MASK64;
      x = (x ^ (x >> 27n)) & MASK64;
    }
    return x;
  }

  class BankedDiceSource extends DiceSource {
    constructor(bankSeed, index) {
      super(null);
      this.kind = 'banked';
      this.bankSeed = bankSeed | 0;
      this.index = index | 0;
      this.forced = [];
    }

    roll(dieType) {
      const draw = Number(mix64([this.bankSeed, this.index]) % 6n);
      this.index += 1;
      return D.DICE_FACES[dieType][draw];
    }

    state() {
      return { kind: 'banked', bank_seed: this.bankSeed, index: this.index };
    }
  }

  const api = { DiceSource, BankedDiceSource, mulberry32, mix64 };
  global.SkyRng = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
