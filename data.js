/* Skyline 数据层：骰面、楼层串、楼块、计分。
 * 严格移植自 engine/skyline/data.py（Python 版已用 44 项测试 + 244 步回放验证过）。
 * 浏览器里挂到全局 SkyData；Node 里也可 require（用于 golden 对拍）。
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- 骰子
  const DICE_FACES = [
    ['A', 'A', 'A', 'B', 'B', 'C'], // 0 地面骰
    ['D', 'D', 'D', 'E', 'E', 'F'], // 1 上层骰
    ['X', 'X', 'X', 'G', 'G', 'H'], // 2 顶层骰
  ];
  const TYPE_NAMES = ['地面骰', '上层骰', '顶层骰'];
  const FACE_TYPE = {
    A: 0, B: 0, C: 0,
    D: 1, E: 1, F: 1,
    X: 2, G: 2, H: 2,
  };
  const FACE_COLOR = {
    A: 'purple', D: 'purple',
    B: 'blue', E: 'blue', G: 'blue',
    C: 'orange', F: 'orange', H: 'orange',
    X: null,
  };
  const FACE_NAMES = {
    A: '低层地面', B: '中层地面', C: '高层地面',
    D: '低层上层', E: '中层上层', F: '高层上层',
    G: '中层顶层', H: '高层顶层', X: '空白',
  };
  const ALL_FACES = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'G', 'H'];

  // ---------------------------------------------------------------- 建筑
  // 0 号是空串占位；1..17 是 17 种真实楼层串（自下而上）。
  const COLUMNS = [
    '',
    'A', 'AD',
    'B', 'BG', 'BE', 'BEG', 'BEE', 'BEEG',
    'C', 'CF', 'CFH', 'CFF', 'CFFH', 'CFFF', 'CFFFH', 'CFFFF', 'CFFFFH',
  ];
  const COLUMN_INDEX = {};
  COLUMNS.forEach((code, i) => { if (i) COLUMN_INDEX[code] = i; });

  // 完成的楼层串 -> 层数（完成即换成楼块）
  const COMPLETED = {
    AD: 2,
    BG: 2, BEG: 3, BEEG: 4,
    CFH: 3, CFFH: 4, CFFFH: 5, CFFFFH: 6,
  };

  // 楼块 id 段（只影响美术）：1 层 18-23，2 层 24-43，3 层 44-49，4 层 50-67，5 层 68-71，6 层 72
  const TILE_RANGES = { 1: [18, 23], 2: [24, 43], 3: [44, 49], 4: [50, 67], 5: [68, 71], 6: [72, 72] };
  const TILE_BASE = {};
  Object.keys(TILE_RANGES).forEach((h) => { TILE_BASE[h] = TILE_RANGES[h][0]; });

  const MAX_ROUNDS = 9;
  const DISTRICT_FILL = ['A', 'E', 'H'];
  const START_BUILDINGS = [9, 3, 1]; // 按回合顺序：起始 C、第二 B、第三 A、第四无

  // ---------------------------------------------------------------- 纯函数
  function height(value) {
    if (value < 18) return COLUMNS[value].length;
    if (value < 24) return 1;
    if (value < 44) return 2;
    if (value < 50) return 3;
    if (value < 68) return 4;
    if (value < 72) return 5;
    return 6;
  }

  function score(value) {
    if (value < 18) return COLUMNS[value] === 'A' ? 1 : 0;
    const h = height(value);
    return h * h;
  }

  function isCompleted(value) { return value >= 18; }
  function codeOf(value) { return value < 18 ? COLUMNS[value] : null; }
  function tileForHeight(h) { return TILE_BASE[h]; }

  function columnForFace(face) {
    if (FACE_TYPE[face] !== 0) return null;
    return COLUMN_INDEX[face];
  }

  function extendColumn(value, face) {
    if (value >= 18) return null;          // 已完成的楼不能再加
    const code = COLUMNS[value];
    if (!code) return null;                // 空串不能接
    if (FACE_TYPE[face] === 0) return null; // 地面层只能开新楼
    const newCode = code + face;
    if (!(newCode in COLUMN_INDEX)) return null;
    if (newCode in COMPLETED) return tileForHeight(COMPLETED[newCode]);
    return COLUMN_INDEX[newCode];
  }

  function canExtend(value, face) { return extendColumn(value, face) !== null; }

  function buildValue(value, face) {
    if (value === null || value === undefined) return columnForFace(face);
    return extendColumn(value, face);
  }

  function totalScore(buildings) {
    let s = 0;
    for (const b of buildings) s += score(b);
    return s;
  }

  function completedCount(buildings) {
    let s = 0;
    for (const b of buildings) if (b >= 18) s += 1;
    return s;
  }

  const COLOR_ZH = { purple: '紫', blue: '蓝', orange: '橙' };

  function describe(value) {
    if (value >= 18) return height(value) + '层楼(' + score(value) + '分)';
    const code = COLUMNS[value];
    const color = FACE_COLOR[code[0]];
    return (COLOR_ZH[color] || '') + code + '(未完成,' + code.length + '层)';
  }

  function describeFace(face) {
    return face + '(' + FACE_NAMES[face] + ')';
  }

  const api = {
    DICE_FACES, TYPE_NAMES, FACE_TYPE, FACE_COLOR, FACE_NAMES, ALL_FACES,
    COLUMNS, COLUMN_INDEX, COMPLETED, TILE_RANGES, TILE_BASE,
    MAX_ROUNDS, DISTRICT_FILL, START_BUILDINGS, COLOR_ZH,
    height, score, isCompleted, codeOf, tileForHeight, columnForFace,
    extendColumn, canExtend, buildValue, totalScore, completedCount,
    describe, describeFace,
  };

  global.SkyData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
