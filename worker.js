/* AI Worker：收到纯数据状态快照 → 重建局面 → 算一步 → 回传动作。
 * 注意：file:// 下浏览器通常禁止 Worker，主线程会自动兜底（js/ai/decide.js）。
 */
'use strict';

importScripts('data.js', 'rng.js', 'engine.js', 'agents.js',
  'weights.js', 'value_linear.js', 'solver.js');

const E = self.SkyEngine;
const A = self.SkyAgents;

const agents = new Map();

function agentFor(level, seed) {
  const key = level + ':' + seed;
  if (!agents.has(key)) {
    if (level === 1) agents.set(key, new A.RandomAgent(seed));
    else if (level === 2) agents.set(key, new A.GreedyAgent(seed));
    else if (level === 3) agents.set(key, new A.HeuristicAgent(seed));
    else if (level >= 4 && level <= 6) agents.set(key, new A.SolverAgent(level, seed));
    else agents.set(key, null);
  }
  return agents.get(key);
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  const game = E.Game.fromDict(msg.state);
  const agent = agentFor(msg.level, msg.seed);
  if (!agent) {
    self.postMessage({ id: msg.id, action: null });
    return;
  }
  let action = null;
  try {
    action = agent.choose(game);
  } catch (err) {
    action = null;
  }
  // 只回传语义字段（desc 由主线程从本地 legalActions 里取，避免两端口径不同）
  const slim = action ? { type: action.type, types: action.types, dice: action.dice, die: action.die, slot: action.slot } : null;
  self.postMessage({ id: msg.id, action: slim });
};
