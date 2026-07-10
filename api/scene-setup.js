/**
 * Vercel Serverless Function - 场景设置/准备页生成
 * 路径: /api/scene-setup
 * 功能：分析用户输入的自定义场景，推断对手身份、时间、地点、人物等
 */

/**
 * 安全解析 JSON
 */
function safeParseJSON(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch (e) {}

  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  try { return JSON.parse(cleaned); } catch (e) {}

  try {
    let fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    return JSON.parse(fixed);
  } catch (e) {}

  return null;
}

/**
 * 调用 DeepSeek API
 */
async function callDeepSeek(API_KEY, messages) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        response_format: { type: 'json_object' },
        max_tokens: 800,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(`DeepSeek API ${res.status}: ${errData.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return data.choices[0].message.content || '';
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * 兜底场景分析（当大模型失败时使用）
 */
function buildFallbackSetup(customBackground) {
  return {
    title: '自定义对局',
    playerRole: '打工人',
    npcName: '职场对手',
    npcRole: '未知身份',
    npcAvatar: '🎭',
    sceneType: 'custom',
    time: '工作时间',
    location: '公司',
    people: '你、对手',
    difficulty: '⭐⭐⭐',
    background: customBackground || '一场职场博弈即将展开...',
    goal: '根据现场情况，随机应变，保护好自己的权益！',
    persona: '一个让玩家非常憋屈的职场对手。请根据玩家的前情提要，自动推断你的身份（可能是老板、客户、同事、HR等），并模仿那种身份该有的刁钻语气。'
  };
}

export default async function handler(req, res) {
  // CORS 预检
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { customBackground } = req.body || {};
  const API_KEY = process.env.DEEPSEEK_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: '后台尚未配置 API_KEY' });
  }

  if (!customBackground || !customBackground.trim()) {
    return res.status(400).json({ error: '请输入场景背景' });
  }

  const systemPrompt = `
你是一个职场吵架模拟器的场景策划师。请根据玩家输入的前情提要，分析并生成完整的场景设置信息。

【玩家输入的前情提要】
${customBackground}

【你的任务】
请分析这段背景，推断出以下信息，并以 JSON 格式返回：

1. title: 场景标题（简短有力，10字以内）
2. playerRole: 玩家的身份/角色
3. npcName: 对手的称呼（如"黑心老板"、"甩锅同事"、"画饼HR"等）
4. npcRole: 对手的具体身份/职位
5. npcAvatar: 对手的 emoji 头像（选一个最贴切的 emoji）
6. sceneType: 对手类型，只能是以下四种之一：coworker（同事）、boss（领导）、hr（HR）、custom（其他）
7. time: 事情发生的时间（合理推断，如"周二上午"、"周五下班前"等）
8. location: 事情发生的地点（如"会议室"、"领导办公室"、"茶水间"等）
9. people: 在场的人物（简要列出）
10. difficulty: 难度等级，用 1-5 个⭐表示
11. background: 润色后的前情提要（150-200字，更有代入感，突出矛盾冲突）
12. goal: 玩家在这场对话中的目标（一句话，清晰明确）
13. persona: 给 AI 扮演 NPC 用的角色设定（100字左右）。**重要**：这个角色必须坚定地站在自己的立场上，即使自己有错也绝不承认，要想方设法把责任推给玩家，让玩家觉得憋屈。要描述清楚这个角色的性格、说话方式、立场，以及他为什么觉得自己有理。

【要求】
- 严格基于玩家输入的内容进行合理推断，不要凭空编造太离谱的内容
- 如果背景中明显是HR的场景，sceneType 必须是 "hr"
- 如果背景中明显是领导/老板，sceneType 必须是 "boss"
- 如果背景中明显是平级同事，sceneType 必须是 "coworker"
- 都不是的话才用 "custom"
- 返回纯 JSON，不要任何额外文字
`;

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  try {
    const replyContent = await callDeepSeek(API_KEY, messages);

    if (!replyContent || !replyContent.trim()) {
      console.log('场景分析返回空，使用兜底');
      return res.status(200).json(buildFallbackSetup(customBackground));
    }

    const parsed = safeParseJSON(replyContent);
    if (parsed && parsed.title) {
      // 确保 sceneType 合法
      const validTypes = ['coworker', 'boss', 'hr', 'custom'];
      if (!validTypes.includes(parsed.sceneType)) {
        parsed.sceneType = 'custom';
      }
      return res.status(200).json(parsed);
    }

    console.log('场景分析 JSON 解析失败，使用兜底');
    return res.status(200).json(buildFallbackSetup(customBackground));
  } catch (err) {
    console.error('场景分析异常:', err.message);
    return res.status(200).json(buildFallbackSetup(customBackground));
  }
}
