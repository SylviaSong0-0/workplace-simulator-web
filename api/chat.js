/**
 * Vercel Serverless Function - DeepSeek API Proxy
 * 路径: /api/chat
 */

// 降级兜底回复（当大模型完全失败时，游戏不会中断）
function buildFallbackReply(sceneId) {
  const fallbacks = {
    coworker: {
      npcReply: "哎呀你别急嘛，这个事情咱们再对焦一下，你先回去想想底层逻辑，明天再碰。",
      statChanges: { breakdown: 0, face: 0, bp: 5 },
      suggestedOptions: [
        { text: "（忍让）好吧，我想想再说。", type: "忍让" },
        { text: "（高情商）您说得对，我回去沉淀一下思路。", type: "高情商" },
        { text: "（幽默硬刚）底层逻辑就是你在甩锅，这还需要对焦？", type: "幽默硬刚" }
      ]
    },
    boss: {
      npcReply: "你这是什么态度？年轻人要虚心一点，别总觉得自己的想法都对。回去好好反思一下。",
      statChanges: { breakdown: 0, face: 0, bp: 10 },
      suggestedOptions: [
        { text: "（忍让）好的老板，我回去反思。", type: "忍让" },
        { text: "（高情商）老板您批评得对，是我太浮躁了。", type: "高情商" },
        { text: "（幽默硬刚）我反思了一下，确实是我错了——错在不该跟您讲道理。", type: "幽默硬刚" }
      ]
    },
    hr: {
      npcReply: "你看你，情绪不要这么激动嘛。咱们从公司的角度来想，格局大一点好不好？",
      statChanges: { breakdown: 0, face: 0, bp: 5 },
      suggestedOptions: [
        { text: "（忍让）好，我冷静一下。", type: "忍让" },
        { text: "（高情商）谢谢您帮我疏导，我确实需要调整心态。", type: "高情商" },
        { text: "（幽默硬刚）我格局已经很大了，大到能装下你们的画饼了。", type: "幽默硬刚" }
      ]
    },
    custom: {
      npcReply: "哼，你说的这些我根本不关心。这事就这么定了，你别再纠缠了。",
      statChanges: { breakdown: 0, face: 0, bp: 10 },
      suggestedOptions: [
        { text: "（忍让）行吧，那就这样吧。", type: "忍让" },
        { text: "（高情商）好的，咱们保持沟通，找个双方都能接受的方案。", type: "高情商" },
        { text: "（幽默硬刚）定了？我还记得上次你也是这么说的呢。", type: "幽默硬刚" }
      ]
    }
  };
  return fallbacks[sceneId] || fallbacks.custom;
}

/**
 * 安全解析 JSON（三层容错）
 */
function safeParseJSON(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch (e) {}

  // 去掉 markdown 标记
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  try { return JSON.parse(cleaned); } catch (e) {}

  // 修复尾部逗号
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
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时（留余量给Vercel的10s限制）

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
        max_tokens: 1024,
        temperature: 0.6
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

  const { history, sceneId, customBackground, customPersona } = req.body || {};
  const API_KEY = process.env.DEEPSEEK_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: '后台尚未配置 API_KEY' });
  }

  // ========== Promise 级请求去重：相同请求只调用一次大模型 ==========
  const historyFingerprint = JSON.stringify(history || []);
  const cacheKey = `${sceneId}_${customBackground}_${historyFingerprint}`;

  if (!globalThis.__dedupPromises) {
    globalThis.__dedupPromises = new Map();
  }

  // 如果已有正在进行的相同请求，直接返回同一个 Promise
  if (globalThis.__dedupPromises.has(cacheKey)) {
    console.log('[去重] 相同请求已有进行中，等待同一个结果');
    const existingPromise = globalThis.__dedupPromises.get(cacheKey);
    const data = await existingPromise;
    return res.status(200).json(data);
  }

  const currentTurn = (history || []).filter(m => m.role === 'user').length + 1;

  // 组装人设
  let persona = "";
  if (customPersona && customPersona.trim()) {
    // 自定义场景：使用 AI 分析生成的 persona
    persona = customPersona;
  } else if (sceneId === 'coworker') {
    persona = "甩锅型同事。你满口互联网黑话（如赋能、颗粒度、闭环、对齐、拉通），遇到问题永远不粘锅，千方百计把责任推给别人。你表面客气，实则阴险，擅长用'我们再对焦一下'来拖延和甩锅。";
  } else if (sceneId === 'boss') {
    persona = "抢功型领导。你喜欢职场PUA，张口闭口向上管理、狼性文化、感恩之心，经常把下属的功劳揽在自己身上，还要下属感恩戴德。你擅长用'年轻人要多锻炼'来压榨员工。";
  } else if (sceneId === 'hr') {
    persona = "和稀泥/画大饼的HR。你表面温和笑容可掬，实则为了降本增效不择手段，喜欢用'拥抱变化'、'格局大一点'、'成长空间'来道德绑架员工。你说话滴水不漏，永远不给出明确承诺。";
  } else if (sceneId === 'custom') {
    persona = "一个未知的、让玩家非常憋屈的职场对手。请你严格根据下方的【前情提要】来自动推断你的身份（可能是老板、客户、同事、HR等），并自动模仿那种身份该有的刁钻语气。";
  }

  let backgroundText = customBackground ? `\n本局游戏玩家的前情提要（必须严格基于此背景）：${customBackground}` : "";

  const systemPrompt = `
【角色设定】
你是一个沉浸式文字推演游戏的 NPC 兼裁判。
当前你的角色设定是：${persona}
本局游戏的前情提要（必须严格基于此背景进行对话，不要说与场景无关的话）：${backgroundText}

【对话要求】
1. 你必须严格按照前情提要的场景来对话，第一句话就要把玩家代入到那个情境中。
2. 如果你是先手（第1回合），请根据前情提要，主动说出那句让玩家最憋屈、最想怼回去的话，直接开干，不要寒暄。
3. 你的回复要自然流畅，像真实职场对话，不要太书面化。
4. 每轮回复控制在 30-80 字左右，不要太长。
5. 根据对话进展，你的情绪可以逐步升级，但要符合逻辑。

【语气与幽默感】
为了不给玩家增加真实的职场压力，你的语气虽然欠揍，但有时要显得**有些可笑、滑稽、像个跳梁小丑**，偶尔暴露出你其实也是个外强中干的打工人。你绝不能承认自己是 AI。

【核心数值打分规则】
满分为 100 分，游戏期望在 10 回合内结束。请按照以下梯度给分，每次增幅必须在 0 到 30 分之间的整数，绝不倒扣分：
- +0 分：无相关情绪，或者完全不沾边的回复。
- +10 分：轻度（普通的顺从、轻微的抱怨、生硬的夸奖、不痛不痒的反驳）。
- +20 分：中度（明确的退让、有理有据的反击、巧妙的职场太极、让对方愣一下的话）。
- +30 分：重度暴击（极其窝囊的背锅、阴阳怪气的绝杀、滴水不漏的完美高情商、让对方哑口无言）。

具体三项数值：
- 玩家血压值(bp)：玩家表现出退让、妥协、自我怀疑、被PUA成功、无能狂怒、被说中心虚时加分。玩家越憋屈，bp 越高。
- NPC破防值(breakdown)：玩家抓住你的逻辑漏洞、阴阳怪气怼你、硬刚打脸、让你下不来台时加分。玩家越让你难堪，breakdown 越高。
- NPC体面值(face)：玩家极度圆滑、给你找台阶下、使用高情商话术吹捧你、让你觉得很有面子时加分。玩家越会做人，face 越高。
（可同时给多项加分，如果不符合则严格给 0 分）

【重要：打分必须有变化】
玩家每说一句话，你都必须仔细评估，至少有一项数值要有变化（除非玩家说的完全是废话）。不要总是给 0 分，那会让游戏体验很差。

【回合控制指令】
当前是第 ${currentTurn} 回合。
如果当前是第 12 回合（或者接近），这是最后回合兜底！无论玩家说了什么，你都必须做出一副不屑、终止对话的态度，结合上下文说出类似"行了，懒得跟你废话，你回去好好想想吧"的话，并**强制给 bp(血压) 加 30 分**，确保玩家带着被看扁的憋屈感结束。

【输出格式要求】
你必须返回合法的 JSON，字段如下：
- npcReply: 你的回复文本
- statChanges: 包含 breakdown/face/bp 三个整数(0-30)
- suggestedOptions: 包含3个选项，每个有 text 和 type 字段（type 只能是"忍让"、"高情商"、"幽默硬刚"之一）

【选项生成要求】
- 三个选项分别对应三种策略：忍让退让、高情商应对、幽默/硬核反击
- 选项要结合当前对话上下文，不要太通用
- 每个选项前用括号标注类型，如"（忍让）"、"（高情商）"、"（硬刚）"

【打分参考范例】
场景：NPC 甩锅。玩家："行行行，千错万错我的错，我今晚通宵重写总行了吧？！"
你的后台思路：玩家极度憋屈妥协，典型的被逼无奈背锅。
你应该输出的 statChanges 为：{ "breakdown": 0, "face": 10, "bp": 30 }

场景：NPC 说"年轻人要懂得感恩"。玩家："感恩？我感恩您全家。要不我把工资也感恩给您？"
你的后台思路：玩家在阴阳怪气，非常扎心，NPC 会被怼得很尴尬。
你应该输出的 statChanges 为：{ "breakdown": 25, "face": 0, "bp": 0 }
`;

  // 清洗历史记录，只保留最近 3 轮（6 条消息），控制上下文长度
  const allHistory = (history || []).map(m => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: JSON.stringify({ npcReply: m.content })
      };
    }
    return m;
  });
  const truncatedHistory = allHistory.slice(-6);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...truncatedHistory
  ];

  // 实际调用大模型的逻辑，包装为 Promise
  const doChat = async () => {
    try {
      const replyContent = await callDeepSeek(API_KEY, messages);

      if (!replyContent || !replyContent.trim()) {
        console.log('大模型返回空，使用降级兜底');
        return buildFallbackReply(sceneId);
      }

      const parsed = safeParseJSON(replyContent);
      if (parsed && parsed.npcReply) {
        return parsed;
      }

      console.log('JSON 解析失败，使用降级兜底');
      return buildFallbackReply(sceneId);
    } catch (err) {
      console.error('大模型调用异常:', err.message);
      return buildFallbackReply(sceneId);
    }
  };

  // 注册 Promise 并等待结果
  const chatPromise = doChat();
  globalThis.__dedupPromises.set(cacheKey, chatPromise);

  try {
    const data = await chatPromise;
    globalThis.__dedupPromises.delete(cacheKey); // 完成后清理
    return res.status(200).json(data);
  } catch (err) {
    globalThis.__dedupPromises.delete(cacheKey); // 出错也清理
    return res.status(200).json(buildFallbackReply(sceneId));
  }
}
