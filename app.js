/* 应用层：模式、回合流转、动作分发、界面刷新。
 * M1 = 热座 2–4 人；M2/M3 会在这里接 AI（seats 里的 type 字段已预留）。
 */
(function (global) {
  'use strict';
  const D = SkyData;
  const A = SkyArt;
  const B = SkyBoard;
  const E = SkyEngine;

  const MAX_ROUNDS = D.MAX_ROUNDS;
  const SETTINGS_KEY = 'skyline.settings.v1';

  function loadSettings() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function saveSettings(obj) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
    } catch (err) { /* 隐私模式/配额不足就忽略 */ }
  }

  const App = {
    game: null,
    seats: [],           // { type: 'human' | 'ai', level: number, name: string }
    selection: new Set(),
    mode: null,          // null | 'demolish'
    logLines: [],
    handoff: true,
    started: false,

    // ------------------------------------------------------------ 生命周期
    init() {
      this.dom = {
        round: document.getElementById('round'),
        turn: document.getElementById('turn'),
        phase: document.getElementById('phase-badge'),
        players: document.getElementById('players'),
        dice: document.getElementById('dice'),
        district: document.getElementById('district'),
        log: document.getElementById('log'),
        actions: document.getElementById('actions'),
        modal: document.getElementById('modal-root'),
      };
      document.getElementById('btn-new').addEventListener('click', () => this.showSetup());
      this.settings = loadSettings() || {};
      this.dom.demo = document.getElementById('demo-controls');
      this.dom.bar = document.getElementById('actionbar');
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', () => this.syncBarHeight());
      }

      // 调试/截图用：?auto=2&start=0 直接开一局
      const params = (typeof location !== 'undefined' && location.search) ? new URLSearchParams(location.search) : null;
      const auto = params && params.get('auto');
      if (auto) {
        const players = Math.max(2, Math.min(4, parseInt(auto, 10) || 2));
        const start = Math.max(0, Math.min(players - 1, parseInt(params.get('start') || '0', 10)));
        // ?seats=h,3 → 0 号人类、1 号「普通」AI；?seats=3,2 → 全 AI 演示
        const seatsParam = params.get('seats');
        let seats = null;
        if (seatsParam) {
          seats = seatsParam.split(',').map((t) => (t.trim() === 'h'
            ? { type: 'human', level: 0 }
            : { type: 'ai', level: Math.max(1, Math.min(6, parseInt(t, 10) || 3)) }));
          while (seats.length < players) seats.push({ type: 'ai', level: 3 });
        }
        this.start({ players, start, seats: seats || undefined,
          seed: params.get('seed') ? parseInt(params.get('seed'), 10) : undefined });
        this.closeModal();
        // 截图/调试用：?sim=40 先走 40 步（优先建造，画面更像真实对局）
        const sim = parseInt(params.get('sim') || '0', 10);
        this.handoff = false;
        const allHuman = !seats || seats.every((s) => s.type === 'human');
        for (let i = 0; i < (allHuman ? sim : 0) && !this.game.ended; i += 1) {
          const acts = this.game.legalActions();
          if (!acts.length) break;
          const builds = acts.filter((x) => x.type === 'build');
          const rolls = acts.filter((x) => x.type === 'roll');
          let a;
          if (builds.length) {
            // 优先能把楼盖高的（截图看起来更像真实对局）
            const scored = builds.map((b) => {
              const board = this.game.buildings[this.game.current];
              const prev = b.slot === board.length ? null : board[b.slot];
              const after = D.buildValue(prev, this.game.dice[b.die]);
              if (after === null) return { b, s: -1 };
              const floors = after >= 18 ? D.height(after) : D.COLUMNS[after].length;
              return { b, s: (after >= 18 ? 1000 + D.score(after) : floors * 2) };
            });
            scored.sort((x, y) => y.s - x.s);
            a = scored[0].b;
          } else if (rolls.length) {
            a = rolls[0];
          } else {
            a = acts[0];
          }
          if (a.type === 'build') { this.selection = new Set([a.die]); this.onTowerClick(a.slot); }
          else if (a.type === 'abandon') { this.selection = new Set(a.dice); this.onAbandon(); }
          else if (a.type === 'demolish') { this.selection = new Set([a.die]); this.mode = 'demolish'; this.onTowerClick(a.slot); }
          else if (a.type === 'roll') { if (this.game.phase === E.ROLL) this.onFirstRoll(); else { this.selection = new Set(a.dice); this.onReroll(); } }
          else if (a.type === 'take_dice') {
            const balanced = acts.find((x) => x.type === 'take_dice'
              && x.types[0] === 0 && x.types[1] === 1 && x.types[2] === 2);
            this.onTake((balanced || a).types);
          }
          else if (a.type === 'take_abandoned') this.onTakeAbandoned();
          else if (a.type === 'finish_turn') this.onFinishTurn();
        }
        if (!this.game.ended) this.closeModal();
        const sel = params.get('sel');
        if (sel !== null && this.game.dice.length) {
          this.selection = new Set([parseInt(sel, 10) || 0]);
          this.render();
        }
        if (params.get('mode') === 'demolish' && this.selection.size) {
          this.mode = 'demolish';
          this.render();
        }
        if (params.get('measure')) this.measure();
        return;
      }
      this.showSetup();
    },

    openPage(name) {
      if (typeof location !== 'undefined' && location.href) location.href = name;
    },

    showSetup() {
      const saved = this.settings || {};
      let players = Math.max(2, Math.min(4, saved.players || 2));
      let start = Math.max(0, Math.min(players - 1, saved.start || 0));
      const seatCfg = [
        { type: 'human', level: 3 },
        { type: 'ai', level: 3 },
        { type: 'ai', level: 2 },
        { type: 'ai', level: 2 },
      ];
      if (Array.isArray(saved.seats)) {
        saved.seats.slice(0, 4).forEach((s, i) => {
          if (s && (s.type === 'human' || s.type === 'ai')) {
            seatCfg[i] = { type: s.type, level: Math.max(1, Math.min(6, s.level || 3)) };
          }
        });
      }
      if (typeof saved.handoff === 'boolean') this.handoff = saved.handoff;
      if (saved.delay) this.aiDelay = saved.delay;
      const modal = A.el('div', 'modal');
      modal.appendChild(A.el('h2', '', '新对局'));
      modal.appendChild(A.el('p', '', '每个座位可以单独设为「人类」或「AI」；全人类 = 热座，全 AI = 双机演示。'));

      // 规则 / 声明放在主界面（设置界面）里：游戏中途不会因为点它们而丢局
      const rowInfo = A.el('div', 'row');
      rowInfo.appendChild(A.el('label', '', '说明'));
      const rulesBtn = A.el('button', '', '规则');
      rulesBtn.addEventListener('click', () => this.openPage('rules.html'));
      const aboutBtn = A.el('button', '', '声明');
      aboutBtn.addEventListener('click', () => this.openPage('about.html'));
      rowInfo.appendChild(rulesBtn);
      rowInfo.appendChild(aboutBtn);
      modal.appendChild(rowInfo);

      const rowPlayers = A.el('div', 'row');
      rowPlayers.appendChild(A.el('label', '', '人数'));
      const segPlayers = A.el('div', 'seg');
      [2, 3, 4].forEach((n) => {
        const b = A.el('button', n === players ? 'on' : '', String(n));
        b.addEventListener('click', () => {
          players = n;
          Array.from(segPlayers.children).forEach((c) => c.classList.remove('on'));
          b.classList.add('on');
          rebuildSeats();
          rebuildFirst();
        });
        segPlayers.appendChild(b);
      });
      rowPlayers.appendChild(segPlayers);
      modal.appendChild(rowPlayers);

      const rowFirst = A.el('div', 'row');
      rowFirst.appendChild(A.el('label', '', '先手'));
      const segFirst = A.el('div', 'seg');
      function rebuildFirst() {
        segFirst.innerHTML = '';
        start = 0;
        for (let i = 0; i < players; i += 1) {
          const b = A.el('button', i === 0 ? 'on' : '', '玩家 ' + (i + 1));
          b.addEventListener('click', () => {
            Array.from(segFirst.children).forEach((c) => c.classList.remove('on'));
            b.classList.add('on');
            start = i;
          });
          segFirst.appendChild(b);
        }
      }
      rowFirst.appendChild(segFirst);
      modal.appendChild(rowFirst);

      const seatBox = A.el('div', '');
      modal.appendChild(seatBox);
      function rebuildSeats() {
        seatBox.innerHTML = '';
        for (let i = 0; i < players; i += 1) {
          const row = A.el('div', 'row');
          row.appendChild(A.el('label', '', '玩家 ' + (i + 1)));
          const segType = A.el('div', 'seg');
          ['人类', 'AI'].forEach((label, k) => {
            const b = A.el('button', (seatCfg[i].type === 'human') === (k === 0) ? 'on' : '', label);
            b.addEventListener('click', () => {
              seatCfg[i].type = k === 0 ? 'human' : 'ai';
              Array.from(segType.children).forEach((c) => c.classList.remove('on'));
              b.classList.add('on');
              rebuildSeats();
            });
            segType.appendChild(b);
          });
          row.appendChild(segType);
          if (seatCfg[i].type === 'ai') {
            const sel = document.createElement('select');
            sel.style.cssText = 'padding:8px 10px;border-radius:10px;background:var(--panel-2);color:var(--text);border:1px solid var(--line)';
            SkyAI.LEVELS.forEach((lv) => {
              const opt = document.createElement('option');
              opt.value = String(lv.id);
              opt.textContent = lv.name + (lv.soon ? '（待开放）' : '');
              opt.disabled = !!lv.soon;
              if (lv.id === seatCfg[i].level) opt.selected = true;
              sel.appendChild(opt);
            });
            sel.addEventListener('change', () => { seatCfg[i].level = parseInt(sel.value, 10); });
            row.appendChild(sel);
          }
          seatBox.appendChild(row);
        }
      }

      const rowHandoff = A.el('div', 'row');
      rowHandoff.appendChild(A.el('label', '', '交接'));
      const handoffBtn = A.el('button', '', this.handoff ? '换人时提示' : '直接开始');
      handoffBtn.addEventListener('click', () => {
        this.handoff = !this.handoff;
        handoffBtn.textContent = this.handoff ? '换人时提示' : '直接开始';
      });
      rowHandoff.appendChild(handoffBtn);
      modal.appendChild(rowHandoff);

      const rowSeed = A.el('div', 'row');
      rowSeed.appendChild(A.el('label', '', '种子'));
      const seedInput = document.createElement('input');
      seedInput.className = 'text-input';
      seedInput.type = 'text';
      seedInput.inputMode = 'numeric';
      seedInput.placeholder = '留空 = 每局随机';
      seedInput.value = '';
      seedInput.title = '填同一个种子可以复现同一副骰子';
      rowSeed.appendChild(seedInput);
      const seedRandom = A.el('button', '', '随机');
      seedRandom.addEventListener('click', () => {
        seedInput.value = String(Math.floor(Math.random() * 1000000000));
      });
      rowSeed.appendChild(seedRandom);
      modal.appendChild(rowSeed);
      modal.appendChild(A.el('p', '', '种子决定骰子序列：同一个种子 + 同样的操作 = 完全同一局。'));

      const rowStart = A.el('div', 'row');
      const go = A.el('button', 'primary', '开始游戏');
      go.addEventListener('click', () => {
        const raw = (seedInput.value || '').trim();
        let seed;
        if (raw) {
          const n = Number(raw);
          if (!Number.isFinite(n)) { seedInput.focus(); seedInput.title = '种子要是数字'; return; }
          seed = Math.abs(Math.trunc(n)) >>> 0;
        }
        this.start({ players, start, seats: seatCfg.slice(0, players), seed });
      });
      rowStart.appendChild(go);
      modal.appendChild(rowStart);

      // 万一是在对局中途打开设置：给一条"继续原来这局"的退路
      if (this.started && this.game && !this.game.ended) {
        const rowBack = A.el('div', 'row');
        const back = A.el('button', 'primary', '继续当前对局');
        back.addEventListener('click', () => this.closeModal());
        rowBack.appendChild(back);
        rowBack.appendChild(A.el('span', 'hint', '点「开始游戏」会放弃当前对局'));
        modal.appendChild(rowBack);
      }

      rebuildSeats();
      rebuildFirst();
      this.showModal(modal);
    },

    start(cfg) {
      const names = Array.from({ length: cfg.players }, (_, i) => '玩家 ' + (i + 1));
      const seed = (cfg.seed === undefined || cfg.seed === null)
        ? Math.floor(Math.random() * 0x7fffffff)
        : cfg.seed;
      this.game = new E.Game(cfg.players, { start: cfg.start || 0, names, seed });
      const seats = cfg.seats || names.map((name) => ({ type: 'human', level: 0 }));
      this.seats = seats.map((s, i) => ({ type: s.type || 'human', level: s.level || 3, name: names[i] }));
      this.selection.clear();
      this.mode = null;
      this.logLines = [];
      this.started = true;
      this.thinking = false;
      this.paused = false;
      // 每个座位固定一个策略种子：同一局里策略实例的状态（如"本回合是否已重掷"）才不会丢
      this.seatSeeds = this.seats.map((_, i) => (this.game.seed + 7919 * (i + 1)) % 1000000);
      this.aiDelay = this.aiDelay || 320;
      this._prev = null;
      this.closeModal();
      saveSettings({
        players: cfg.players,
        start: this.game.start,
        seats: this.seats.map((s) => ({ type: s.type, level: s.level })),
        handoff: this.handoff,
        delay: this.aiDelay,
      });
      this.log('对局开始：' + cfg.players + ' 人，' + names[this.game.start] + ' 先手（seed ' + this.game.seed + '）', true);
      this.log('开局赠楼：' + this.game.buildings
        .map((b, p) => names[p] + ' ' + (b.length ? D.describe(b[0]) : '无')).join('；'));
      this.log('座位：' + this.seats.map((s, i) => '玩家' + (i + 1) + (s.type === 'ai' ? '（AI ' + (SkyAI.LEVELS[s.level - 1] || {}).name + '）' : '（人类）')).join('、'));
      this.render();
      this.pump();
    },

    // ------------------------------------------------------------ 渲染
    render() {
      const g = this.game;
      if (!g) return;
      // 动画提示：骰子变了 / 有人涨分
      const diceKey = g.dice.join(',');
      const scores = g.buildings.map((b) => D.totalScore(b));
      const flash = { dice: false, players: new Set() };
      if (this._prev) {
        flash.dice = this._prev.dice !== diceKey;
        scores.forEach((s, i) => { if (s > this._prev.scores[i]) flash.players.add(i); });
      }
      this.flash = flash;
      this._prev = { dice: diceKey, scores };

      this.dom.round.textContent = String(Math.min(g.round, MAX_ROUNDS));
      this.dom.turn.textContent = g.ended ? '—' : g.names[g.current];
      this.dom.phase.textContent = g.ended ? '已结束'
        : (this.thinking ? 'AI 思考中…' : (E.PHASE_NAMES[g.phase] || ''));
      B.renderPlayers(this.dom.players, this);
      B.renderDice(this.dom.dice, this);
      B.renderDistrict(this.dom.district, this);
      B.renderLog(this.dom.log, this.logLines);
      this.renderActions();
      this.renderDemoControls();
    },

    /** 全 AI 演示时才出现的速度/暂停控件。 */
    renderDemoControls() {
      const root = this.dom && this.dom.demo;
      if (!root) return;
      root.innerHTML = '';
      const allAI = this.seats.length && this.seats.every((s) => s.type === 'ai');
      if (!allAI || !this.started) return;
      [['慢', 600], ['中', 320], ['快', 120]].forEach(([label, delay]) => {
        const b = A.el('button', this.aiDelay === delay ? 'on' : '', label);
        b.addEventListener('click', () => {
          this.aiDelay = delay;
          saveSettings(Object.assign({}, this.settings, { delay }));
          this.renderDemoControls();
        });
        root.appendChild(b);
      });
      const pause = A.el('button', this.paused ? 'on' : '', this.paused ? '继续' : '暂停');
      pause.addEventListener('click', () => {
        this.paused = !this.paused;
        if (!this.paused) this.pump();
        this.render();
      });
      root.appendChild(pause);
    },

    /** 当前座位是不是人类（AI 回合里禁止人类操作）。 */
    canAct() {
      const g = this.game;
      if (!g || g.ended) return false;
      const seat = this.seats[g.current];
      return !seat || seat.type === 'human';
    },

    /** 一步走完后：结束就结算，否则轮到谁就让谁动。 */
    pump() {
      const g = this.game;
      if (!g) return;
      if (g.ended) { this.showResults(); return; }
      if (this.paused) { this.render(); return; }
      const seat = this.seats[g.current];
      if (seat && seat.type === 'ai') this.scheduleAI();
      else this.maybeHandoff();
    },

    scheduleAI() {
      const g = this.game;
      if (!g || g.ended || this.aiTimer) return;
      if (this.paused) { this.thinking = false; this.render(); return; }
      this.thinking = true;
      this.render();
      this.aiTimer = setTimeout(async () => {
        this.aiTimer = null;
        const game = this.game;
        if (!game || game.ended) { this.thinking = false; return; }
        const seat = this.seats[game.current];
        if (!seat || seat.type !== 'ai') { this.thinking = false; this.render(); return; }
        let action = null;
        try {
          action = await SkyAI.decide(game, seat.level, this.seatSeeds[game.current]);
        } catch (err) {
          action = null;
        }
        this.thinking = false;
        if (!this.game || this.game.ended) return;
        if (!action) {
          const acts = this.game.legalActions();
          action = acts[0] || null;
        }
        if (!action) { this.render(); return; }
        const full = this.matchAction(this.game, action);
        this.act(full, full.desc ? 'AI：' + full.desc : 'AI 行动');
      }, this.aiDelay);
    },

    /** 把（可能来自 Worker 的）瘦动作匹配回本地 legalActions，拿到中文 desc。 */
    matchAction(game, action) {
      const key = (a) => [a.type,
        (a.types || []).join(','),
        (a.dice || []).join(','),
        a.die === undefined ? '' : a.die,
        a.slot === undefined ? '' : a.slot].join('|');
      const want = key(action);
      return game.legalActions().find((a) => key(a) === want) || action;
    },

    renderActions() {
      const g = this.game;
      const root = this.dom.actions;
      if (!g || g.ended) { root.innerHTML = ''; this.syncBarHeight(); return; }
      if (!this.canAct()) {
        root.innerHTML = '';
        root.appendChild(A.el('span', 'hint', this.paused ? '已暂停（点上方「继续」）'
          : (this.thinking ? 'AI 思考中…' : '等待 AI…')));
        this.syncBarHeight();
        return;
      }
      if (g.phase === E.CHOOSE) B.renderTakeBar(root, this);
      else B.renderResolveBar(root, this);
      this.syncBarHeight();
    },

    /** 底部动作栏是 fixed 的：按钮变多时它会长高，这里按实测高度给页面留出空间，避免遮住楼塔。 */
    syncBarHeight() {
      if (typeof document === 'undefined' || !this.dom || !this.dom.bar) return;
      const bar = this.dom.bar;
      const h = bar.offsetHeight || bar.clientHeight || 0;
      if (h) {
        const total = h + 40;
        document.body.style.paddingBottom = total + 'px';
        document.documentElement.style.setProperty('--barh', total + 'px');
      }
    },

    /** 当前可点击的槽位：建造时是"能落点"，拆除时是"任意一栋楼"。 */
    buildTargets() {
      const g = this.game;
      const out = new Set();
      if (!g || g.ended || g.phase !== E.RESOLVE || !this.selection.size) return out;
      const board = g.buildings[g.current];
      if (this.mode === 'demolish') {
        for (let i = 0; i < board.length; i += 1) out.add(i);
        return out;
      }
      const die = Math.min(...this.selection);
      const face = g.dice[die];
      if (D.columnForFace(face) !== null) out.add(board.length);
      board.forEach((v, slot) => {
        if (D.extendColumn(v, face) !== null) out.add(slot);
      });
      return out;
    },

    // ------------------------------------------------------------ 交互
    onDieClick(i) {
      const g = this.game;
      if (!g || g.ended || g.phase !== E.RESOLVE || !this.canAct()) return;
      if (this.selection.has(i)) this.selection.delete(i);
      else this.selection.add(i);
      this.mode = null;
      this.render();
    },

    onTowerClick(slot) {
      const g = this.game;
      if (!g || g.ended || g.phase !== E.RESOLVE || !this.canAct()) return;
      const die = Math.min(...this.selection);
      if (!Number.isFinite(die)) return;
      const face = g.dice[die];
      if (this.mode === 'demolish') {
        const target = g.buildings[g.current][slot];
        if (target === undefined) return;
        this.act({ type: 'demolish', die, slot }, '拆除 ' + D.describe(target));
        return;
      }
      const before = slot === g.buildings[g.current].length ? null : g.buildings[g.current][slot];
      const after = D.buildValue(before, face);
      if (after === null) return;
      this.act({ type: 'build', die, slot },
        '建造：' + D.describeFace(face) + ' → ' + D.describe(after));
    },

    setMode(mode) { this.mode = mode; this.render(); },

    onTake(types) {
      if (!this.canAct()) return;
      this.act({ type: 'take_dice', types }, '取骰：' + types.map((t) => D.TYPE_NAMES[t]).join('、'));
    },

    onTakeAbandoned() {
      if (!this.canAct()) return;
      const n = this.game.abandoned.length;
      this.act({ type: 'take_abandoned' }, '拿光废弃区（' + n + ' 颗，随后补满 A/E/H）');
    },

    onFirstRoll() {
      if (!this.canAct()) return;
      const g = this.game;
      const idx = g.dice.map((_, i) => i);
      this.act({ type: 'roll', dice: idx }, '掷骰：' + g.dice.join(' '));
    },

    onReroll() {
      if (!this.canAct()) return;
      const g = this.game;
      const idx = Array.from(this.selection).sort((a, b) => a - b);
      if (!idx.length) return;
      const faces = idx.map((i) => g.dice[i]).join(' ');
      this.act({ type: 'roll', dice: idx }, '重掷：' + faces);
    },

    onAbandon() {
      if (!this.canAct()) return;
      const g = this.game;
      const idx = Array.from(this.selection).sort((a, b) => a - b);
      if (!idx.length) return;
      const faces = idx.map((i) => g.dice[i]).join(' ');
      this.act({ type: 'abandon', dice: idx }, '弃置：' + faces + ' → 废弃区');
    },

    onFinishTurn() {
      if (!this.canAct()) return;
      const g = this.game;
      const left = g.dice.length;
      this.act({ type: 'finish_turn' },
        '结束回合' + (left ? '（' + left + ' 颗骰子退回工地）' : ''));
    },

    // ------------------------------------------------------------ 动作执行
    act(action, text) {
      const g = this.game;
      const actor = g.current;
      try {
        g.apply(action);
      } catch (err) {
        this.log('⚠ ' + err.message);
        this.render();
        return;
      }
      this.selection.clear();
      this.mode = null;
      if (text) this.log(g.names[actor] + '：' + text);
      if (g.ended) {
        this.render();
        this.showResults();
        return;
      }
      this.render();
      this.pump();
    },

    maybeHandoff() {
      const g = this.game;
      if (!this.handoff || !this.started || g.ended) return;
      if (this._handoffFor === g.current + ':' + g.round) return;
      const seat = this.seats[g.current];
      if (seat && seat.type !== 'human') return; // AI 回合不需要交接
      this._handoffFor = g.current + ':' + g.round;
      this.showHandoff();
    },

    showHandoff() {
      const g = this.game;
      const modal = A.el('div', 'modal handoff');
      modal.appendChild(A.el('div', 'big', '请把设备交给 ' + g.names[g.current]));
      modal.appendChild(A.el('p', '', '第 ' + Math.min(g.round, MAX_ROUNDS) + ' 轮 · ' + g.names[g.current] + ' 的回合'));
      const go = A.el('button', 'primary', '我是 ' + g.names[g.current] + '，开始');
      go.addEventListener('click', () => this.closeModal());
      modal.appendChild(go);
      this.showModal(modal, { dismissible: true });
    },

    // ------------------------------------------------------------ 结果
    showResults() {
      const g = this.game;
      const res = g.results();
      const modal = A.el('div', 'modal');
      modal.appendChild(A.el('h2', '', res.tie ? '平局！' : (g.names[res.winner] + ' 获胜！')));

      const table = A.el('table', 'score');      const thead = A.el('thead');
      const hr = A.el('tr');
      ['玩家', '总分', '完成栋数', '排名'].forEach((t) => hr.appendChild(A.el('th', '', t)));
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = A.el('tbody');
      res.ranking.forEach((r) => {
        const tr = A.el('tr', r.rank === 1 ? 'win' : '');
        tr.appendChild(A.el('td', '', r.name));
        tr.appendChild(A.el('td', '', String(r.score)));
        tr.appendChild(A.el('td', '', String(r.completed)));
        tr.appendChild(A.el('td', '', String(r.rank)));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      modal.appendChild(table);

      const detail = A.el('div', 'row');
      res.players.forEach((p) => {
        const line = A.el('div', '', p.name + '：' + p.buildings.join('、'));
        line.style.marginBottom = '6px';
        modal.appendChild(line);
      });

      const row = A.el('div', 'row');
      const again = A.el('button', 'primary', '再来一局');
      again.title = '同样的座位与难度，换一副新骰子';
      again.addEventListener('click', () => this.start({ players: g.numPlayers, start: g.start, seats: this.seats }));
      const fresh = A.el('button', '', '改设置');
      fresh.addEventListener('click', () => this.showSetup());
      row.appendChild(again);
      row.appendChild(fresh);
      modal.appendChild(row);
      modal.appendChild(A.el('p', '', '本局 seed ' + g.seed + '（同一 seed 的骰子完全一样，便于复现）'));
      this.showModal(modal, { dismissible: false });
    },

    // ------------------------------------------------------------ 弹层/日志
    showModal(node, opts) {
      const o = opts || {};
      const overlay = A.el('div', 'overlay');
      overlay.appendChild(node);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay && o.dismissible) this.closeModal();
      });
      this.dom.modal.innerHTML = '';
      this.dom.modal.appendChild(overlay);
    },

    closeModal() { this.dom.modal.innerHTML = ''; },

    /** 调试：?measure=1 时把"超出视口"的元素列出来（排查移动端横向溢出）。 */
    measure() {
      if (typeof document.querySelectorAll !== 'function' || typeof window === 'undefined') return;
      const rows = [];
      document.querySelectorAll('*').forEach((node) => {
        const r = node.getBoundingClientRect();
        if (r.right > window.innerWidth + 1) {
          rows.push([node.className || node.tagName, Math.round(r.width), Math.round(r.right)]);
        }
      });
      rows.sort((a, b) => b[2] - a[2]);
      const bar = document.getElementById('actionbar');
      const barH = bar ? (bar.offsetHeight || 0) : 0;
      const pad = parseFloat((document.body.style.paddingBottom || '0').replace('px', '')) || 0;
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:999;background:#000;color:#0f0;'
        + 'font:12px monospace;padding:6px;white-space:pre-wrap';
      box.textContent = '视口 ' + window.innerWidth + ' / 页面 ' + document.documentElement.scrollWidth
        + ' | 动作栏 ' + barH + 'px / 留白 ' + pad + 'px' + (pad >= barH ? ' ✓不遮挡' : ' ✗遮挡')
        + ' | mode=' + (this.mode || '-') + ' sel=' + this.selection.size
        + ' targets=' + this.buildTargets().size + '/楼' + (this.game ? this.game.buildings[this.game.current].length : 0)
        + '\n' + rows.slice(0, 6).map((r) => r.join('  ')).join('\n');
      document.body.appendChild(box);
    },

    log(text, hl) {      this.logLines.push({ text, hl: !!hl });
      if (this.logLines.length > 300) this.logLines.shift();
      if (this.dom && this.dom.log) B.renderLog(this.dom.log, this.logLines);
    },
  };

  global.SkyApp = App;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init());
    else App.init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
