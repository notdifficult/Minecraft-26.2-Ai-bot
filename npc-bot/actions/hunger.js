// actions/hunger.js — голод и еда

const config = require('../config');
const utils = require('../utils');
const Vec3 = require('vec3');

function init(bot, cfg, ut) {
  // ничего не делаем, конфиг и утилиты уже подключены
}

function checkHunger(bot) {
  const food = bot.food;
  if (!food) {
    global.say('Нет данных о голоде (сервер не отдаёт FoodStats).');
    return;
  }

  const hungerLevel = food.hunger; // 0–20
  const saturation = food.saturation;

  let msg = `Голод: ${hungerLevel}/20, насыщенность: ${saturation.toFixed(1)}`;

  if (hungerLevel <= 6) msg += ' ⚠️ Пора поесть!';
  else if (hungerLevel <= 12) msg += ' 🍗 Скоро проголодаешься.';
  else msg += ' 😊 Всё ок.';

  global.say(msg);
}

async function tryEatFood(bot) {
  const items = bot.inventory.items();
  
  // Список еды (по именам блоков/предметов)
  const foodList = [
    'steak', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon',
    'bread', 'cake', 'cookie', 'apple', 'golden_apple', 'carrot', 'potato',
    'beetroot', 'melon_slice', 'suspicious_stew'
  ];

  // Ищем первую еду из списка в инвентаре
  let foodItem = null;
  for (const item of items) {
    if (foodList.includes(item.name)) {
      foodItem = item;
      break;
    }
  }

  if (!foodItem) {
    global.say('У меня нет еды в инвентаре.');
    return;
  }

  try {
    // 1. Берём еду в руку
    await bot.equip(foodItem.type, 'hand');
    
    // 2. Ждём 100 мс, чтобы игра успела обновить слот
    await new Promise(r => setTimeout(r, 100));

    // 3. Нажимаем ПКМ (в mineflayer это делается через клик)
    // В новых версиях mineflayer для еды достаточно просто держать предмет и ждать анимации,
    // но самый надёжный способ — эмулировать клик.
    bot.activateItem();

    global.say(`Поела: ${foodItem.name}`);
  } catch (e) {
    console.error('Ошибка при попытке поесть:', e);
    global.say('Не смогла поесть: ' + e.message);
  }
}

module.exports = {
  init,
  checkHunger,
  tryEatFood
};