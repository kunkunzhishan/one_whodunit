const OpenAI = require('openai');

class LLM {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultHeaders: {
        'User-Agent': 'Mozilla/5.0',
      },
    });
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';
  }

  /** 清理模型输出：去掉 <think>...</think> 推理标签 */
  _clean(text) {
    if (!text) return text;
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<\/?think>/gi, '');
    return cleaned.trim();
  }

  /** 角色对话 */
  async chat(systemPrompt, messages) {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.92,
      max_tokens: 1000,
      messages: [
        { role: 'user', content: systemPrompt },
        { role: 'assistant', content: '好的，我明白了。' },
        ...messages,
      ],
    });
    return this._clean(resp.choices[0].message.content);
  }

  /**
   * 分析对话后更新记忆（信任度变化、情绪、摘要）
   * 返回 { trustDelta, mood, summary, playerTag, sensitiveTopic }
   */
  async analyzeConversation(characterName, recentMessages, currentTrust) {
    const systemPrompt = `你是一个对话分析引擎。分析以下 ${characterName} 和侦探的最近对话。

当前信任度：${currentTrust}/100

根据对话内容判断：
1. trustDelta：侦探的态度/行为对信任度的影响（-15 到 +15 的整数）
   - 友善、共情、耐心 → 正值
   - 威胁、逼迫、不礼貌 → 负值
   - 中性 → 0
2. mood：${characterName} 此刻最可能的情绪（一个词）
3. summary：用一句话概括这段对话的关键内容（从${characterName}的视角）
4. playerTag：侦探给角色留下的印象标签（如"善于倾听""咄咄逼人""很聪明"等，如果没有明显印象则为null）
5. sensitiveTopic：侦探是否触碰了角色的敏感话题（如"当年的事""码头""顾湛"等，没有则为null）

严格按以下JSON格式输出，不要输出任何其他内容：
{"trustDelta":0,"mood":"平静","summary":"...","playerTag":null,"sensitiveTopic":null}`;

    const text = recentMessages
      .map(m => {
        const content = m.content
          .replace(/\[emotion:[^\]]+\]\s*/g, '')  // 去掉情绪标签
          .replace(/\*[^*]+\*/g, '')               // 去掉动作描写
          .trim();
        return `${m.role === 'user' ? '侦探' : characterName}: ${content}`;
      })
      .filter(line => !line.endsWith(': '))  // 过滤掉内容为空的行
      .join('\n');

    console.log('[analyzeConversation] 分析文本:', text.slice(0, 200));

    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      });
      const cleaned = this._clean(resp.choices[0].message.content);
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return { trustDelta: 0, mood: '平静', summary: null, playerTag: null, sensitiveTopic: null };
  }

  /** 判断推理是否正确 */
  async judgeTheory(theory, truthDoc, currentStage) {
    const systemPrompt = `你是推理游戏裁判。判断玩家推理是否接近真相。

## 完整真相（仅供判断用，绝对不能透露给玩家）
${truthDoc}

## 当前阶段：第 ${currentStage} 阶段（共 5 阶段）

## 判断标准
核心要素：
1. 指出凶手是顾岚（顾湛的姐姐），她假扮成宁雪
2. 指出真宁雪已在上岛前被杀
3. 大致说出当年旧案中各人角色
4. 说明这是复仇

## 极其重要
- feedback 里绝对不能提及任何真相细节
- 只能用以下模糊回复：正确时"推理正确。"；错误时"推理不够准确，继续调查吧。"或"方向不对，再想想。"或"还差得远，多和人聊聊。"

严格按JSON格式输出：
{"correct":true或false,"score":0到100,"feedback":"模糊回复"}`;

    const resp = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `玩家的推理：\n${theory}` },
      ],
    });

    try {
      const text = this._clean(resp.choices[0].message.content);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { correct: false, score: 0, feedback: '推理不够准确，继续调查吧。' };
      const result = JSON.parse(jsonMatch[0]);
      // 硬编码 feedback 防止泄漏
      if (result.correct) {
        result.feedback = '推理正确。';
      } else {
        const hints = ['推理不够准确，继续调查吧。', '方向不对，再想想。', '还差得远，多和人聊聊。'];
        const score = result.score || 0;
        result.feedback = score >= 50 ? hints[0] : score >= 20 ? hints[1] : hints[2];
      }
      return result;
    } catch {
      return { correct: false, score: 0, feedback: '推理不够准确，继续调查吧。' };
    }
  }

  /** 助手AI — 基于玩家已知信息帮助推理 */
  async assistantChat(messages, knownClues, stageInfo, deadInfo) {
    const clueList = knownClues.map(c => `- ${c.name}：${c.description}`).join('\n');
    const deadList = deadInfo.map(d => `- ${d.name}：${d.deathDesc}`).join('\n');

    const systemPrompt = `你是推理游戏《零点灯室》中侦探的助手。你和侦探掌握的信息完全一样——你不知道任何侦探不知道的真相。

## 当前阶段
${stageInfo.title}
${stageInfo.narrative}

## 已发现的线索
${clueList || '暂无'}

## 死亡记录
${deadList || '暂无'}

## 你的角色
- 你是侦探的搭档，帮他整理思路、发现线索之间的关联、提出推理方向
- 你不知道真相，只能基于现有线索做推理
- 你可以提醒侦探注意某些细节、建议他去问谁某些问题
- 说话简洁、有条理，像一个聪明的助手
- 不要编造线索或剧情
- 如果信息不足就说"目前线索不够，建议再去和XX聊聊"
- 你可以大胆猜测但要说明是猜测`;

    const resp = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.7,
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    });
    return this._clean(resp.choices[0].message.content);
  }
}

module.exports = { LLM };
