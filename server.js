require('dotenv').config();
const express = require('express');
const path = require('path');
const { GameEngine } = require('./src/game-engine');
const { CharacterManager } = require('./src/character-manager');
const { MemoryManager } = require('./src/memory-manager');
const { LLM } = require('./src/llm');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 全局实例
const llm = new LLM();
const memoryManager = new MemoryManager(path.join(__dirname, 'data', 'memory'));
const characterManager = new CharacterManager(path.join(__dirname, 'config', 'characters'));
const gameEngine = new GameEngine({
  llm,
  memoryManager,
  characterManager,
  stagesPath: path.join(__dirname, 'config', 'stages.json'),
  storyPath: path.join(__dirname, 'config', 'story.md'),
});

// ========== API ==========

// 开始新游戏
app.post('/api/game/start', async (req, res) => {
  try {
    const state = await gameEngine.startNewGame();
    res.json({ ok: true, state });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 获取当前状态
app.get('/api/game/state', (req, res) => {
  const state = gameEngine.getState();
  if (!state) return res.status(400).json({ ok: false, error: '游戏未开始' });
  res.json({ ok: true, state });
});

// 和角色对话
app.post('/api/game/talk', async (req, res) => {
  try {
    const { characterId, message } = req.body;
    if (!characterId || !message) {
      return res.status(400).json({ ok: false, error: '缺少 characterId 或 message' });
    }
    const result = await gameEngine.talkToCharacter(characterId, message);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 提交推理
app.post('/api/game/submit-theory', async (req, res) => {
  try {
    const { theory } = req.body;
    if (!theory) {
      return res.status(400).json({ ok: false, error: '缺少 theory' });
    }
    const result = await gameEngine.submitTheory(theory);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 推进到下一阶段
app.post('/api/game/advance', async (req, res) => {
  try {
    const result = await gameEngine.advanceStage();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 获取对话历史
app.get('/api/game/history/:characterId', (req, res) => {
  const history = gameEngine.getConversationHistory(req.params.characterId);
  res.json({ ok: true, history });
});

// 获取当前线索
app.get('/api/game/clues', (req, res) => {
  const state = gameEngine.getState();
  if (!state) return res.status(400).json({ ok: false, error: '游戏未开始' });
  res.json({ ok: true, clues: state.clues });
});

// 助手AI对话
app.post('/api/game/assistant', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ ok: false, error: '缺少 message' });
    }
    const result = await gameEngine.talkToAssistant(message);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏮 《零点灯室》游戏服务器已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   模型: ${process.env.OPENAI_MODEL || 'gpt-4o'}\n`);
});
