// mc-integration.js — хук для mineflayer-бота
const memory = require('./memory');
const LLMManager = require('./llm');
const config = require('./config');

const llm = new LLMManager(config.LLM_URL, config.LLM_MODEL);

const cooldowns = new Map();
const COOLDOWN_MS = 3000;

function attach(bot) {
  bot.on('chat', async (username, message) => {
    // Игнорируем自身а
    if (username === bot.username) return;

    // Кулдаун
    const now = Date.now();
    if (cooldowns.has(username) && now - cooldowns.get(username) < COOLDOWN_MS) {
      return;
    }
    cooldowns.set(username, now);

    try {
      const reply = await llm.ask({
        source: 'mc',
        nick: username,
        userMessage: message,
        bot: bot
      });

      if (reply) {
        // Обрезаем для чата Minecraft (максимум ~250 символов)
        const mcReply = reply.length > 250 ? reply.slice(0, 247) + '...' : reply;

        bot.chat(`/tell ${username} ${mcReply}`);

        console.log(`[MC] ${username}: ${message} -> ${mcReply}`);
      }
    } catch (err) {
      console.error('MC AI error:', err);
    }
  });

  console.log('MC AI интеграция подключена');
}

module.exports = { attach };
