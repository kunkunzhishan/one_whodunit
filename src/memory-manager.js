const fs = require('fs');
const path = require('path');

/**
 * Agent 式记忆系统
 * 每个角色维护结构化记忆：事实、情绪状态、信任度、话题记录、玩家行为
 */
class MemoryManager {
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    this.memories = {};
  }

  _filePath(characterId) {
    return path.join(this.memoryDir, `${characterId}.json`);
  }

  /** 初始化角色记忆 */
  init(characterId, characterName) {
    this.memories[characterId] = {
      name: characterName,
      trust: 50,
      mood: '平静',
      playerTags: [],
      knownFacts: [],
      sensitiveTopicsHit: [],
      conversationSummaries: [],
      playerBehaviors: [],
      events: [],
    };
    this._save(characterId);
  }

  /** 读取结构化记忆 */
  read(characterId) {
    if (this.memories[characterId]) {
      return this.memories[characterId];
    }
    const fp = this._filePath(characterId);
    if (fs.existsSync(fp)) {
      try {
        this.memories[characterId] = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        return this.memories[characterId];
      } catch {
        return null;
      }
    }
    return null;
  }

  /** 生成给 system prompt 用的记忆文本 */
  toPromptText(characterId) {
    const mem = this.read(characterId);
    if (!mem) return '暂无记忆';

    const lines = [];

    const trustLevel = mem.trust >= 80 ? '非常信任侦探'
      : mem.trust >= 65 ? '对侦探有好感，愿意多说一些'
      : mem.trust >= 45 ? '对侦探态度中立'
      : mem.trust >= 25 ? '对侦探有戒心，不太想说话'
      : '对侦探极度警惕，几乎不愿开口';
    lines.push(`【信任度】${mem.trust}/100 — ${trustLevel}`);
    lines.push(`【当前情绪】${mem.mood}`);

    if (mem.playerTags.length > 0) {
      lines.push(`【对侦探的印象】${mem.playerTags.join('、')}`);
    }
    if (mem.sensitiveTopicsHit.length > 0) {
      lines.push(`【侦探已经问过的敏感话题】${mem.sensitiveTopicsHit.join('、')}`);
    }
    if (mem.conversationSummaries.length > 0) {
      lines.push(`【之前的对话要点】`);
      mem.conversationSummaries.slice(-6).forEach(s => lines.push(`  - ${s}`));
    }
    if (mem.events.length > 0) {
      lines.push(`【发生的事件】`);
      mem.events.slice(-5).forEach(e => lines.push(`  - ${e}`));
    }

    return lines.join('\n');
  }

  /** 更新信任度 */
  updateTrust(characterId, delta, reason) {
    const mem = this.read(characterId);
    if (!mem) return;
    mem.trust = Math.max(0, Math.min(100, mem.trust + delta));
    if (reason) mem.playerBehaviors.push(reason);
    this._save(characterId);
  }

  /** 更新情绪 */
  updateMood(characterId, mood) {
    const mem = this.read(characterId);
    if (!mem) return;
    mem.mood = mood;
    this._save(characterId);
  }

  /** 添加玩家印象标签 */
  addPlayerTag(characterId, tag) {
    const mem = this.read(characterId);
    if (!mem) return;
    if (!mem.playerTags.includes(tag)) {
      mem.playerTags.push(tag);
      if (mem.playerTags.length > 8) mem.playerTags.shift();
    }
    this._save(characterId);
  }

  /** 记录敏感话题被触碰 */
  addSensitiveTopic(characterId, topic) {
    const mem = this.read(characterId);
    if (!mem) return;
    if (!mem.sensitiveTopicsHit.includes(topic)) {
      mem.sensitiveTopicsHit.push(topic);
    }
    this._save(characterId);
  }

  /** 添加对话摘要 */
  addSummary(characterId, summary) {
    const mem = this.read(characterId);
    if (!mem) return;
    mem.conversationSummaries.push(summary);
    if (mem.conversationSummaries.length > 12) {
      mem.conversationSummaries = mem.conversationSummaries.slice(-12);
    }
    this._save(characterId);
  }

  /** 添加事件记忆 */
  addEvent(characterId, event) {
    const mem = this.read(characterId);
    if (!mem) return;
    mem.events.push(event);
    this._save(characterId);
  }

  /** 获取信任度 */
  getTrust(characterId) {
    const mem = this.read(characterId);
    return mem ? mem.trust : 50;
  }

  /** 重置所有记忆 */
  resetAll() {
    this.memories = {};
    if (fs.existsSync(this.memoryDir)) {
      const files = fs.readdirSync(this.memoryDir);
      for (const f of files) {
        fs.unlinkSync(path.join(this.memoryDir, f));
      }
    }
  }

  _save(characterId) {
    const mem = this.memories[characterId];
    if (!mem) return;
    const fp = this._filePath(characterId);
    fs.writeFileSync(fp, JSON.stringify(mem, null, 2), 'utf-8');
  }
}

module.exports = { MemoryManager };
