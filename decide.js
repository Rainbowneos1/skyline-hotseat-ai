/* AI 门面：按难度选策略。优先用 Web Worker（不卡界面），file:// 下 Worker 被禁则自动退回主线程。
 * 难度：1 随机 / 2 贪心 / 3 启发式（4–6 在 M3 加求解器）。
 */
(function (global) {
  'use strict';
  const A = SkyAgents;

  const LEVELS = [
    { id: 1, key: 'random', name: '入门', note: '随机合法动作' },
    { id: 2, key: 'greedy', name: '简单', note: '每步取最大即时增量' },
    { id: 3, key: 'heuristic', name: '普通', note: '估值表 + 取骰打分 + 重掷' },
    { id: 4, key: 'solver', name: '困难', note: '回合内精确搜索' },
    { id: 5, key: 'linear', name: '专家', note: '求解器 + 线性估值' },
    { id: 6, key: 'master', name: '大师', note: '求解器 + 取骰搜索（冠军）' },
  ];

  let worker = null;
  let workerBroken = false;
  let seq = 0;
  const pending = {};
  const agentCache = new Map();

  /** 每个 (难度, seed) 只建一个实例：策略内部有"本回合是否已重掷"之类的状态，
   *  每次决策都新建会丢掉它（Python 版是每座位一个策略实例）。 */
  function makeAgent(level, seed) {
    const key = level + ':' + seed;
    if (!agentCache.has(key)) {
      let agent = null;
      if (level === 1) agent = new A.RandomAgent(seed);
      else if (level === 2) agent = new A.GreedyAgent(seed);
      else if (level === 3) agent = new A.HeuristicAgent(seed);
      else if (level >= 4 && level <= 6) agent = new A.SolverAgent(level, seed);
      agentCache.set(key, agent);
    }
    return agentCache.get(key);
  }

  function ensureWorker() {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      worker = new global.Worker('worker.js');
      worker.onmessage = (ev) => {
        const msg = ev.data || {};
        const cb = pending[msg.id];
        delete pending[msg.id];
        if (cb) cb(msg.action || null);
      };
      worker.onerror = () => { workerBroken = true; worker = null; };
    } catch (err) {
      workerBroken = true;
      worker = null;
    }
    return worker;
  }

  /** 同步决策（主线程）：golden 对拍与 Worker 兜底都用它。 */
  function decideSync(game, level, seed) {
    const agent = makeAgent(level, seed);
    if (!agent) throw new Error('难度 ' + level + ' 还没实现');
    return agent.choose(game);
  }

  /** 异步决策：能用 Worker 就走 Worker（把状态快照发过去算），否则退回主线程。 */
  function decide(game, level, seed) {
    return new Promise((resolve) => {
      const w = ensureWorker();
      if (!w || w.__failed) {
        resolve(decideSync(game, level, seed));
        return;
      }
      const id = (seq += 1);
      pending[id] = (action) => {
        if (action) resolve(action);
        else resolve(decideSync(game, level, seed));
      };
      try {
        w.postMessage({ id, state: game.toDict(), level, seed });
      } catch (err) {
        delete pending[id];
        resolve(decideSync(game, level, seed));
      }
    });
  }

  const api = { LEVELS, decide, decideSync, makeAgent, get workerBroken() { return workerBroken; } };
  global.SkyAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
