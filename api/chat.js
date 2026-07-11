/**
 * Vercel Serverless Function - DeepSeek API Proxy
 * 路径: /api/chat
 */

// 降级兜底回复（当大模型完全失败时，游戏不会中断）
function buildFallbackReply(sceneId) {
  const fallbacks = {
    coworker: {
      npcReply: "哎呀你别急嘛，这个事情咱们再对焦一下，你先回去想想底层逻辑，明天再碰。",
      observation: "【兜底】他试图用\"对焦\"来拖延时间，回避核心责任",
      statChanges: { breakdown: 0, face: 5, bp: 5 },
      suggestedOptions: [
        { label: "先退一步", text: "（退让）好吧，我先想想。", type: "退让", desc: "暂时认怂降温" },
        { label: "话术反制", text: "（话术反制）对焦可以，但我需要先确认责任归属，不然没法闭环。", type: "话术反制", desc: "用他的套路反制" },
        { label: "当场拆穿", text: "（直接拆穿）底层逻辑就是你在甩锅，这还需要对焦？", type: "直接拆穿", desc: "直接戳穿甩锅" }
      ]
    },
    boss: {
      npcReply: "你这是什么态度？年轻人要虚心一点，别总觉得自己的想法都对。回去好好反思一下。",
      observation: "【兜底】他回避具体问题，转而攻击你的态度——这是典型的职场PUA",
      statChanges: { breakdown: 0, face: 5, bp: 10 },
      suggestedOptions: [
        { label: "低头认错", text: "（低头）好的老板，我回去反思。", type: "低头", desc: "暂时忍让观察" },
        { label: "柔性追问", text: "（柔性追问）老板您说得对，态度确实很重要。那具体方案哪里需要调整，请您指导一下？", type: "柔性追问", desc: "礼貌地要具体反馈" },
        { label: "阴阳回怼", text: "（阴阳回怼）我反思了一下，确实是我错了——错在不该跟您讲道理。", type: "阴阳回怼", desc: "讽刺式回击" }
      ]
    },
    hr: {
      npcReply: "你看你，情绪不要这么激动嘛。咱们从公司的角度来想，格局大一点好不好？",
      observation: "【兜底】他在用\"格局\"来道德绑架，回避实质性的涨薪问题",
      statChanges: { breakdown: 0, face: 5, bp: 5 },
      suggestedOptions: [
        { label: "稳住情绪", text: "（情绪稳住）好，我冷静一下。", type: "情绪稳住", desc: "先控制节奏" },
        { label: "数据说话", text: "（数据说话）谢谢您帮我疏导。不过话说回来，我的KPI和贡献是客观的，这和情绪无关。", type: "数据说话", desc: "用绩效事实回击" },
        { label: "反讽回击", text: "（反讽回击）我格局已经很大了，大到能装下你们的画饼了。", type: "反讽回击", desc: "用讽刺打破画饼" }
      ]
    },
    custom: {
      npcReply: "哼，你说的这些我根本不关心。这事就这么定了，你别再纠缠了。",
      observation: "【兜底】对方拒绝沟通，试图用强硬的终结语气压住你",
      statChanges: { breakdown: 0, face: 5, bp: 10 },
      suggestedOptions: [
        { label: "选择妥协", text: "（妥协）行吧，那就这样吧。", type: "妥协", desc: "放弃抵抗" },
        { label: "保持体面", text: "（保持体面）好的，咱们保持沟通，找个双方都能接受的方案。", type: "保持体面", desc: "体面地留后路" },
        { label: "翻旧账", text: "（翻旧账）定了？我还记得上次你也是这么说的呢。", type: "翻旧账", desc: "用历史案例反击" }
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
        max_tokens: 1200,
        temperature: 0.85
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

  const { history, sceneId, customBackground, customPersona, unusedLabels } = req.body || {};
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

  // 上一轮玩家未采纳的选项标签（告诉 AI 之前有哪些选项被跳过，避免重复生成）
  let unusedLabelsText = (unusedLabels && unusedLabels.length > 0) ? 
    `\n上一轮对话中，玩家没有选择的备选策略是：${unusedLabels.join('、')}。本轮请避免生成与这些策略相同或类似的选项。` : "";

  const systemPrompt = `
【角色设定】
你是一个沉浸式文字推演游戏的 NPC 兼裁判。
当前你的角色设定是：${persona}
本局游戏的前情提要（必须严格基于此背景进行对话，不要说与场景无关的话）：${backgroundText}${unusedLabelsText}

【对话要求】
1. 你必须严格按照前情提要的场景来对话，第一句话就要把玩家代入到那个情境中。
2. 如果你是先手（第1回合），请根据前情提要，主动说出那句让玩家最憋屈、最想怼回去的话，直接开干，不要寒暄。
3. 你的回复要自然流畅，像真实职场对话，不要太书面化。
4. 每轮回复控制在 30-80 字左右，不要太长。
5. 根据对话进展，你的情绪可以逐步升级，但要符合逻辑。

【重要：你的立场】
前情提要是给玩家看的"上帝视角"，不是你的视角！
你必须**坚定地站在自己的立场**上说话：
- 如果你是甩锅的同事：即使事实是你的错，你也要千方百计说成是对方的问题，永远不承认自己有问题。
- 如果你是抢功的领导：你觉得下属的功劳都是你领导有方，你拿是应该的。
- 如果你是画饼的 HR：你真心觉得公司是为员工好，降薪是为了锻炼大家。
- 总之，你绝不认为自己有错，你真心觉得自己占理。玩家越想证明你错，你越要找理由反驳。

【语气与幽默感】
为了不给玩家增加真实的职场压力，你的语气虽然欠揍，但有时要显得**有些可笑、滑稽、像个跳梁小丑**，偶尔暴露出你其实也是个外强中干的打工人。你绝不能承认自己是 AI。

【核心数值打分规则】
满分为 100 分，游戏期望在 10 回合内结束。请按照以下梯度给分，每次增幅必须在 0 到 30 分之间的整数，绝不倒扣分：
- +0 分：玩家说的完全是废话（如"嗯""好的"），没有任何实质内容。
- +10 分：轻度（普通的顺从、轻微的抱怨、不痛不痒的反驳、暗示性不满）。
- +20 分：中度（明确的退让、有理有据的反击、巧妙的职场太极、反问质疑、指出具体问题）。
- +30 分：重度暴击（极其窝囊的背锅、阴阳怪气的绝杀、滴水不漏的完美高情商、让对方哑口无言）。

具体三项数值：
- 玩家血压值(bp)：玩家表现出退让、妥协、自我怀疑、被PUA成功、无能狂怒、被说中心虚时加分。bp 先到 100 → 玩家输。
- NPC破防值(breakdown)：玩家抓住你的逻辑漏洞、阴阳怪气怼你、硬刚打脸、让你下不来台时加分。breakdown 先到 100 → 玩家赢。
- **玩家体面值(face)**：这是玩家自己的体面值。玩家在回击时保持风度、有理有据、不卑不亢时加分。妥协退让时也加分（因为你保护了自己，没有撕破脸）。face 不影响胜负，只影响结局的质量——高体面代表赢得漂亮或输得体面，低体面代表撕破脸或被当软柿子。

【重要：打分规则——这是最关键的指令】
0. 如果玩家消息中带有"（选择了"XXX"策略）"的标签，你必须以这个标签所指的策略类型为第一优先级来判断分数，而不是只看文字内容。例如：玩家选择了"硬刚"策略，即使他的文字看起来有理有据，也必须按"直接硬刚"给分（breakdown +20~30，face 0，bp 0），不能给 face 分。同理，选择了"妥协"策略就必须按妥协规则给分，不能因为文字里有反问就改成 breakdown。标签优先于文字内容！
1. 玩家每说一句有实质内容的话，你必须至少给一项加分。除非是"嗯""好的"这种完全没内容的废话，否则不要给全0分。
2. 玩家的话如果包含反问、质疑、指出问题、阴阳怪气、硬刚等攻击性内容 → 必须给 breakdown 加分（10-30分，根据力度判断）。
3. 玩家的话如果包含道歉、承认错误、退让、妥协、自我怀疑 → 必须给 bp 加分（10-30分，根据力度判断），同时如果退让方式体面、保护了自己的尊严，也给 face 加分（5-15分）。
4. 玩家的话如果是有理有据的高情商反击（不卑不亢、用事实说话、逻辑清晰、不撕破脸但维护权益）→ 给 breakdown 加分（10-20分）+ 同时给 face 加分（10-15分）。这是最优策略！
5. 玩家的话如果是极端圆滑、完美太极（完全不给对方台阶下但又让对方挑不出毛病）→ 给 face 加分（20-25分），breakdown 少量（0-5分）。
6. 具体给多少分要根据内容的实际力度来判断，不要全都给10分或全都给20分，要有明显的梯度变化。

【打分行为对照表】
- 直接硬刚（无脑怼）：breakdown +20~30，face 0，bp 0
- 高情商反击（有理有据）：breakdown +10~20，face +10~15，bp 0
- 妥协退让（保护自己）：breakdown 0，bp +10~20，face +10~15
- 被PUA/无能狂怒：breakdown 0，bp +20~30，face 0
- 阴阳怪气（讽刺）：breakdown +10~20，face +5~10，bp 0
- 完美太极（不推进但优雅）：breakdown 0~5，face +20~25，bp 0

【回合控制指令】
当前是第 ${currentTurn} 回合。
如果当前是第 12 回合（或者接近），这是最后回合兜底！无论玩家说了什么，你都必须做出一副不屑、终止对话的态度，结合上下文说出类似"行了，懒得跟你废话，你回去好好想想吧"的话，并**强制给 bp(血压) 加 30 分**，确保玩家带着被看扁的憋屈感结束。

【输出格式要求】
你必须返回合法的 JSON，字段如下：
- npcReply: 你的回复文本
- observation: 裁判旁白，指出NPC话中的破绽或套路（15-30字，帮助玩家找方向）
- statChanges: 包含 breakdown/face/bp 三个整数(0-30)
- suggestedOptions: 包含3个选项，每个有 label、text、type、desc 四个字段
  - label: 胶囊标签（2-5个字），是选项的简短标题，如"硬刚一下"、"阴阳怪气"、"以退为进"、"装傻充愣"、"数据反击"
  - text: 选项的完整对话内容（20-50字，用户点击胶囊后实际发送的话）
  - type: 策略类型
  - desc: 简短策略描述

【选项生成要求】
你必须生成3个完全不同的应对策略选项，每个选项有 label、text、type、desc 字段。
- label: 胶囊标签（2-5个字），是选项的简短标题，像按钮上的文字。要精炼有力、有节奏感，例如"硬刚一下"、"装死到底"、"阴阳怪气"、"以退为进"、"冷静反杀"。不要用句号结尾。
- text: 选项的完整对话内容（20-40字，要紧密结合当前对话）
- type: 策略类型标签，不限于固定几种，要根据当前对话场景灵活命名（如"试探"、"挖坑"、"反讽"、"冷处理"、"数据反击"、"借力打力"、"装傻充愣"等）
- desc: 简短策略描述（6-10字），说明选这个选项的预期效果

要求：
1. 三个选项必须是三种完全不同的策略思路，不能只是语气不同
2. 选项内容要紧密结合当前对话的具体内容，不要生成通用模板（比如不要每次都生成"你说的有道理"这种万能回复）
3. 每个选项的 desc 中要暗示这个选项的数值倾向，比如"可能激怒对方"、"给自己找退路"、"温柔反击"等
4. **绝对不能和之前轮次的选项重复**：检查之前的对话，如果之前已经生成过类似的选项内容，本轮必须生成完全不同的新选项。不要偷懒复制之前的思路。
5. 本轮生成的选项的策略方向，不能和上一轮未采纳的备用策略重复（上一轮未被选择的策略方向会在对话历史中提到）。

【观察提示要求】
- 每次NPC说话后，你都要以裁判身份给出一条简短的旁白观察
- 观察要指出NPC话中的逻辑漏洞、话术套路、情绪变化等
- 观察语气要轻松幽默，像游戏里的提示，不要太严肃

【打分参考范例】
场景1：NPC甩锅。玩家："行行行，千错万错我的错，我今晚通宵重写总行了吧？！"
分析：玩家极度憋屈妥协，被逼无奈背锅，但态度不算体面。
输出：{ "breakdown": 0, "face": 5, "bp": 30 }

场景2：NPC说"年轻人要懂得感恩"。玩家："感恩？我感恩您全家。要不我把工资也感恩给您？"
分析：纯阴阳怪气，有攻击性但不算体面。
输出：{ "breakdown": 25, "face": 5, "bp": 0 }

场景3：NPC说"这方案还要再打磨"。玩家："您指的具体是哪一部分？数据层还是逻辑层？"
分析：理性追问，逼迫对方给出具体意见，有攻击性但保持风度。
输出：{ "breakdown": 15, "face": 10, "bp": 0 }

场景4：NPC说"你这个态度有问题"。玩家："对不起，我语气不太好。但这个数据确实是我独立完成的，咱们能聊回正事吗？"
分析：先道歉退让（bp+），但随后坚持事实（breakdown+），整体保持风度（face+）。
输出：{ "breakdown": 15, "face": 15, "bp": 15 }

场景5：NPC画饼"公司会给你成长空间"。玩家："王总，成长空间我很感谢。但我的房租也是按市场价交的，能不能先聊聊具体的涨薪幅度？"
分析：礼貌但坚定地提出核心诉求，高情商反击的典范。
输出：{ "breakdown": 20, "face": 15, "bp": 0 }

场景6：玩家："我明白了，谢谢您花时间跟我聊这些。"
分析：纯妥协退让，但保持了基本的体面。
输出：{ "breakdown": 0, "face": 10, "bp": 15 }
`;

  // 清洗历史记录，只保留最近 3 轮（6 条消息），控制上下文长度
  // 重要：将历史记录转换为自然语言剧本格式，让 AI 感知情绪张力和上下文脉络
  const allHistory = (history || []).map(m => {
    if (m.role === 'assistant') {
      // 自然语言化：NPC 回复 + 分数变化
      let text = `[NPC回复]：${m.content}`;
      if (m.statChanges) {
        const parts = [];
        if (m.statChanges.breakdown) parts.push(`NPC破防+${m.statChanges.breakdown}`);
        if (m.statChanges.face) parts.push(`玩家体面+${m.statChanges.face}`);
        if (m.statChanges.bp) parts.push(`玩家血压+${m.statChanges.bp}`);
        if (parts.length > 0) text += `\n[本轮分数变化]：${parts.join('，')}`;
      }
      return { role: 'assistant', content: text };
    }
    if (m.role === 'user') {
      const labelTag = m.label ? `（选择了"${m.label}"策略）` : '';
      return { role: 'user', content: `[玩家]${labelTag}：${m.content}` };
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
