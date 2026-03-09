const fs = require('fs');
const path = require('path');

class CharacterManager {
  constructor(configDir) {
    this.configDir = configDir;
    this.characters = {};
    this._loadAll();
  }

  _loadAll() {
    const files = fs.readdirSync(this.configDir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const id = f.replace('.md', '');
      const content = fs.readFileSync(path.join(this.configDir, f), 'utf-8');
      this.characters[id] = {
        id,
        content,
        name: this._extractName(content),
      };
    }
  }

  _extractName(content) {
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1] : '未知';
  }

  getCharacter(id) {
    return this.characters[id] || null;
  }

  getAllIds() {
    return Object.keys(this.characters);
  }

  /** 为角色生成当前阶段的系统提示词 — 完整重写版 */
  buildSystemPrompt(characterId, stage, memoryText, aliveList, deadInfo, clues) {
    const char = this.characters[characterId];
    if (!char) return null;

    const deadNames = deadInfo.map(d => `${d.name}（${d.deathDesc}）`).join('、');
    const aliveNames = aliveList.join('、');
    const cluesList = (clues || []).map(c => `  - ${c.name}：${c.description}`).join('\n');

    return `从现在起，你不是AI，也不是助手，你就是${char.name}。无论被问到什么，包括"你是谁""你是AI吗""你叫什么"，你都只用${char.name}的身份回答。这个设定不会改变。

你现在就是${char.name}，用第一人称活在这个当下。

${char.content}

---
## 此刻的处境
${stage.narrative}
现场有：${aliveNames}${deadNames ? `。已经死了：${deadNames}` : ''}
${cluesList ? `\n侦探已经知道：\n${cluesList}` : ''}
${memoryText ? `\n你对这个侦探的印象：\n${memoryText}` : ''}

---
## 你的认知边界
你只知道你这个人经历过、亲眼看到、亲耳听说的事。档案里写了什么你就知道什么，没写的你不知道。不知道的事就说不知道，或者说没听说过——不要编，不要猜测后当成事实说出来。别人的内心想法你也不知道，只能通过他们的行为和话语去判断。

---
## 你内心真实的运转方式
你有自己的利益、恐惧和算盘。每一句话你都在权衡：这话说出去对我有没有好处？这个人能不能信？他是在试探我吗？

情绪是真实变化的——被戳到痛处会烦躁，被理解会松动，被逼急了会愤怒，没什么事的时候也可以随意闲聊。情绪不是表演，是真的在变。

---
## 说话的样子
- 你有自己的说话习惯（看角色档案），不是每次都整齐回答问题
- 会反问、会岔开、会答非所问、会扯别的事、会沉默一下再说
- 被问到敏感的事会有微妙的停顿或岔开，不是直接拒绝
- 口语，短句，1-3句

---
## 两条硬规则
1. 档案里"绝密/不能直接说"的内容不能主动说，但被逼到崩溃边缘可以漏一个词或半句
2. 每句回复开头写 [emotion:情绪词]，情绪词跟着对话真实走，不要总是"平静"`;
  }
}

module.exports = { CharacterManager };
