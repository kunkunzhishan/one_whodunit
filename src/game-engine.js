const fs = require('fs');

class GameEngine {
  constructor({ llm, memoryManager, characterManager, stagesPath, storyPath }) {
    this.llm = llm;
    this.mem = memoryManager;
    this.chars = characterManager;
    this.stages = JSON.parse(fs.readFileSync(stagesPath, 'utf-8'));
    this.story = fs.readFileSync(storyPath, 'utf-8');
    this.state = null;
  }

  /** 开始新游戏 */
  async startNewGame() {
    this.mem.resetAll();

    const charNames = {
      luo_jiming: '罗既明',
      chen_qisheng: '陈启升',
      wu_shoudeng: '吴守灯',
      tang_ce: '唐策',
      cheng_boqian: '程伯谦',
      ning_xue: '宁雪',
    };
    for (const [id, name] of Object.entries(charNames)) {
      this.mem.init(id, name);
    }

    this.state = {
      currentStageIndex: 0,
      conversationHistories: {},
      assistantHistory: [],
      deadCharacters: [],
      discoveredClues: [],
      theoriesSubmitted: [],
      gameOver: false,
      ending: null,
    };

    // 自动发现第0阶段的线索
    this._discoverStageClues(0);

    return this._buildPublicState();
  }

  /** 自动发现某阶段的所有线索 */
  _discoverStageClues(stageIndex) {
    const stage = this.stages.stages[stageIndex];
    if (!stage || !stage.clues) return;
    for (const clue of stage.clues) {
      if (!this.state.discoveredClues.find(c => c.id === clue.id)) {
        this.state.discoveredClues.push(clue);
      }
    }
  }

  getState() {
    if (!this.state) return null;
    return this._buildPublicState();
  }

  _buildPublicState() {
    const stage = this.stages.stages[this.state.currentStageIndex];
    return {
      stage: {
        id: stage.id,
        title: stage.title,
        narrative: stage.narrative,
        puzzle: stage.puzzle || null,
      },
      alive: stage.alive.map(id => ({
        id,
        name: this.chars.getCharacter(id)?.name || id,
      })),
      talkable: stage.talkable.map(id => ({
        id,
        name: this.chars.getCharacter(id)?.name || id,
        trust: this.mem.getTrust(id),
      })),
      dead: this.state.deadCharacters,
      clues: this.state.discoveredClues,
      gameOver: this.state.gameOver,
      ending: this.state.ending,
      canAdvance: !this.state.gameOver,
      stageIndex: this.state.currentStageIndex,
      totalStages: this.stages.stages.length,
    };
  }

  /** 和角色对话 */
  async talkToCharacter(characterId, message) {
    if (this.state.gameOver) {
      return { reply: '游戏已结束。' };
    }

    const stage = this.stages.stages[this.state.currentStageIndex];

    if (!stage.talkable.includes(characterId)) {
      return { reply: '这个人现在无法对话。' };
    }

    // 获取结构化记忆文本
    const memoryText = this.mem.toPromptText(characterId);
    const deadInfo = this.state.deadCharacters;
    const aliveNames = stage.alive.map(id => this.chars.getCharacter(id)?.name || id);

    // 构建系统提示（含线索信息）
    const systemPrompt = this.chars.buildSystemPrompt(
      characterId, stage, memoryText, aliveNames, deadInfo, this.state.discoveredClues
    );

    // 对话历史管理
    if (!this.state.conversationHistories[characterId]) {
      this.state.conversationHistories[characterId] = [];
    }
    const history = this.state.conversationHistories[characterId];
    history.push({ role: 'user', content: message });

    const recentHistory = history.slice(-20);

    // 调用 LLM
    const reply = await this.llm.chat(systemPrompt, recentHistory);

    // 解析情绪标签
    const emotionMatch = reply.match(/\[emotion:([^\]]+)\]/);
    const emotion = emotionMatch ? emotionMatch[1] : null;
    const cleanReply = reply.replace(/\[emotion:[^\]]+\]\s*/g, '').replace(/\*[^*]+\*/g, '').trim();

    // history 里存带情绪标签的原始回复，让下一轮 LLM 能看到情绪流变化
    // 记忆分析时会单独清理
    history.push({ role: 'assistant', content: reply });

    // 更新情绪到记忆
    if (emotion) {
      this.mem.updateMood(characterId, emotion);
    }

    // 每 2 条真实 user 消息做一次记忆分析（排除阶段过渡提示）
    const userMsgCount = history.filter(m => m.role === 'user' && !m.content.startsWith('（')).length;
    if (userMsgCount % 2 === 0 && userMsgCount >= 2) {
      const charName = this.chars.getCharacter(characterId)?.name || characterId;
      const currentTrust = this.mem.getTrust(characterId);
      const recentPairs = history.filter(m => !m.content.startsWith('（')).slice(-4);

      // 异步分析，不阻塞回复，但打印错误方便排查
      this.llm.analyzeConversation(charName, recentPairs, currentTrust).then(analysis => {
        console.log(`[记忆更新] ${charName}:`, JSON.stringify(analysis));
        if (analysis.trustDelta !== 0) {
          this.mem.updateTrust(characterId, analysis.trustDelta, `对话导致信任度${analysis.trustDelta > 0 ? '+' : ''}${analysis.trustDelta}`);
        }
        if (analysis.mood) {
          this.mem.updateMood(characterId, analysis.mood);
        }
        if (analysis.summary) {
          this.mem.addSummary(characterId, analysis.summary);
        }
        if (analysis.playerTag) {
          this.mem.addPlayerTag(characterId, analysis.playerTag);
        }
        if (analysis.sensitiveTopic) {
          this.mem.addSensitiveTopic(characterId, analysis.sensitiveTopic);
        }
      }).catch(err => {
        console.error(`[记忆更新失败] ${charName}:`, err.message);
      });
    }

    return {
      reply: cleanReply,
      emotion,
      characterName: this.chars.getCharacter(characterId)?.name,
      trust: this.mem.getTrust(characterId),
    };
  }

  /** 获取对话历史 */
  getConversationHistory(characterId) {
    return this.state?.conversationHistories?.[characterId] || [];
  }

  /** 助手AI对话 */
  async talkToAssistant(message) {
    if (!this.state) return { reply: '游戏未开始。' };

    this.state.assistantHistory.push({ role: 'user', content: message });

    const stage = this.stages.stages[this.state.currentStageIndex];
    const stageInfo = { title: stage.title, narrative: stage.narrative };
    const recentHistory = this.state.assistantHistory.slice(-16);

    const reply = await this.llm.assistantChat(
      recentHistory,
      this.state.discoveredClues,
      stageInfo,
      this.state.deadCharacters
    );

    this.state.assistantHistory.push({ role: 'assistant', content: reply });

    return { reply };
  }

  /** 提交推理 */
  async submitTheory(theory) {
    if (this.state.gameOver) {
      return { correct: false, feedback: '游戏已结束。' };
    }

    const currentStage = this.state.currentStageIndex;
    const result = await this.llm.judgeTheory(theory, this.story, currentStage);

    this.state.theoriesSubmitted.push({ stage: currentStage, theory, result });

    if (result.correct) {
      this.state.gameOver = true;
      this.state.ending = 'A';
      return {
        correct: true,
        score: result.score,
        feedback: result.feedback,
        ending: 'A',
        endingText: this._getEndingA(),
      };
    }

    return { correct: false, score: result.score, feedback: result.feedback };
  }

  /** 推进到下一阶段 */
  async advanceStage() {
    if (this.state.gameOver) {
      return { gameOver: true, ending: this.state.ending };
    }

    const nextIndex = this.state.currentStageIndex + 1;

    if (nextIndex >= this.stages.stages.length) {
      this.state.gameOver = true;
      this.state.ending = 'B';
      return {
        gameOver: true,
        ending: 'B',
        endingText: this._getEndingB(),
        state: this._buildPublicState(),
      };
    }

    const nextStage = this.stages.stages[nextIndex];

    // 记录死亡
    if (nextStage.death) {
      const deadChar = this.chars.getCharacter(nextStage.death);
      this.state.deadCharacters.push({
        id: nextStage.death,
        name: deadChar?.name || nextStage.death,
        deathDesc: nextStage.deathDescription || '死亡',
        stage: nextIndex,
      });
    }

    this.state.currentStageIndex = nextIndex;

    // 发现新阶段线索
    this._discoverStageClues(nextIndex);

    // 更新所有存活角色的记忆
    for (const charId of nextStage.alive) {
      this.mem.addEvent(charId, nextStage.deathEvent || '有人死了');
      // 死亡事件会影响情绪
      this.mem.updateMood(charId, '紧张');
    }

    // 换阶段时不清空对话历史，在历史里追加一条背景变化提示，让角色记得之前聊的
    for (const charId of nextStage.talkable) {
      if (!this.state.conversationHistories[charId]) {
        this.state.conversationHistories[charId] = [];
      }
      const charName = this.chars.getCharacter(charId)?.name || charId;
      const deathNote = nextStage.death
        ? `${this.chars.getCharacter(nextStage.death)?.name || nextStage.death}刚刚死了。`
        : '';
      this.state.conversationHistories[charId].push({
        role: 'user',
        content: `（时间推进，现在是${nextStage.title}。${deathNote}侦探重新找你说话。）`,
      });
      this.state.conversationHistories[charId].push({
        role: 'assistant',
        content: `（沉默）`,
      });
    }

    return {
      gameOver: false,
      state: this._buildPublicState(),
    };
  }

  _getEndingA() {
    return `
═══════════════════════════════════════
            结局 A：秩序的代价
═══════════════════════════════════════

你推理出了完整的真相。

"宁雪"被你当场揭穿——她不是宁雪，而是顾岚，顾湛的姐姐。
真正的宁雪早在上岛之前就已经溺死在旧栈桥下。

顾岚没有反抗。她只是看着你，平静地说：

"你很聪明。但你救下来的那个人，十五年前亲手杀了我弟弟。
法律说追诉期已过。
你觉得这叫正义吗？"

陈启升活了下来。
旧案因追诉期问题和关键证据灭失，很难再被追诉。

你阻止了复仇。
你也阻止了清算。

最优秀的侦探，守住了秩序，却未必守住了正义。

═══════════════════════════════════════`;
  }

  _getEndingB() {
    return `
═══════════════════════════════════════
            结局 B：迟到的正义
═══════════════════════════════════════

你没能阻止她。

所有人都死了。
风塔旅馆里只剩下你和"宁雪"。

她走到你面前，摘下围巾，露出脖颈上的旧伤。
然后她说：

"我叫顾岚。顾湛是我弟弟。"

她把一切都告诉了你。

十五年前的那个暴风夜。
灯室里的假影。提升井。北码头。
陈启升的铁钩。程伯谦的冷眼。
宁雪推他下海的那一刻。
唐策嘴里的假话。罗既明相机里的真相。
吴守灯为了几千块钱卖掉的逃生路线。

"法律说过期了。"
"所以我自己来。"

她说完，转身走向码头。
海风很大，灯塔还在转。

你站在原地，手里拿着她留下的全部证据。
你什么也没能做。
但那些该死的人，确实都死了。

不够强的侦探没能伸张法律，
却让一场迟到的正义完成了。

═══════════════════════════════════════`;
  }
}

module.exports = { GameEngine };
