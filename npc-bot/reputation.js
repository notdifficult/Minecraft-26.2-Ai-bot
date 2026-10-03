// ═══════════════════════════════════════════════════════════════
//  reputation.js — система отношений с игроками
//  Хранит: ник, уровень любви (от -100 до 100), дату последнего изменения
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const config = require('./config');

const REP_FILE = path.join(config.MEMORY_DIR, 'reputation.json');
const MIN_REP = -100;
const MAX_REP = 100;

let reputation = {};

// ── Загрузка/сохранение ──

if (!fs.existsSync(config.MEMORY_DIR)) {
  fs.mkdirSync(config.MEMORY_DIR, { recursive: true });
  console.log('✅ Создана папка памяти:', config.MEMORY_DIR);
}



function load() {
  try {
    if (fs.existsSync(REP_FILE)) {
      const raw = fs.readFileSync(REP_FILE, 'utf8').trim();

      // Если файл пустой — считаем, что репутации нет
      if (!raw) {
        console.warn('⚠️ Файл reputation.json пуст, начинаем с нуля.');
        reputation = {};
        return;
      }

      reputation = JSON.parse(raw);

      // Простая валидация: если распарсилось не в объект — сбрасываем
      if (typeof reputation !== 'object' || !reputation || Array.isArray(reputation)) {
        console.warn('⚠️ reputation.json повреждён, сбрасываем репутацию.');
        reputation = {};
      }
    } else {
      console.log('🆕 reputation.json не найден, создадим при первом изменении.');
      reputation = {};
    }
  } catch (e) {
    console.warn('⚠️ Не удалось загрузить репутацию: ' + e.message);
    console.warn('🗑️ Сбрасываем репутацию и создадим новый файл при следующем действии.');
    reputation = {};
  }
}


function save() {
  try {
    if (!fs.existsSync(config.MEMORY_DIR)) {
      fs.mkdirSync(config.MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(REP_FILE, JSON.stringify(reputation, null, 2));
    console.log('💾 Репутация сохранена:', REP_FILE); // <-- эта строка
  } catch (e) {
    console.warn('⚠️ Не удалось сохранить репутацию:', e.message);
  }
}


load();

// ── Получить репутацию игрока ──
function getRep(nick) {
  const key = nick.toLowerCase();
  if (!reputation[key]) {
    reputation[key] = {
      level: 0,
      nick: nick,
      lastChange: null
    };
  }
  return reputation[key].level;
}

// ── Изменить репутацию ──
function changeRep(nick, delta, reason) {
  const key = nick.toLowerCase();
  if (!reputation[key]) {
    reputation[key] = { level: 0, nick: nick, lastChange: null };
  }
  reputation[key].level = Math.max(MIN_REP, Math.min(MAX_REP, reputation[key].level + delta));
  reputation[key].nick = nick;
  reputation[key].lastChange = new Date().toISOString();
  save();

  const level = reputation[key].level;
  console.log(`💛 Репутация ${nick}: ${level > 0 ? '+' : ''}${level} (${delta > 0 ? '+' : ''}${delta}, ${reason})`);
  return level;
}

// ── Ключевые слова для анализа сообщений ──
const insultWords = [
  'иди нахуй', 'нахуй', 'иди на хуй', 'на хуй', 'пошёл нахуй', 'пошла нахуй',
  'тупая', 'дура', 'дерьмо', 'говно', 'уродина', 'тварь', 'сука', 'блядь',
  'шлюха', 'идиотка', 'мерзкая', 'заткнись', 'замолчи', 'ненавижу', 'тварь',
  'ублюдок', 'мразь', 'соси', 'сосать', 'отстой', 'бесполезная', 'хуже всех',
  'достала', 'заткнись уже', 'надоела', 'пошла вон', 'вон отсюда'
];

const complimentWords = [
  'спасибо', 'благодарю', 'ты лучшая', 'молодец', 'умница', 'хорошая',
  'милая', 'красивая', 'привет', 'хорошего дня', 'спасибо большое',
  'ты классная', 'обожаю', 'люблю', 'ты супер', 'ты огонь', 'ты крутая',
  'хорошо сделала', 'отлично', 'прекрасно', 'ты мне нравишься'
];

const apologyWords = [
  'прости', 'извини', 'извиняюсь', 'прости меня', 'прошу прощения',
  'я был не прав', 'извини пожалуйста', 'сори', 'sorry'
];

// ── Анализ сообщения и корректировка репутации ──
function analyzeMessage(nick, message) {
  const lower = message.toLowerCase();
  let delta = 0;
  let reason = '';

  // Проверка оскорблений (вес сильнее)
  let insultCount = 0;
  for (const word of insultWords) {
    if (lower.includes(word)) insultCount++;
  }
  if (insultCount > 0) {
    delta -= insultCount * 8;
    reason = 'оскорбление';
  }

  // Проверка извинений (если репутация ниже нуля — прощение)
  let apologyCount = 0;
  for (const word of apologyWords) {
    if (lower.includes(word)) apologyCount++;
  }
  if (apologyCount > 0) {
    delta += apologyCount * 5;
    reason = 'извинение';
  }

  // Проверка комплиментов
  let complimentCount = 0;
  for (const word of complimentWords) {
    if (lower.includes(word)) complimentCount++;
  }
  if (complimentCount > 0) {
    delta += complimentCount * 3;
    reason = reason || 'доброта';
  }

  if (delta !== 0) {
    return changeRep(nick, delta, reason);
  }

  return getRep(nick);
}

// ── Текстовое описание отношения для системного промпта ──
function getRelationshipDescription(nick) {
  const level = getRep(nick);
  const key = nick.toLowerCase();

  if (level <= -80) return `Игрок ${nick} — враг. Ты его ненавидишь и презираешь. Отвечаешь холодно, грубо, односложно. Не хочешь помогать.`;
  if (level <= -50) return `Игрок ${nick} — очень неприятный человек. Ты злишься на него. Отвечаешь раздражённо, неохотно.`;
  if (level <= -20) return `Игрок ${nick} тебя обидел. Ты обижаешься. Отвечаешь с прохладой, коротко, с сарказмом.`;
  if (level <= -5) return `Игрок ${nick} тебе немного не нравится. Отвечаешь сдержанно, без энтузиазма.`;
  if (level < 5) return `Игрок ${nick} — обычный игрок. Отвечаешь нейтрально.`;
  if (level < 20) return `Игрок ${nick} — знакомый, приятный. Отвечаешь дружелюбно.`;
  if (level < 50) return `Игрок ${nick} — хороший друг. Ты рада его видеть, отвечаешь тепло и открыто.`;
  if (level < 80) return `Игрок ${nick} — очень близкий друг. Ты очень рада ему, отвечаешь с нежностью и заботой.`;
  return `Игрок ${nick} — твой самый любимый человек. Ты обожаешь его, отвечаешь с огромной любовью и преданностью.`;
}

// ── Сброс репутации (админ-команда) ──
function resetRep(nick) {
  const key = nick.toLowerCase();
  if (reputation[key]) {
    reputation[key].level = 0;
    reputation[key].lastChange = new Date().toISOString();
    save();
  }
}

// ── Установка репутации вручную (админ-команда) ──
function setRep(nick, value) {
  const key = nick.toLowerCase();
  if (!reputation[key]) {
    reputation[key] = { level: 0, nick: nick, lastChange: null };
  }
  reputation[key].level = Math.max(MIN_REP, Math.min(MAX_REP, value));
  reputation[key].nick = nick;
  reputation[key].lastChange = new Date().toISOString();
  save();
  return reputation[key].level;
}

module.exports = {
  getRep,
  changeRep,
  analyzeMessage,
  getRelationshipDescription,
  resetRep,
  setRep
};
