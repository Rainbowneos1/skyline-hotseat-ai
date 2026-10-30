/* 渲染层：玩家面板、骰子、废弃区、日志、动作栏。只读状态 + 回调，不直接改游戏。 */
(function (global) {
  'use strict';
  const D = SkyData;
  const A = SkyArt;

  const COLOR_CLASS = { purple: 'purple', blue: 'blue', orange: 'orange' };

  /** 玩家面板：楼塔、分数、完成栋数。当前玩家 + 选中骰子时高亮可落点。 */
  function renderPlayers(root, app) {
    const g = app.game;
    root.dataset.count = String(g.numPlayers);
    root.innerHTML = '';
    const targets = app.buildTargets(); // Set<slot>；slot === 楼数 表示新建

    for (let p = 0; p < g.numPlayers; p += 1) {
      const panel = A.el('div', 'player' + (p === g.current && !g.ended ? ' active' : ''));
      const head = A.el('div', 'player-head');
      head.appendChild(A.el('span', 'player-name', g.names[p]));
      const bd = g.scoreBreakdown(p);
      head.appendChild(A.el('span', 'player-sub', bd.completed + ' 栋完成'));
      const scoreNode = A.el('span', 'player-score', bd.score + ' 分');
      if (app.flash && app.flash.players && app.flash.players.has(p)) scoreNode.classList.add('pop');
      head.appendChild(scoreNode);
      panel.appendChild(head);

      const sky = A.el('div', 'skyline');
      if (app.flash && app.flash.dice) sky.classList.add('flash');
      const board = g.buildings[p];
      if (!board.length && !(p === g.current && !g.ended)) {
        sky.appendChild(A.el('span', 'player-sub', '（空地）'));
      }

      // 显示顺序：未封顶的在左、已完成的楼块在右；"新建"位插在未完成组之后
      const entries = board.map((value, slot) => ({ value, slot }));
      entries.sort((a, b) => ((a.value >= 18 ? 1 : 0) - (b.value >= 18 ? 1 : 0)) || (a.slot - b.slot));

      const newSlot = A.el('div', 'tower');
      newSlot.style.minWidth = '84px';
      const slotNode = A.el('div', 'slot-empty');
      slotNode.style.width = '76px';
      newSlot.appendChild(slotNode);
      newSlot.appendChild(A.el('span', 'player-sub', '新建'));
      const showNew = p === g.current && !g.ended;
      if (showNew && targets.has(board.length)) {
        newSlot.classList.add('target');
        newSlot.title = '在这里新建一栋楼';
        newSlot.addEventListener('click', () => app.onTowerClick(board.length));
      }

      let placedNew = false;
      entries.forEach((entry) => {
        if (!placedNew && showNew && entry.value >= 18) {
          sky.appendChild(newSlot);
          placedNew = true;
        }
        const tower = A.towerNode(entry.value);
        if (p === g.current && targets.has(entry.slot)) {
          tower.classList.add('target');
          if (app.mode === 'demolish') {
            tower.classList.add('danger');
            tower.title = '拆除这栋楼（骰子会弃到废弃区）';
          } else {
            tower.title = '把选中的骰子放在这里';
          }
          tower.addEventListener('click', () => app.onTowerClick(entry.slot));
        }
        sky.appendChild(tower);
      });
      if (showNew && !placedNew) sky.appendChild(newSlot);
      panel.appendChild(sky);
      root.appendChild(panel);
    }
  }

  /** 手上的骰子：可点选（建造用第一颗，重掷/弃置用全部选中）。 */
  function renderDice(root, app) {
    const g = app.game;
    root.innerHTML = '';
    if (app.flash && app.flash.dice) root.classList.add('flash');
    else root.classList.remove('flash');
    if (!g.dice.length) {
      root.appendChild(A.el('span', 'hint', '（没有骰子）'));
      return;
    }
    g.dice.forEach((face, i) => {
      const node = A.dieNode(face);
      if (app.selection.has(i)) node.classList.add('selected');
      node.addEventListener('click', () => app.onDieClick(i));
      root.appendChild(node);
    });
  }

  function renderDistrict(root, app) {
    const g = app.game;
    root.innerHTML = '';
    if (!g.abandoned.length) {
      root.appendChild(A.el('span', 'hint', '（空）'));
      return;
    }
    g.abandoned.forEach((face) => root.appendChild(A.dieNode(face, { small: true })));
  }

  function renderLog(root, entries) {
    root.innerHTML = '';
    entries.forEach((line) => {
      const row = A.el('div', line.hl ? 'hl' : '', line.text);
      root.appendChild(row);
    });
    root.scrollTop = root.scrollHeight;
  }

  /** 取骰阶段：10 种类型组合 + 拿光废弃区。 */
  function renderTakeBar(root, app) {
    root.innerHTML = '';
    const grid = A.el('div', 'take-grid');
    const combos = [];
    for (let a = 0; a <= 2; a += 1) {
      for (let b = a; b <= 2; b += 1) {
        for (let c = b; c <= 2; c += 1) combos.push([a, b, c]);
      }
    }
    combos.forEach((types) => {
      const btn = A.el('button', 'take-btn');
      types.forEach((t) => btn.appendChild(A.typePip(t)));
      btn.appendChild(A.el('span', '', A.takeLabel(types)));
      btn.title = '取 3 颗：' + types.map((t) => D.TYPE_NAMES[t]).join('、');
      btn.addEventListener('click', () => app.onTake(types));
      grid.appendChild(btn);
    });
    root.appendChild(grid);

    const pile = A.el('button', 'primary');
    pile.textContent = '拿光废弃区（' + app.game.abandoned.length + ' 颗）';
    pile.addEventListener('click', () => app.onTakeAbandoned());
    root.appendChild(pile);
  }

  /** 结算/掷骰阶段的动作栏。 */
  function renderResolveBar(root, app) {
    root.innerHTML = '';
    const g = app.game;
    const hint = A.el('span', 'hint');
    const sel = app.selection.size;

    if (g.phase === 1) {
      hint.textContent = '骰子已到手，先全部掷一次。';
      const roll = A.el('button', 'primary', '掷骰子');
      roll.addEventListener('click', () => app.onFirstRoll());
      root.appendChild(hint);
      root.appendChild(roll);
      return;
    }

    if (app.mode === 'demolish') {
      hint.textContent = '点击要拆除的那栋楼。';
      const cancel = A.el('button', 'ghost', '取消');
      cancel.addEventListener('click', () => app.setMode(null));
      root.appendChild(hint);
      root.appendChild(cancel);
      return;
    }

    hint.textContent = sel
      ? '已选 ' + sel + ' 颗：点楼塔放置，或用下面的按钮。'
      : '点骰子选中，再点楼塔建造。';
    root.appendChild(hint);

    if (g.resolved && sel) {
      const reroll = A.el('button', '', '重掷所选（' + sel + '）');
      reroll.addEventListener('click', () => app.onReroll());
      root.appendChild(reroll);
    }
    if (sel) {
      const abandon = A.el('button', 'danger', '弃置所选（' + sel + '）');
      abandon.addEventListener('click', () => app.onAbandon());
      root.appendChild(abandon);

      const demolish = A.el('button', 'danger', '拆除…');
      demolish.addEventListener('click', () => app.setMode('demolish'));
      root.appendChild(demolish);
    }
    if (g.resolved) {
      const finish = A.el('button', 'primary', '结束回合');
      finish.title = '剩下的 ' + g.dice.length + ' 颗骰子退回工地';
      finish.addEventListener('click', () => app.onFinishTurn());
      root.appendChild(finish);
    }
  }

  const api = { renderPlayers, renderDice, renderDistrict, renderLog, renderTakeBar, renderResolveBar, COLOR_CLASS };
  global.SkyBoard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
