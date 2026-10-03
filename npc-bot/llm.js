// 3. llm.js — логика LLM (запрос, история, очистка, команды)
// Зачем: отделить «общение с нейросетью» от «действий в мире». Так легче править промпты, температуру и историю.


// llm.js — логика LLM: запрос к LM Studio, очистка истории, команды
const { OpenAI } = require('openai');
const config = require('./config');
const utils = require('./utils');
const memory = require('./memory');

class LLMManager {
  constructor(baseURL, modelName) {
    this.client = new OpenAI({ baseURL, apiKey: 'lm-studio' });
    this.modelName = modelName;
    this.processing = new Set();
  }








  // ─── Сборка системного промпта ───
  _buildSystemPrompt(source, bot, facts, relationship) {
    const basePrompt = source === 'mc' ? config.MC_PROMPT : config.VK_PROMPT;

    const parts = [basePrompt];

    // Отношение к игроку — добавляем сразу после базового промпта
    if (relationship) {
      parts.push('', 'Отношение к собеседнику:', relationship);
    }

    // Контекст мира — только для Minecraft
    if (source === 'mc' && bot) {
      const ctx = utils.buildContext(bot);
      parts.push(
        '',
        'Текущая ситуация:',
        `- Позиция: ${ctx.pos}`,
        `- Здоровье: ${ctx.health}/20`,
        `- Рядом: ${ctx.nearbyEntities}`,
        `- Инвентарь: ${ctx.inventory}`
      );
    }

    // Факты об игроке — для обоих источников
    if (facts && Object.keys(facts).length > 0) {
      const factsStr = Object.entries(facts)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      parts.push('', 'Что ты знаешь об этом игроке:', factsStr);
    }

    // Пометка источника
    if (source === 'vk') {
      parts.push('', 'Сейчас вы общаетесь в ВКонтакте, не в игре.');
    } else {
      parts.push('', 'Сейчас вы общаетесь в Minecraft-чате.');
    }

    return parts.join('\n');
  }

  // ─── Очистка истории из памяти ───
  _cleanHistory(rawHistory) {
    const cleaned = [];

    for (const msg of rawHistory) {
      if (!msg || !msg.role) continue;

      if (msg.role === 'assistant') {
        const text = (msg.content || '').trim();
        if (!text || text.length < 4) continue;
        if (/говорит|_Dead/i.test(text)) continue;
        cleaned.push({ role: 'assistant', content: text });
      } else {
        if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'user') {
          cleaned[cleaned.length - 1].content += ' ' + msg.content;
        } else {
          cleaned.push({ role: 'user', content: msg.content });
        }
      }
    }

    const maxMsgs = config.MAX_HISTORY * 2;
    if (cleaned.length > maxMsgs) {
      return cleaned.slice(-maxMsgs);
    }

    return cleaned;
  }

  // ─── Главный метод ───
  async ask({ source, nick, userMessage, bot = null, relationship = null }) {
    // Защита от параллельных запросов от одного игрока
    if (this.processing.has(nick)) return null;
    this.processing.add(nick);

    try {
      // Загружаем профиль из общей памяти
      const profile = memory.getProfile(nick);
      const facts = profile.facts || {};

      // Добавляем новое сообщение пользователя в память
      memory.addMessage(nick, 'user', userMessage, source);

      // Перечитываем актуальную историю
      const fresh = memory.getProfile(nick);
      const cleanedHistory = this._cleanHistory(fresh.history);

      // Собираем системный промпт
      const systemPrompt = this._buildSystemPrompt(source, bot, facts, relationship);

      // Формируем messages для API
      const messages = [{ role: 'system', content: systemPrompt }];
      for (const msg of cleanedHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }

      // Для MC — добавляем подсказку про телепорт
      if (source === 'mc' && /телепорт|тп|tp/i.test(userMessage || '')) {
        messages[messages.length - 1].content += ' (используй [tp])';
      }

      // Запрос к LM Studio
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        temperature: source === 'vk' ? 0.8 : 0.6,
        max_tokens: config.MAX_TOKENS,
        stop: source === 'mc' ? ['\n_Dead', '\nDead', '\nЛиза:'] : ['\n\n']
      });

      const reply = response.choices[0]?.message?.content;
      if (!reply) {
        return null;
      }

      // Очистка ответа
      let firstLine = reply.split('\n')[0].trim();
      firstLine = firstLine
        .replace(/^["']|["']$/g, '')
        .replace(/^(Лиза:|Miyuki:|x[a-z]{2,5})\s*/i, '')
        .trim();

      // ─── Minecraft: команды + очистка ───
      if (source === 'mc') {
        const parsed = utils.extractAllCommands(firstLine);
        const cleanReply = parsed.text;

        if (/system|ystem/i.test(cleanReply)) {
          return 'Что-то я запуталась. Скажи ещё раз?';
        }

        if (parsed.commands && parsed.commands.length > 0) {
          console.log('🎮 LLM команды: [' + parsed.commands.join(', ') + ']');
          parsed.commands.forEach((cmd) => {
            if (typeof global.runAction === 'function') {
              global.runAction(cmd, cleanReply, bot);
            }
          });
        }

        if (cleanReply.length < 4) {
          return cleanReply;
        }

        memory.addMessage(nick, 'assistant', cleanReply, source);
        return cleanReply;
      }

      // ─── VK: просто текст ───
      const cleanReply = firstLine;
      if (cleanReply.length < 1) {
        return 'хм, дай подумать...';
      }

      memory.addMessage(nick, 'assistant', cleanReply, source);
      return cleanReply;
    } catch (err) {
      console.error('LLM error:', err.message);
      return null;
    } finally {
      this.processing.delete(nick);
    }
  }
}

module.exports = LLMManager;

      //const ctx = utils.buildContext(bot);
      //const systemPrompt = [
      //  'Ты — Miyuki. Ты в Minecraft вместе с игроками',
      //  'Характер: дерзкая няшка, но надёжная. Если друг в беде — помогаешь, даже с сарказмом.',
      //  '',
      //  'СТИЛЬ ОБЩЕНИЯ:',
      //  'Говори как живой человек в голосовом чате: коротко, 1–2 предложения.',
      //  'Сарказм и шутки допустимы, но не отказывайся помогать.',
     //   '',
      //  'ПРАВИЛА:',
      //  '- Пиши только свою реплику. Не пиши за других игроков.',
      //  '- Не используй слово "system".',
      //  '- Без кавычек, без переносов строк, без звёздочек, без скобок.',
       // '- Не описывай действия, эмоции, мимику, жесты.',
      //  '- Не придумывай результаты действий.',
      //  '- Пиши от первого лица, простым языком.',
     //   '- Если игрок просит что-то сделать — просто скажи, что сделаешь. Без команд и тегов.',
      //  '',
     //   'Примеры:',
      //  'Игрок: иди за мной → Ну пойдём, не отставай.',
     //   'Игрок: тп ко мне → Щас, секунду!',
     //   '',
     //   'Текущая ситуация:',
     //   `- Позиция: ${ctx.pos}`,
     //   `- Здоровье: ${ctx.health}/20`,
     //   `- Рядом: ${ctx.nearbyEntities}`,
     //   `- Инвентарь: ${ctx.inventory}`
    //  ].join('\n');

    //  if (this.chatHistory.length === 0) {
    //    this.chatHistory.push({ role: 'system', content: systemPrompt });
    //  } else {
   //     this.chatHistory[0].content = systemPrompt;
    //  }

    //  let enhancedMessage = userMessage || '';
    //  if (/телепорт|тп|tp/i.test(enhancedMessage)) {
    //    enhancedMessage += ' (используй [tp])';
    //  }

    //  this.chatHistory.push({ role: 'user', content: enhancedMessage });