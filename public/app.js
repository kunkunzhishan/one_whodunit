/**
 * 《零点灯室》前端逻辑 — 含线索/情绪/信任/助手
 */
(function () {
  'use strict';

  // ==================== DOM 引用 ====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const startScreen   = $('#start-screen');
  const gameScreen     = $('#game-screen');
  const endingScreen   = $('#ending-screen');
  const theoryModal    = $('#theory-modal');
  const loadingOverlay = $('#loading-overlay');

  const btnStart        = $('#btn-start');
  const btnAdvance      = $('#btn-advance');
  const btnTheory       = $('#btn-theory');
  const btnSend         = $('#btn-send');
  const btnBackNarr     = $('#btn-back-narrative');
  const btnSubmitTheory = $('#btn-submit-theory');
  const btnCancelTheory = $('#btn-cancel-theory');
  const btnRestart      = $('#btn-restart');
  const btnAssistant    = $('#btn-assistant');
  const btnBackAssist   = $('#btn-back-from-assistant');
  const btnSendAssist   = $('#btn-send-assistant');

  const stageBadge      = $('#stage-badge');
  const charListEl      = $('#character-list');
  const deadCharsEl     = $('#dead-characters');
  const narrativePanel  = $('#narrative-panel');
  const narrativeText   = $('#narrative-text');
  const puzzleBox       = $('#puzzle-box');
  const puzzleText      = $('#puzzle-text');
  const chatPanel       = $('#chat-panel');
  const chatCharName    = $('#chat-char-name');
  const chatMessages    = $('#chat-messages');
  const chatInput       = $('#chat-input');
  const theoryInput     = $('#theory-input');
  const theoryFeedback  = $('#theory-feedback');
  const endingTextEl    = $('#ending-text');
  const clueListEl      = $('#clue-list');
  const clueEmpty       = $('#clue-empty');
  const assistantPanel  = $('#assistant-panel');
  const assistantMsgs   = $('#assistant-messages');
  const assistantInput  = $('#assistant-input');
  const trustFill       = $('#chat-trust-fill');
  const trustLabel      = $('#chat-trust-label');

  // ==================== 状态 ====================
  let gameState = null;
  let currentCharId = null;
  let isSending = false;
  let currentPanel = 'narrative'; // 'narrative' | 'chat' | 'assistant'

  const charMeta = {
    luo_jiming:   { emoji: '🏨', role: '旅馆老板' },
    chen_qisheng: { emoji: '🚢', role: '船运商人' },
    wu_shoudeng:  { emoji: '🔦', role: '守灯人' },
    tang_ce:      { emoji: '📋', role: '前港务巡检' },
    cheng_boqian: { emoji: '💊', role: '医生' },
    ning_xue:     { emoji: '🌙', role: '旧识' },
  };

  // 情绪 → 颜色映射
  const emotionColors = {
    '平静': '#8e9aaf', '紧张': '#e67e73', '愤怒': '#e74c3c',
    '恐惧': '#9b59b6', '悲伤': '#3498db', '讽刺': '#e67e22',
    '冷漠': '#95a5a6', '警惕': '#f39c12', '慌张': '#e74c3c',
    '回忆': '#1abc9c', '犹豫': '#f1c40f', '防备': '#e67e22',
    '沉默': '#7f8c8d', '痛苦': '#c0392b', '伪装': '#2ecc71',
    '真诚': '#27ae60', '尴尬': '#d4a54a',
  };

  // ==================== API 调用 ====================
  async function api(path, opts = {}) {
    const res = await fetch('/api/game' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  // ==================== 画面切换 ====================
  function showScreen(screen) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  function showLoading(text) {
    loadingOverlay.style.display = 'flex';
    loadingOverlay.querySelector('.loading-text').textContent = text || '思考中…';
  }
  function hideLoading() { loadingOverlay.style.display = 'none'; }

  // ==================== 侧边栏标签页 ====================
  $$('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.sidebar-tab').forEach(t => t.classList.remove('active'));
      $$('.sidebar-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      const el = document.getElementById(target);
      if (el) el.classList.add('active');
    });
  });

  // ==================== 渲染游戏状态 ====================
  function renderState() {
    if (!gameState) return;
    const { stage, alive, talkable, dead, gameOver, clues } = gameState;

    stageBadge.textContent = stage.title;

    if (gameOver) {
      btnAdvance.style.display = 'none';
      btnTheory.style.display = 'none';
    } else {
      btnAdvance.style.display = '';
      btnTheory.style.display = '';
    }

    // 渲染角色列表 — 存活
    charListEl.innerHTML = '';
    const talkableMap = {};
    talkable.forEach(t => { talkableMap[t.id] = t; });

    alive.forEach(c => {
      const meta = charMeta[c.id] || { emoji: '👤', role: '' };
      const canTalk = !!talkableMap[c.id];
      const trust = talkableMap[c.id]?.trust ?? 50;
      const card = document.createElement('div');
      card.className = 'char-card' + (c.id === currentCharId ? ' active' : '');
      if (!canTalk) card.classList.add('disabled');

      let trustDot = '';
      if (canTalk) {
        const cls = trust < 30 ? 'trust-low' : trust < 65 ? 'trust-mid' : 'trust-high';
        trustDot = `<span class="char-trust-dot ${cls}" title="信任度 ${trust}"></span>`;
      }

      card.innerHTML = `
        <div class="char-avatar alive">${meta.emoji}</div>
        <div class="char-info">
          <div class="char-name">${c.name}</div>
          <div class="char-role">${meta.role}</div>
        </div>
        ${trustDot}`;
      card.addEventListener('click', () => { if (canTalk) openChat(c.id, c.name, trust); });
      charListEl.appendChild(card);
    });

    // 渲染死亡列表
    if (dead && dead.length > 0) {
      deadCharsEl.innerHTML = '';
      dead.forEach(d => {
        const meta = charMeta[d.id] || { emoji: '💀', role: '' };
        const card = document.createElement('div');
        card.className = 'char-card dead-card';
        card.title = d.deathDesc || '';
        card.innerHTML = `
          <div class="char-avatar dead">💀</div>
          <div class="char-info">
            <div class="char-name">${d.name}</div>
            <div class="char-role">${d.deathDesc || '已死亡'}</div>
          </div>`;
        deadCharsEl.appendChild(card);
      });
      deadCharsEl.parentElement.style.display = '';
    } else {
      deadCharsEl.parentElement.style.display = 'none';
    }

    // 渲染线索
    renderClues(clues || []);

    // 叙事
    narrativeText.textContent = stage.narrative;
    if (stage.puzzle) {
      puzzleBox.style.display = 'flex';
      puzzleText.textContent = stage.puzzle;
    } else {
      puzzleBox.style.display = 'none';
    }

    showNarrativePanel();
  }

  // ==================== 线索渲染 ====================
  function renderClues(clues) {
    clueListEl.innerHTML = '';
    if (!clues || clues.length === 0) {
      clueEmpty.style.display = '';
      return;
    }
    clueEmpty.style.display = 'none';
    clues.forEach(c => {
      const card = document.createElement('div');
      card.className = 'clue-card';
      card.innerHTML = `
        <div class="clue-name">📌 ${c.name}</div>
        <div class="clue-desc">${c.description}</div>
        <span class="clue-type clue-type-${c.type || '物证'}">${c.type || '线索'}</span>`;
      clueListEl.appendChild(card);
    });
  }

  // ==================== 面板切换 ====================
  function hideAllPanels() {
    narrativePanel.classList.remove('active');
    chatPanel.classList.remove('active');
    assistantPanel.classList.remove('active');
  }

  function showNarrativePanel() {
    hideAllPanels();
    narrativePanel.classList.add('active');
    currentPanel = 'narrative';
    currentCharId = null;
    $$('.char-card').forEach(c => c.classList.remove('active'));
  }

  function showChatPanel() {
    hideAllPanels();
    chatPanel.classList.add('active');
    currentPanel = 'chat';
  }

  function showAssistantPanel() {
    hideAllPanels();
    assistantPanel.classList.add('active');
    currentPanel = 'assistant';
    currentCharId = null;
    $$('.char-card').forEach(c => c.classList.remove('active'));
    assistantInput.focus();
  }

  // ==================== 信任度UI ====================
  function updateTrustUI(trust) {
    const t = Math.max(0, Math.min(100, trust || 50));
    trustFill.style.width = t + '%';
    trustLabel.textContent = '信任 ' + t;
  }

  // ==================== 对话 ====================
  function openChat(charId, charName, trust) {
    currentCharId = charId;
    chatCharName.textContent = charName;
    chatMessages.innerHTML = '';
    updateTrustUI(trust);

    $$('.char-card').forEach(c => c.classList.remove('active'));
    $$('.char-card').forEach(c => {
      if (c.querySelector('.char-name')?.textContent === charName) {
        c.classList.add('active');
      }
    });

    loadHistory(charId);
    showChatPanel();
    chatInput.focus();
  }

  async function loadHistory(charId) {
    try {
      const data = await api(`/history/${charId}`);
      if (data.history && data.history.length) {
        const meta = charMeta[charId] || {};
        data.history.forEach(msg => {
          if (msg.role === 'user') {
            appendMessage('user', msg.content);
          } else {
            const parsed = parseEmotionFromText(msg.content);
            appendMessage('npc', parsed.text, meta.emoji, parsed.emotion);
          }
        });
      } else {
        appendMessage('system', '对话开始。你可以向这个人提问。');
      }
    } catch {
      appendMessage('system', '对话开始。');
    }
  }

  /** 解析 [emotion:xxx] 标签 */
  function parseEmotionFromText(text) {
    const match = text.match(/\[emotion:([^\]]+)\]/);
    const emotion = match ? match[1] : null;
    const cleanText = text.replace(/\[emotion:[^\]]+\]\s*/g, '').trim();
    return { text: cleanText, emotion };
  }

  function appendMessage(type, text, emoji, emotion) {
    const div = document.createElement('div');

    if (type === 'user') {
      div.className = 'msg msg-user';
      div.textContent = text;
    } else if (type === 'npc') {
      div.className = 'msg msg-npc';
      // 情绪标签
      if (emotion) {
        const tag = document.createElement('span');
        tag.className = 'emotion-tag';
        tag.dataset.emotion = emotion;
        const color = emotionColors[emotion] || 'var(--accent)';
        tag.style.background = color + '20';
        tag.style.color = color;
        tag.textContent = emotion;
        div.appendChild(tag);
      }
      const sender = document.createElement('div');
      sender.className = 'msg-sender';
      sender.textContent = (emoji || '💬') + ' ' + (chatCharName.textContent || '');
      div.appendChild(sender);
      const body = document.createElement('div');
      body.textContent = text;
      div.appendChild(body);
    } else if (type === 'assistant') {
      div.className = 'msg msg-assistant';
      const sender = document.createElement('div');
      sender.className = 'msg-sender';
      sender.textContent = '🤖 侦探助手';
      div.appendChild(sender);
      const body = document.createElement('div');
      body.textContent = text;
      div.appendChild(body);
    } else {
      div.className = 'msg msg-system';
      div.textContent = text;
    }

    const container = currentPanel === 'assistant' ? assistantMsgs : chatMessages;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function sendMessage() {
    if (isSending || !currentCharId) return;
    const text = chatInput.value.trim();
    if (!text) return;

    isSending = true;
    chatInput.value = '';
    btnSend.disabled = true;

    appendMessage('user', text);

    const typing = document.createElement('div');
    typing.className = 'msg msg-system';
    typing.id = 'typing-indicator';
    typing.textContent = '对方正在思考…';
    chatMessages.appendChild(typing);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const data = await api('/talk', {
        method: 'POST',
        body: { characterId: currentCharId, message: text },
      });
      const ti = $('#typing-indicator');
      if (ti) ti.remove();

      const meta = charMeta[currentCharId] || {};
      appendMessage('npc', data.reply, meta.emoji, data.emotion);

      // 更新信任度UI
      if (data.trust !== undefined) {
        updateTrustUI(data.trust);
      }
    } catch (e) {
      const ti = $('#typing-indicator');
      if (ti) ti.remove();
      appendMessage('system', '⚠ 对话出错：' + e.message);
    } finally {
      isSending = false;
      btnSend.disabled = false;
      chatInput.focus();
    }
  }

  // ==================== 助手AI ====================
  async function sendAssistantMessage() {
    if (isSending) return;
    const text = assistantInput.value.trim();
    if (!text) return;

    isSending = true;
    assistantInput.value = '';
    btnSendAssist.disabled = true;

    // 追加用户消息
    const userDiv = document.createElement('div');
    userDiv.className = 'msg msg-user';
    userDiv.textContent = text;
    assistantMsgs.appendChild(userDiv);
    assistantMsgs.scrollTop = assistantMsgs.scrollHeight;

    const typing = document.createElement('div');
    typing.className = 'msg msg-system';
    typing.id = 'assist-typing';
    typing.textContent = '助手正在思考…';
    assistantMsgs.appendChild(typing);
    assistantMsgs.scrollTop = assistantMsgs.scrollHeight;

    try {
      const data = await api('/assistant', {
        method: 'POST',
        body: { message: text },
      });
      const ti = $('#assist-typing');
      if (ti) ti.remove();

      const div = document.createElement('div');
      div.className = 'msg msg-assistant';
      const sender = document.createElement('div');
      sender.className = 'msg-sender';
      sender.textContent = '🤖 侦探助手';
      div.appendChild(sender);
      const body = document.createElement('div');
      body.textContent = data.reply;
      div.appendChild(body);
      assistantMsgs.appendChild(div);
      assistantMsgs.scrollTop = assistantMsgs.scrollHeight;
    } catch (e) {
      const ti = $('#assist-typing');
      if (ti) ti.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'msg msg-system';
      errDiv.textContent = '⚠ 助手出错：' + e.message;
      assistantMsgs.appendChild(errDiv);
    } finally {
      isSending = false;
      btnSendAssist.disabled = false;
      assistantInput.focus();
    }
  }

  // ==================== 推理提交 ====================
  function openTheoryModal() {
    theoryModal.classList.add('active');
    theoryInput.value = '';
    theoryFeedback.style.display = 'none';
    theoryInput.focus();
  }
  function closeTheoryModal() {
    theoryModal.classList.remove('active');
  }

  async function submitTheory() {
    const theory = theoryInput.value.trim();
    if (!theory) return;

    btnSubmitTheory.disabled = true;
    showLoading('正在审阅你的推理…');

    try {
      const data = await api('/submit-theory', {
        method: 'POST',
        body: { theory },
      });

      hideLoading();

      theoryFeedback.style.display = 'block';
      if (data.correct) {
        theoryFeedback.className = 'success';
        theoryFeedback.textContent = '✅ ' + (data.feedback || '推理正确！');
        setTimeout(() => {
          closeTheoryModal();
          showEnding(data.endingText);
        }, 2000);
      } else {
        theoryFeedback.className = 'fail';
        theoryFeedback.textContent = '❌ ' + (data.feedback || '推理不够准确，继续调查吧。');
        btnSubmitTheory.disabled = false;
      }
    } catch (e) {
      hideLoading();
      theoryFeedback.style.display = 'block';
      theoryFeedback.className = 'fail';
      theoryFeedback.textContent = '⚠ 提交出错：' + e.message;
      btnSubmitTheory.disabled = false;
    }
  }

  // ==================== 推进阶段 ====================
  async function advanceStage() {
    if (!confirm('确定要推进剧情吗？\n这意味着你放弃在当前阶段破案，会有人死亡。')) return;

    showLoading('命运推进中…');
    try {
      const data = await api('/advance', { method: 'POST' });
      hideLoading();

      if (data.gameOver && data.ending === 'B') {
        showEnding(data.endingText);
      } else {
        gameState = data.state;
        currentCharId = null;
        renderState();
      }
    } catch (e) {
      hideLoading();
      alert('推进失败：' + e.message);
    }
  }

  // ==================== 结局 ====================
  function showEnding(text) {
    endingTextEl.textContent = text;
    showScreen(endingScreen);
  }

  // ==================== 开始游戏 ====================
  async function startGame() {
    showLoading('正在初始化游戏…');
    try {
      const data = await api('/start', { method: 'POST' });
      hideLoading();
      gameState = data.state;
      currentCharId = null;
      renderState();
      showScreen(gameScreen);
    } catch (e) {
      hideLoading();
      alert('启动失败：' + e.message);
    }
  }

  // ==================== 事件绑定 ====================
  btnStart.addEventListener('click', startGame);
  btnRestart.addEventListener('click', () => showScreen(startScreen));
  btnAdvance.addEventListener('click', advanceStage);
  btnTheory.addEventListener('click', openTheoryModal);
  btnCancelTheory.addEventListener('click', closeTheoryModal);
  btnSubmitTheory.addEventListener('click', submitTheory);
  btnBackNarr.addEventListener('click', showNarrativePanel);
  btnSend.addEventListener('click', sendMessage);
  btnAssistant.addEventListener('click', showAssistantPanel);
  btnBackAssist.addEventListener('click', showNarrativePanel);
  btnSendAssist.addEventListener('click', sendAssistantMessage);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  assistantInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAssistantMessage(); }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });
  assistantInput.addEventListener('input', () => {
    assistantInput.style.height = 'auto';
    assistantInput.style.height = Math.min(assistantInput.scrollHeight, 120) + 'px';
  });

  theoryModal.querySelector('.modal-overlay').addEventListener('click', closeTheoryModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && theoryModal.classList.contains('active')) closeTheoryModal();
  });

})();
