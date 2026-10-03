// vk-bot.js — Puppeteer логин → получение токена → VK API
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('./config');
const memory = require('./memory');
const LLMManager = require('./llm');

const KATE_CLIENT_ID = '2685278'; // Kate Mobile — одобренное VK приложение
const VK_API_VERSION = '5.199';

let token = null;
let pollTimer = null;
let llm = null;
let lastMessageIds = new Set(); // чтобы не отвечать на одно и то же

async function getVKToken() {
  console.log('🔐 Открываю браузер для РУЧНОГО входа в VK...');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768 });

  const oauthUrl = `https://oauth.vk.com/authorize?client_id=${KATE_CLIENT_ID}&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=messages,offline&response_type=token&v=${VK_API_VERSION}`;

  await page.goto(oauthUrl, { waitUntil: 'domcontentloaded' });

  console.log('\n👤 ВАЖНО: войди вручную в VK, подтверди доступ и дождись страницы blank.html.');
  console.log('Когда увидишь в адресной строке access_token — напиши в консоль: done\n');

  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Введи "done", когда вошёл и видишь токен в адресной строке: ', (answer) => {
      rl.close();

      if (answer.trim().toLowerCase() !== 'done') {
        console.error('❌ Неверная команда. Нужно ввести: done');
        browser.close().catch(() => {});
        resolve(null);
        return;
      }

      const finalUrl = page.url();
      const match = finalUrl.match(/access_token=([^&]+)/);

      if (!match) {
        console.error('❌ Токен не найден в URL. Проверь адресную строку браузера.');
        console.error('URL:', finalUrl);
        browser.close().catch(() => {});
        resolve(null);
        return;
      }

      const tkn = match[1];
      console.log('✅ Токен получен! (длина: ' + tkn.length + ')');

      const fs = require('fs');
      try {
        fs.writeFileSync('./.vk_token', tkn);
        console.log('💾 Токен сохранён в .vk_token');
      } catch (e) {
        console.warn('⚠️ Не удалось сохранить токен в файл.');
      }

      browser.close()
        .then(() => resolve(tkn))
        .catch(() => resolve(tkn));
    });
  });
}



// ─── VK API вызов ───
async function vkApi(method, params = {}) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('v', VK_API_VERSION);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    console.error(`VK API error [${data.error.error_code}]: ${data.error.error_msg}`);
    return null;
  }
  return data.response;
}

// ─── Отправка сообщения ───
async function sendMessage(peerId, text) {
  return vkApi('messages.send', {
    peer_id: peerId,
    message: text,
    random_id: Math.floor(Math.random() * 1e9),
  });
}

// ─── Пометить как прочитанное ───
async function markAsRead(peerId) {
  return vkApi('messages.markAsRead', { peer_id: peerId });
}

// ─── Опрос новых сообщений ───
async function pollMessages() {
  try {
    // Получаем непрочитанные диалоги
    const convs = await vkApi('messages.getConversations', {
      filter: 'unread',
      count: 10,
    });

    if (!convs || !convs.items || convs.items.length === 0) return;

    for (const item of convs.items) {
      const conv = item.conversation;
      const lastMsg = item.last_message;

      // Только входящие сообщения
      if (!lastMsg || lastMsg.out) continue;

      const peerId = conv.peer.id;
      const fromId = lastMsg.from_id;
      const text = (lastMsg.text || '').trim();
      const msgId = lastMsg.id;

      // Пропускаем уже обработанные
      if (lastMessageIds.has(msgId)) continue;
      lastMessageIds.add(msgId);

      // Ограничиваем размер Set
      if (lastMessageIds.size > 200) {
        lastMessageIds = new Set([...lastMessageIds].slice(-100));
      }

      if (!text) continue;

      console.log(`📨 VK: от ${fromId} (peer ${peerId}): ${text}`);

      // Печатает...
      await vkApi('messages.setActivity', { peer_id: peerId, type: 'typing' });

      // Ищем профиль по VK ID
      let profile = memory.findByVK(fromId);

      if (!profile) {
        // Проверяем, похож ли текст на ник Minecraft
        if (/^[a-zA-Z0-9_]{2,16}$/.test(text)) {
          const existing = memory.getProfile(text);
          if (existing && existing.history.length > 0) {
            memory.linkVK(text, fromId);
            const reply = `О, это же ты из игры! Привет, ${text}! Я помню тебя :)`;
            await sendMessage(peerId, reply);
            memory.addMessage(text, 'assistant', reply, 'vk');
          } else {
            memory.linkVK(text, fromId);
            memory.addMessage(text, 'user', text, 'vk');
            const reply = `Привет, ${text}! Запомнила твой ник. Можем общаться и тут тоже 🙂`;
            await sendMessage(peerId, reply);
            memory.addMessage(text, 'assistant', reply, 'vk');
          }
        } else {
          await sendMessage(peerId, config.LINK_PROMPT || 'Привет! Напиши свой ник из Minecraft, чтобы я тебя вспомнила :)');
        }

        await markAsRead(peerId);
        continue;
      }

      // Обычный диалог через LLM
      const nick = profile.nick;
      const reply = await llm.ask({
        source: 'vk',
        nick: nick,
        userMessage: text,
        bot: null,
      });

      if (reply) {
        await sendMessage(peerId, reply);
      }

      await markAsRead(peerId);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
}

// ─── Запуск ───
async function startVKBot() {
  llm = new LLMManager(config.LLM_URL, config.LLM_MODEL);

  // Получаем токен через Puppeteer
  token = await getVKToken();
  if (!token) {
    console.error('❌ VK бот не запущен: не удалось получить токен');
    return;
  }

  // Сохраняем токен в файл для повторного использования
  const fs = require('fs');
  try {
    fs.writeFileSync('./.vk_token', token);
    console.log('💾 Токен сохранён в .vk_token');
  } catch {}

  // Опрос каждые 5 секунд
  pollTimer = setInterval(pollMessages, 5000);
  console.log('✅ VK бот запущен и слушает сообщения');
}

// ─── Запуск с кэшированным токеном ───
async function startVKBotCached() {
  llm = new LLMManager(config.LLM_URL, config.LLM_MODEL);

  const fs = require('fs');

  // Пытаемся использовать сохранённый токен
  if (fs.existsSync('./.vk_token')) {
    token = fs.readFileSync('./.vk_token', 'utf-8').trim();
    console.log('🔑 Использую сохранённый токен');

    // Проверяем, работает ли он
    const test = await vkApi('account.getInfo');
    if (test) {
      console.log('✅ Токен рабочий, запускаю опрос');
      pollTimer = setInterval(pollMessages, 5000);
      console.log('✅ VK бот запущен и слушает сообщения');
      return;
    }
    console.log('⚠️ Сохранённый токен не работает, получаю новый...');
  }

  await startVKBot();
}

module.exports = { startVKBot: startVKBotCached, vkApi, sendMessage };
