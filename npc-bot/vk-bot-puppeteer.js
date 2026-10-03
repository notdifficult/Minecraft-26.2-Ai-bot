const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('./config');
const LLMManager = require('./llm');
const memory = require('./memory');

class VKBotBrowser {
  constructor() {
    this.browser = null;
    this.page = null;
    this.llm = new LLMManager(config.LLM_URL, config.LLM_MODEL);
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('🤖 VK Bot (Puppeteer) стартует…');

    try {
      this.browser = await puppeteer.launch({
        headless: 'new', // можно false для отладки
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      this.page = await this.browser.newPage();

      // Вход
      await this.login();

      // Цикл опроса новых сообщений
      setInterval(() => this.checkNewMessages(), 10000);
      console.log('✅ VK Bot запущен и слушает сообщения.');
    } catch (err) {
      console.error('❌ VK Bot запуск не удался:', err);
      this.stop();
    }
  }

  async login() {
    const { VK_LOGIN, VK_PASSWORD } = config;

    await this.page.goto('https://vk.com', { waitUntil: 'domcontentloaded' });

    // Поля логина/пароля могут меняться — проверь актуальные селекторы в браузере
    await this.page.waitForSelector('input[name="email"]');
    await this.page.type('input[name="email"]', VK_LOGIN);
    await this.page.type('input[name="pass"]', VK_PASSWORD);

    const submitBtn = await this.page.$('[type="submit"]');
    if (!submitBtn) throw new Error('Кнопка входа не найдена — VK изменил верстку');
    await submitBtn.click();

    // Ждём, пока появится мессенджер (или редирект в него)
    await this.page.waitForFunction(
      () => window.location.href.includes('/im') || document.querySelector('[data-tab="messages"]'),
      { timeout: 60000 }
    );

    console.log('✅ Вход выполнен.');
  }

  async checkNewMessages() {
    try {
      // Переходим в мессенджер, если вдруг ушли
      if (!window.location.href.includes('/im')) {
        await this.page.goto('https://vk.com/im', { waitUntil: 'domcontentloaded' });
      }

      // Ищем непрочитанные чаты (селектор может устареть)
      const chats = await this.page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[data-peer-id]'));
        return items.map(el => {
          const id = el.getAttribute('data-peer-id');
          const unread = el.querySelector('[data-unread]');
          return { id, hasUnread: !!unread };
        });
      });

      for (const chat of chats) {
        if (!chat.hasUnread) continue;

        await this.processChat(chat.id);
      }
    } catch (e) {
      console.warn('⚠️ Ошибка при проверке сообщений:', e.message);
    }
  }

  async processChat(peerId) {
    // Открываем чат
    await this.page.evaluate((id) => {
      window.vk.im.open(id);
    }, peerId);

    // Ждём появления сообщений
    await new Promise(r => setTimeout(r, 2000));

    // Получаем последнее сообщение собеседника
    const lastMsg = await this.page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.im-row'));
      const myRows = rows.filter(r => r.classList.contains('im-row_me'));
      const lastIndex = myRows.length > 0 ? myRows[0].dataset.index : -1;
      const others = rows.filter(r => !r.classList.contains('im-row_me') && parseInt(r.dataset.index || 0) > lastIndex);
      if (others.length === 0) return null;
      const textEl = others[others.length - 1].querySelector('.im-message-text-content');
      return textEl ? textEl.innerText.trim() : null;
    });

    if (!lastMsg) return;

    // Ищем профиль по peerId (VK ID)
    let profile = memory.findByVK(peerId);
    if (!profile) {
      // Если нет — пробуем связать по последнему сообщению (если это ник)
      if (/^[a-zA-Z0-9_]{2,16}$/.test(lastMsg)) {
        memory.linkVK(lastMsg, peerId);
        profile = memory.getProfile(lastMsg);
      } else {
        // Не знаем, кто это — отвечаем шаблонно
        await this.sendMessage(peerId, config.VK_PROMPT.split('\n')[0]);
        return;
      }
    }

    const nick = profile.nick;
    const reply = await this.llm.ask({
      source: 'vk',
      nick: nick,
      userMessage: lastMsg,
      bot: null
    });

    if (reply) {
      await this.sendMessage(peerId, reply);
      memory.addMessage(nick, 'assistant', reply, 'vk');
    }
  }

  async sendMessage(peerId, text) {
    const input = await this.page.waitForSelector('.im-input');
    await input.type(text);
    const sendBtn = await this.page.waitForSelector('[data-action="send"]');
    await sendBtn.click();
    console.log(`💬 Ответ в чат ${peerId}: ${text}`);
  }

  async stop() {
    this.isRunning = false;
    if (this.browser) {
      await this.browser.close();
      console.log('🔌 VK Bot остановлен');
    }
  }
}

module.exports = new VKBotBrowser();
