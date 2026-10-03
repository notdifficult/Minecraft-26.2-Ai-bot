// ═══════════════════════════════════════════════════════════════
//  commands.js — обработка чат-команд
//  Возвращает true, если команда распознана (LLM не нужен)
//  Возвращает false, если команда не найдена (передать в LLM)
// ═══════════════════════════════════════════════════════════════

const actions = require('./actions');

async function handleChat(bot, username, message) {
  if (username === bot.username) return true;

  // Если бот восстанавливается после смерти — игнорируем команды
  if (actions.isRecovering && actions.isRecovering()) {
    global.say('Я сейчас занята, дойду до места и поговорим.');
    return true;
  }

  console.log('💬 ' + username + ': ' + message);
  const msgLower = message.toLowerCase();

  // ───────────────────────────────────────────
  //  КОПАНИЕ / ЗАКАПЫВАНИЕ
  // ───────────────────────────────────────────
  if (/^выкопай|^копай|^закопай/i.test(msgLower)) {
    if (/стоп|хватит|stop/i.test(msgLower)) {
      if (actions.isDigging()) {
        actions.setDigging(false);
        try { bot.pathfinder.setGoal(null); } catch (e) {}
        global.say('⛏️ Останавливаюсь.');
      } else {
        global.say('⛏️ Я сейчас не работаю.');
      }
      return true;
    }
    if (actions.isDigging()) {
      global.say('⛏️ Я уже занята! Скажи "стоп".');
      return true;
    }
    const params = actions.parseDigCommand(message);
    if (params) {
      if (params.type === 'fill') {
        actions.doFill(bot, params, global.say);
      } else {
        actions.doDig(bot, params, global.say);
      }
    }
    return true;
  }

  // ───────────────────────────────────────────
  //  АТАКА
  // ───────────────────────────────────────────
  if (/атакуй всех|бей всех|убей всех|attack all/i.test(msgLower)) {
    actions.doAttackAll(bot);
    return true;
  }

  if (/^(атакуй|бей|убей|attack)\s+/i.test(msgLower)) {
    const mobName = msgLower.replace(/^(атакуй|бей|убей|attack)\s+/i, '').trim();
    if (mobName) {
      const target = Object.values(bot.entities).find(e => {
        if (!e.position || !e.isValid) return false;
        return e.name && e.name.toLowerCase().includes(mobName);
      });
      if (target) {
        actions.doAttackOne(bot, target);
      } else {
        const player = bot.players[mobName];
        if (player && player.entity) {
          actions.doAttackOne(bot, player.entity);
        } else {
          global.say('Не вижу никого по имени "' + mobName + '".');
        }
      }
    } else {
      actions.doAttackAll(bot);
    }
    return true;
  }

  if (/хватит драться|перестань|отойди от боя|stop attack/i.test(msgLower)) {
    actions.doStopAttack(bot);
    return true;
  }

  // ───────────────────────────────────────────
  //  РЕЖИМ ЗАЩИТЫ
  // ───────────────────────────────────────────
  if (/защищайся|охраняй|защищай|обороняйся|guard|defend/i.test(msgLower)) {
    // Включение/выключение обработки в StartBot.js
    // Поэтому возвращаем false и пусть StartBot решает
    return false;
  }

  if (/не защищайся|защита выкл|auto defend off/i.test(msgLower)) {
    return false;
  }

  // ───────────────────────────────────────────
  //  СУНДУК
  // ───────────────────────────────────────────
  if (/выложи в сундук|выложи вещи|deposit all/i.test(msgLower)) {
    actions.depositAllExceptTools(bot);
    return true;
  }

  // ───────────────────────────────────────────
  //  ГОЛОД И ЕДА
  // ───────────────────────────────────────────
  if (/ты голодна|сколько голода|check hunger/i.test(msgLower)) {
    actions.checkHunger(bot);
    return true;
  }
  if (/поешь|ешь|eat/i.test(msgLower)) {
    actions.tryEatFood(bot);
    return true;
  }

  // ───────────────────────────────────────────
  //  ДВИЖЕНИЕ
  // ───────────────────────────────────────────
  if (/телепорт|тп|tp|телепортируй/i.test(msgLower)) {
    actions.doTeleport(bot);
    return true;
  }
  if (/иди\s+за|следуй|follow/i.test(msgLower)) {
    actions.doFollow(bot);
    return true;
  }
  if (/стой|стоп|stop|остановись|замри/i.test(msgLower)) {
    actions.doStop(bot);
    return true;
  }
  if (/подбери|собери|возьми|забери|собирай/i.test(msgLower)) {
    actions.doPickup(bot);
    return true;
  }
  if (/свободен|гуляй|отдыхай|свободна|wander/i.test(msgLower)) {
    actions.doWander(bot);
    return true;
  }

  // ───────────────────────────────────────────
  //  ИНВЕНТАРЬ
  // ───────────────────────────────────────────
  if (/сколько\s+(у\s+тебя|есть\s+у\s+тебя)/i.test(msgLower)) {
    actions.doCheckCount(bot, message);
    return true;
  }
  if (/брось|выброси|drop/i.test(msgLower)) {
    actions.doDrop(bot, message);
    return true;
  }
  if (/проверь инвентарь|сколько места|инвентарь/i.test(msgLower)) {
    actions.checkInventorySpace(bot);
    return true;
  }



  // ───────────────────────────────────────────
  //  НОВЫЕ КОМАНДЫ: ИДИ СЮДА / ИДИ ТУДА
  // ───────────────────────────────────────────
  // --- ИДИ СЮДА ---
  if (/^иди сюда$/i.test(msgLower)) {
    actions.goToPlayer(bot, username);
    return true;
  }

  // --- ИДИ ТУДА X Y Z ---
  const gotoMatch = msgLower.match(/^иди туда\s*[:\s]*(-?\d+)\s+(-?\d+)\s+(-?\d+)/i);
  if (gotoMatch) {
    const x = parseInt(gotoMatch[1], 10);
    const y = parseInt(gotoMatch[2], 10);
    const z = parseInt(gotoMatch[3], 10);
    actions.goToCoords(bot, x, y, z);
    return true;
  }

  // --- ИДИ ТУДА (без координат) ---
  if (/^иди туда/i.test(msgLower)) {
    actions.askForCoords();
    return true;
  }






  // ───────────────────────────────────────────
  //  КОМАНДА НЕ НАЙДЕНА — передаём в LLM
  // ───────────────────────────────────────────
  return false;
}

module.exports = { handleChat };
