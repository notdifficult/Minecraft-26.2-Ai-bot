// utils.js

// 2. utils.js — утилиты (поиск игрока, контекст, инвентарь, парсинг)
// Зачем: вынести всё, что не является «действием» или «LLM», чтобы код был читаемым. Сюда же помещаем логику поиска ближайшего игрока, контекст для промпта, парсеры команд.

const Vec3 = require('vec3');
const config = require('./config');





function getNearbyEntities(bot, radius = 20) {
  if (!bot.entity) return 'неизвестно';
  const nearby = Object.values(bot.entities)
    .filter(e =>
      e.position &&
      bot.entity.position.distanceTo(e.position) < radius &&
      e.name &&
      e.name !== bot.username
    )
    .map(e => e.name + '(' + Math.round(bot.entity.position.distanceTo(e.position)) + 'м)')
    .slice(0, 5);
  return nearby.join(', ') || 'никого рядом';
}





function getInventory(bot) {
  if (!bot.inventory) return 'пусто';
  const items = bot.inventory.items().map(i => i.name + ' x' + i.count);
  return items.join(', ') || 'пусто';
}





function buildContext(bot) {
  return {
    pos: bot.entity ? bot.entity.position.toString() : 'неизвестно',
    health: bot.entity ? Math.round(bot.health) : 0,
    nearbyEntities: getNearbyEntities(bot),
    inventory: getInventory(bot)
  };
}





function findNearestPlayer(bot) {
  const players = Object.values(bot.entities)
    .filter(e => e.username && e.username !== bot.username && e.position)
    .sort((a, b) =>
      bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));

  if (players.length > 0) {
    return { username: players[0].username, entity: players[0], position: players[0].position };
  }

  const fallback = Object.values(bot.players)
    .filter(p => p.username && p.username !== bot.username && p.entity && p.entity.position)
    .sort((a, b) =>
      bot.entity.position.distanceTo(a.entity.position) - bot.entity.position.distanceTo(b.entity.position));

  if (fallback.length > 0) {
    return {
      username: fallback[0].username,
      entity: fallback[0].entity,
      position: fallback[0].entity.position
    };
  }
  return null;
}





function findAnyPlayerName(bot) {
  const entityPlayers = Object.values(bot.entities).filter(e => e.username && e.username !== bot.username);
  if (entityPlayers.length > 0) return entityPlayers[0].username;

  const playerNames = Object.keys(bot.players).filter(name => name !== bot.username);
  if (playerNames.length > 0) return playerNames[0];
  return null;
}






function parseDropParams(message) {
  const msgLower = message.toLowerCase();
  let count = null;

  // сначала ищем числительные словами
  for (const word in config.NUMBER_WORDS) {
    if (msgLower.indexOf(word) !== -1) {
      count = config.NUMBER_WORDS[word];
      break;
    }
  }

  // если не нашли — ищем цифры
  if (count === null) {
    const match = msgLower.match(/(\d+)/);
    if (match) count = parseInt(match[1], 10);
  }

  if (count === null) count = 1;

  let itemId = null;
  const sortedKeys = Object.keys(config.ITEM_ALIASES).sort((a, b) => b.length - a.length);

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    if (msgLower.indexOf(key) !== -1) {
      itemId = config.ITEM_ALIASES[key];
      break;
    }
  }

  return { count, itemId };
}






function extractAllCommands(text) {
  if (!text) return { text, commands: [] };
  const commands = [];
  const cleanText = text.replace(/\[(.*?)\]/g, (match, cmd) => {
    commands.push(cmd.trim().toLowerCase());
    return '';
  });
  return { text: cleanText.replace(/\s+/g, ' ').trim(), commands };
}





module.exports = {
  getNearbyEntities,
  getInventory,
  buildContext,
  findNearestPlayer,
  findAnyPlayerName,
  parseDropParams,
  extractAllCommands
};
