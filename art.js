/* 自绘美术：楼层段、楼塔、骰子、图标的 DOM 构造器。
 * 不使用任何外部图片——颜色、圆角、阴影都用 CSS 变量。
 */
(function (global) {
  'use strict';
  const D = SkyData;

  const COLOR_CLASS = { purple: 'purple', blue: 'blue', orange: 'orange' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** 一层楼：带颜色和字母的小块。width 由外层的塔宽决定。 */
  function floorNode(face, index) {
    const color = D.FACE_COLOR[face];
    const node = el('div', 'floor ' + (COLOR_CLASS[color] || 'gray'), face);
    node.dataset.face = face;
    // 越往上越窄，做出"塔"的收分
    node.style.width = Math.max(28, 76 - (index || 0) * 7) + 'px';
    return node;
  }

  /** 完成的楼块：显示分数。 */
  function tileNode(value) {
    const h = D.height(value);
    const node = el('div', 'tile', h * h + '分');
    node.style.width = Math.max(30, 76 - (h - 1) * 7) + 'px';
    node.title = h + ' 层楼，' + h * h + ' 分';
    return node;
  }

  /** 一栋楼：未完成时逐层画，已完成画楼块。楼层串自下而上，渲染时倒过来（底层在最下面）。 */
  function towerNode(value) {
    const wrap = el('div', 'tower');
    if (value >= 18) {
      wrap.appendChild(tileNode(value));
    } else {
      const code = D.COLUMNS[value];
      for (let i = code.length - 1; i >= 0; i -= 1) wrap.appendChild(floorNode(code[i], i));
    }
    return wrap;
  }

  /** "新建"占位：虚线空槽。 */
  function emptySlotNode() {
    return el('div', 'slot-empty');
  }

  /** 骰子：颜色 + 字母 + **类型标识**（t0 底座 / t1 中间层 / t2 顶层）。small 用于废弃区。 */
  function dieNode(face, opts) {
    const o = opts || {};
    const color = D.FACE_COLOR[face];
    const type = D.FACE_TYPE[face];
    const node = el('div', 'die t' + type + ' ' + (COLOR_CLASS[color] || 'gray') + (o.small ? ' small' : ''), face);
    node.dataset.face = face;
    node.dataset.type = String(type);
    node.title = D.describeFace(face) + ' · ' + D.TYPE_NAMES[type];
    return node;
  }

  /** 骰子类型的小圆点（取骰按钮里用）。 */
  function typePip(type) {
    const colors = ['#a78bfa', '#60a5fa', '#fb923c'];
    const node = el('span', 'pip');
    node.style.background = colors[type];
    return node;
  }

  /** 三颗类型的文字描述：地×2 上×1 */
  function takeLabel(types) {
    const names = ['地', '上', '顶'];
    const count = [0, 0, 0];
    types.forEach((t) => { count[t] += 1; });
    return count.map((c, i) => (c ? names[i] + '×' + c : '')).filter(Boolean).join(' ');
  }

  const api = { el, floorNode, tileNode, towerNode, emptySlotNode, dieNode, typePip, takeLabel, COLOR_CLASS };
  global.SkyArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
