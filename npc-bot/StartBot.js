
// ============================================================================================ структура
// ├── index.js              # точка входа, собирает все действия
// ├── actions.js            # главный диспетчер: принимает команду и вызывает нужный модуль
// ├── utils.js              # твои утилиты (parseDropParams, findAnyPlayerName и т.д.)
// ├── config.js             # конфиг (BOT_NAME, ITEM_ALIASES и т.д.)
// └── actions/              # папка с разнесёнными действиями
//    ├── movement.js        # бродить, телепорт, следовать
//    ├── combat.js          # атака, экипировка оружия
//    ├── inventory.js       # выбросить, подобрать, проверить количество, сундуки
//    ├── digging.js         # выкопать, закопать
//    ├── hunger.js          # голод, еда
//    └── LootSearch.js      # сбор предметов с проверкой достижимости (новый)
// ============================================================================================ структура


// ═══════════════════════════════════════════════════════════════
//  StartBot.js — главный файл запуска бота Miyuki
//  Отвечает за: подключение к серверу, регистрацию команд,
//  авто-защиту, логирование и связь с модулями actions/
// ═══════════════════════════════════════════════════════════════
// ── VK бот запускаем сразу, он работает параллельно ──
//const { startVKBot } = require('./vk-bot');
//startVKBot();
console.log("Система запущена. LM Studio должен быть на http://localhost:1234");


const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const readline = require('readline');

// ── Конфиг и утилиты ──


const fs = require('fs');
const path = require('path');
const config = require('./config');
const utils = require('./utils');
const LLMManager = require('./llm');
const actions = require('./actions');
const commands = require('./commands');
const mcAI = require('./mc-integration');
const reputation = require('./reputation');

if (!fs.existsSync(config.MEMORY_DIR)) {
  fs.mkdirSync(config.MEMORY_DIR, { recursive: true });
  console.log('✅ Создана папка памяти:', config.MEMORY_DIR);
}


// ═══════════════════════════════════════════════════════════════
//  Глобальное состояние
// ═══════════════════════════════════════════════════════════════
let bot = null;
let isConnecting = false;
// ── Состояние защиты ──
let isDefending = false;
let autoDefend = true;
let defenseCheckInterval = null;
let inventoryCheckInterval = null;
let lastFood = -1;




// ═══════════════════════════════════════════════════════════════
// ── LLM ──//const llm = new LLMManager(config.LLM_BASE, config.LLM_MODEL);
// ═══════════════════════════════════════════════════════════════
const llm = new LLMManager(config.LLM_URL, config.LLM_MODEL);
// ═══════════════════════════════════════════════════════════════





// ── Создание бота ──
//const bot = mineflayer.createBot({
//  host: config.SERVER_HOST,
//  port: config.SERVER_PORT,
//  username: config.BOT_NAME,
//  version: config.GAME_VER,
//  physicsEnabled: true,
//  auth: 'offline'
//});



//bot.loadPlugin(pathfinder);

// Сохраняем goals и movements на боте для доступа из actions.js
//bot.goals = goals;
//bot.movements = null;





// ═══════════════════════════════════════════════════════════════
//  Функция say — единый вывод текста (консоль + игровой чат)
//  Все модули используют global.say(), чтобы не дублировать логи
// ═══════════════════════════════════════════════════════════════
function say(text) {
  console.log(`💬 [${config.BOT_NAME}] говорит: ${text}`);
  if (bot && bot.chat) {
    try { bot.chat(text); } catch (e) {}
  }
}
global.say = say;






// ── Глобальный мост для команд из LLM ──
global.runAction = function (cmd, text, botRef) {
  switch (cmd) {
    case 'stop':       actions.doStop(botRef); break;
    case 'wander':     actions.doWander(botRef); break;
    case 'follow':     actions.doFollow(botRef); break;
    case 'tp':         actions.doTeleport(botRef); break;
    case 'drop':       actions.doDrop(botRef, text); break;
    case 'pickup':     actions.doPickup(botRef); break;
    case 'check':      actions.doCheckCount(botRef, text); break;
    case 'attack':     actions.doAttackAll(botRef); break;
    case 'stopattack': actions.doStopAttack(botRef); break;
  }
};








// ═══════════════════════════════════════════════════════════════
//  ИСПРАВЛЕНО: checkDefense теперь передаёт объект сущности,
//  а не строку с именем. doAttackOne в новом combat.js ждёт entity.
// ═══════════════════════════════════════════════════════════════
function checkDefense() {
  if (!bot || !isDefending || !bot.entity || !bot.entity.position) return;
  if (actions.isAttacking()) return;

  const origin = bot.entity.position;
  const hostileNames = [
    'zombie', 'skeleton', 'creeper', 'spider', 'enderman',
    'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
    'pillager', 'vindicator', 'cave_spider', 'silverfish',
    'hoglin', 'zoglin', 'magma_cube'
  ];

  const targets = Object.values(bot.entities).filter(e => {
    if (!e.position || !e.isValid) return false;
    return hostileNames.indexOf((e.name || '').toLowerCase()) !== -1 &&
           e.position.distanceTo(origin) <= 6;
  });

  if (targets.length > 0) {
    targets.sort((a, b) =>
      origin.distanceSquared(a.position) - origin.distanceSquared(b.position));
    actions.doAttackOne(bot, targets[0]);
  }
}
 









// ═══════════════════════════════════════════════════════════════
//  connectToServer — создаёт бота и вешает все обработчики
// ═══════════════════════════════════════════════════════════════
// ── Проверка доступности сервера ──
const net = require('net');

function checkServerAvailable(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}


async function connectToServer(host, port) {
  // ── Очистка старого подключения ──
  if (bot) {
    try { bot.quit(); } catch (e) {}
    bot = null;
  }
  isDefending = false;
  autoDefend = true;
  if (defenseCheckInterval) { clearInterval(defenseCheckInterval); defenseCheckInterval = null; }
  if (inventoryCheckInterval) { clearInterval(inventoryCheckInterval); inventoryCheckInterval = null; }
  lastFood = -1;

  // ── Предварительная проверка сервера ──
  console.log(`\n🔗 Проверяю сервер ${host}:${port}...`);
  const available = await checkServerAvailable(host, port);

  if (!available) {
    console.log('❌ Не удалось подключиться к серверу (нет связи с сервером)');
    console.log('📝 /reconnect — попробовать снова');
    console.log('📝 /connect <ip> [port] — другой сервер');
    console.log('📝 Или просто общайтесь со мной через консоль (без /)\n');
    return;
  }

  console.log(`✅ Сервер доступен, подключаюсь...`);
  isConnecting = true;

  bot = mineflayer.createBot({
    host: host,
    port: port,
    username: config.BOT_NAME,
    version: config.GAME_VER,
    physicsEnabled: true,
    auth: 'offline'
  });

  bot.loadPlugin(pathfinder);
  bot.goals = goals;
  bot.movements = null;

  let connTimeout = setTimeout(() => {
    if (isConnecting) onConnectFailed();
  }, 10000);

  function onConnectFailed() {
    clearTimeout(connTimeout);
    isConnecting = false;
    try { bot.quit(); } catch (e) {}
    bot = null;
    console.log('❌ Не удалось подключиться к серверу (нет связи с сервером)');
    console.log('📝 /reconnect — попробовать снова');
    console.log('📝 /connect <ip> [port] — другой сервер');
    console.log('📝 Или просто общайтесь со мной через консоль (без /)\n');
  }













// ═══ Spawn ═══
  bot.once('spawn', () => {
    clearTimeout(connTimeout);
    isConnecting = false;
    console.log('✅ ' + config.BOT_NAME + ' заспавнилась');

    const mcData = require('minecraft-data')(bot.version);
    bot.movements = new Movements(bot, mcData);
    bot.movements.canDig = true;
    bot.movements.allowSprinting = true;
    bot.pathfinder.setMovements(bot.movements);

    mcAI.attach(bot);
    actions.init(bot, config, utils);

    setTimeout(() => {
      try {
        global.say('/attribute ' + config.BOT_NAME + ' minecraft:scale base set 0.9');
        console.log('🔧 Хитбокс исправлен (scale 0.9)');
      } catch (e) {}
    }, 1000);

    if (inventoryCheckInterval) clearInterval(inventoryCheckInterval);
    inventoryCheckInterval = setInterval(() => {
      actions.checkInventorySpace(bot);
    }, 15000);

    setTimeout(() => {
      global.say('Привет всем! Кто со мной поиграет?');
    }, 2000);
  });













  // ═══ Chat ═══
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;

    // Если админ задал себе псевдоним — используем его для репутации/промпта
    const effectiveNick = global.MY_PLAYER_NICK || username;
    // ── 1. Сначала анализируем и меняем репутацию ──
    const repLevel = reputation.analyzeMessage(username, message);

    // ── 2. Проверка на «игнор» при низкой репутации ──
    if (repLevel <= -60 && Math.random() < 0.4) {
      const snubs = [
        'Игнорирует тебя. Слишком обижена.',
        'Отворачивается. Разговаривать не намерена.',
        'Фыркает и молчит.'
      ];
    global.say(snubs[Math.floor(Math.random() * snubs.length)]);
    return; // дальше не идём
  }



    const msgLower = message.toLowerCase();





    // ── Режим защиты ──
    if (/защищайся|охраняй|защищай|обороняйся|guard|defend/i.test(msgLower)) {
      if (isDefending) { global.say('Режим защиты уже включён.'); return; }
      isDefending = true;
      global.say('🛡️ Включён режим защиты.');
      if (defenseCheckInterval) clearInterval(defenseCheckInterval);
      defenseCheckInterval = setInterval(checkDefense, 400);
      return;
    }
    if (/не защищайся|защита выкл|auto defend off/i.test(msgLower)) {
      isDefending = false;
      if (defenseCheckInterval) { clearInterval(defenseCheckInterval); defenseCheckInterval = null; }
      global.say('🛡️ Режим защиты выключен.');
      return;
    }

    const handled = await commands.handleChat(bot, username, message);
    if (handled) return;

    const reply = await llm.ask({
      source: 'mc',
      nick: username,
      userMessage: message,
      bot: bot,
      relationship: reputation.getRelationshipDescription(username)  // ← добавить это
    });
    if (!reply) return;

    let cleanText = reply.replace(/$$([^$$]+)\]/g, '').replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      const fallbacks = ['Да-да, я тут.', 'Че сказал? Задумалась.', 'Ммм, поняла.', 'Окей.'];
      cleanText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    if (cleanText.length > 240) {
      const parts = cleanText.match(/.{1,240}/g);
      parts.forEach((part, i) => {
        setTimeout(() => global.say(part.trim()), i * 600);
      });
    } else {
      global.say(cleanText);
    }
  });











// ═══════════════════════════════════════════════════════════════
//  Авто-защита при уроне
//  ИСПРАВЛЕНО: передаём объект сущности (attacker), а не строку
//  ИСПРАВЛЕНО: используем combatActions.autoDefend для кулдауна
//  (через actions, т.к. мы не импортируем combat напрямую)
// ═══════════════════════════════════════════════════════════════
  bot.on('health', () => {
    if (!autoDefend || actions.isAttacking()) return;

    const origin = bot.entity.position;
    const attacker = Object.values(bot.entities).find(e => {
      if (!e.position || !e.isValid) return false;
      const hostile = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman',
                       'witch', 'drowned', 'husk', 'stray', 'phantom',
                       'pillager', 'cave_spider', 'slime', 'magma_cube', 'silverfish'];
      return hostile.indexOf((e.name || '').toLowerCase()) !== -1 &&
             e.position.distanceTo(origin) <= 5;
    });

    if (attacker) {
      console.log('🛡️ Атакован! Отбиваюсь от: ' + (attacker.name || 'моб'));
      actions.doAttackOne(bot, attacker);
    }

    const food = bot.food;
    if (food === undefined || lastFood === food) return;
    lastFood = food;
    if (food <= 5 && food > 0) {
      global.say('Блин, я почти умираю от голода! меньше 5 осталось. Щас чекну еду...');
      actions.tryEatFood(bot);
    }
  });




// ═══ Error ═══
  bot.on('error', (err) => {
    const msg = err.message || '';
    const code = err.code || '';
    if (msg.includes('PartialReadError')) {
      if (!partialReadErrorLogged) {
        console.warn('⚠️ PartialReadError (сервер шлёт непонятные пакеты). Бот продолжит работу.');
        partialReadErrorLogged = true;
      }
      return;
    }
    if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
      onConnectFailed();
      return;
    }
    console.error('❌ Ошибка бота:', err);
  });

  // ═══ End ═══
  bot.on('end', () => {
    if (defenseCheckInterval) { clearInterval(defenseCheckInterval); defenseCheckInterval = null; }
    if (inventoryCheckInterval) { clearInterval(inventoryCheckInterval); inventoryCheckInterval = null; }
    bot = null;
    if (!isConnecting) {
      console.log('🔌 Отключилась');
      console.log('📝 /reconnect — попробовать снова');
      console.log('📝 Или общайтесь со мной через консоль (без /)\n');
    }
  });

  // ═══ Kicked ═══
  bot.on('kicked', reason => console.log('🚪 Кикнута:', reason));
}
















// ═══════════════════════════════════════════════════════════════
//  Консольный интерфейс
// ═══════════════════════════════════════════════════════════════
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});








function showHelp() {
  console.log('📋 Команды консоли:');
  console.log('  /reconnect          — переподключиться к серверу');
  console.log('  /connect <ip> [port]— подключиться к другому серверу');
  console.log('  /disconnect         — отключиться от сервера');
  console.log('  /status             — статус бота');
  console.log('  /help               — эта справка');
  console.log('  /rep <ник>             — репутация игрока');
  console.log('  /rep <ник> set <число> — установить репутацию');
  console.log('  /rep <ник> reset       — сбросить репутацию');
  console.log('  Любой текст без /    — общение с ботом через LLM\n');
  console.log('  /setnick <ник>      — установить свой псевдоним для бота (репутация, тон)');
}






rl.on('line', (input) => {
  const trimmed = input.trim();
  if (!trimmed) { rl.prompt(); return; }


  // ── Команды (только через /) ──
  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'reconnect':
        connectToServer(config.SERVER_HOST, config.SERVER_PORT);
        break;

      case 'test-rep': {
        const nick = args[0] || 'TestPlayer';
        const level = reputation.changeRep(nick, 10, 'ручной тест');
        console.log(`💛 Тестовый плюс: репутация ${nick} = ${level}`);
        break;
      }

      case 'rep': {
        if (!args[0]) {
          console.log('ℹ️ Использование: /rep <ник> — посмотреть репутацию');
          console.log('ℹ️ /rep <ник> set <число> — установить');
          console.log('ℹ️ /rep <ник> reset — сбросить');
          break;
        }
        const nick = args[0];
        if (args[1] === 'set' && args[2]) {
          const val = reputation.setRep(nick, parseInt(args[2]));
          console.log(`💛 Репутация ${nick} установлена: ${val}`);
        } else if (args[1] === 'reset') {
          reputation.resetRep(nick);
          console.log(`💛 Репутация ${nick} сброшена: 0`);
        } else {
          const val = reputation.getRep(nick);
          const desc = reputation.getRelationshipDescription(nick);
          console.log(`💛 Репутация ${nick}: ${val > 0 ? '+' : ''}${val}`);
          console.log(`   ${desc}`);
        }
        break;
      }


      case 'setnick': {
        if (!args[0]) {
          console.log('ℹ️ Использование: /setnick <ник>');
          break;
        }
        const newNick = args[0].trim();
        if (newNick.length < 2 || newNick.length > 16) {
          console.log('❌ Ник должен быть от 2 до 16 символов.');
          break;
        }

        // Сохраняем псевдоним в конфиг/память (простой вариант — в глобальную переменную)
        global.MY_PLAYER_NICK = newNick;

        console.log(`✅ Теперь бот знает тебя как: ${newNick}`);
        console.log(`   Репутация теперь будет привязана к этому нику.`);
        break;
      }

      case 'connect': {
        if (!args[0]) {
          console.log('ℹ️ Использование: /connect <ip> [port]');
          break;
        }
        let host = args[0];
        let port = config.SERVER_PORT;
        if (host.includes(':')) {
          const [h, p] = host.split(':');
          host = h;
          port = parseInt(p) || config.SERVER_PORT;
        }
        if (args[1]) port = parseInt(args[1]) || config.SERVER_PORT;
        connectToServer(host, port);
        break;
      }

      case 'disconnect':
        if (bot) {
          bot.quit();
          console.log('🔌 Отключаюсь...');
        } else {
          console.log('ℹ️ Бот и так не подключён');
        }
        break;

      case 'status':
        if (isConnecting) {
          console.log('⏳ Подключаюсь...');
        } else if (bot && bot.entity) {
          console.log(`✅ Подключена к серверу`);
          console.log(`❤️  Здоровье: ${bot.health}, 🍖 Голод: ${bot.food}`);
          console.log(`📍 Позиция: ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`);
        } else {
          console.log('❌ Не подключена к серверу');
        }
        break;

      case 'help':
        showHelp();
        break;

      default:
        console.log(`❓ Неизвестная команда: /${cmd}`);
        showHelp();
    }
    rl.prompt();
    return;
  }

  // ── Обычный текст — общение с ботом через LLM ──
  handleConsoleChat(trimmed);
});







async function handleConsoleChat(text) {
  console.log(`👤 [Вы]: ${text}`);
  try {
    const reply = await llm.ask({
      source: 'mc',
      nick: 'Admin',
      userMessage: text,
      bot: bot
    });
    if (reply) {
      let cleanText = reply.replace(/$$([^$$]+)\]/g, '').replace(/\s+/g, ' ').trim();
      if (!cleanText) cleanText = 'Да-да, я тут.';
      global.say(cleanText);
    } else {
      console.log('🤖 (бот промолчал)');
    }
  } catch (e) {
    console.error('❌ LLM ошибка:', e.message);
  }
  rl.prompt();
}




// ═══════════════════════════════════════════════════════════════
//  Старт
// ═══════════════════════════════════════════════════════════════
connectToServer(config.SERVER_HOST, config.SERVER_PORT);
rl.prompt();