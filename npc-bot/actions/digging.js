// actions/digging.js — копание и заполнение
const config = require('../config');
const utils = require('../utils');
const Vec3 = require('vec3');

function init(bot, cfg, ut) {

}


let isDigging = false;



function parseDigCommand(message) {
  const lower = (message || '').toLowerCase().trim();

  // Закопать (заполнить блоками)
  if (/^закопай/.test(lower)) {
    // Вариант с именем блока: закопай x y z x2 y2 z2 stone_brick
    const m = lower.match(/закопай\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(.+)/);
    if (m) {
      return {
        type: 'fill',
        x1: parseInt(m[1]), y1: parseInt(m[2]), z1: parseInt(m[3]),
        x2: parseInt(m[4]), y2: parseInt(m[5]), z2: parseInt(m[6]),
        blockName: m[7].trim()
      };
    }
    // Вариант без имени блока (по умолчанию stone)
    const m2 = lower.match(/закопай\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
    if (m2) {
      return {
        type: 'fill',
        x1: parseInt(m2[1]), y1: parseInt(m2[2]), z1: parseInt(m2[3]),
        x2: parseInt(m2[4]), y2: parseInt(m2[5]), z2: parseInt(m2[6]),
        blockName: 'stone'
      };
    }
    return null;
  }

  // Выкопать коробку
  if (/^выкопай/.test(lower)) {
    const m = lower.match(/выкопай\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
    if (!m) return null;
    return {
      type: 'box',
      x1: parseInt(m[1]), y1: parseInt(m[2]), z1: parseInt(m[3]),
      x2: parseInt(m[4]), y2: parseInt(m[5]), z2: parseInt(m[6])
    };
  }

  // Копать туннель (x y z yaw длина)
  if (/^копай/.test(lower)) {
    const m = lower.match(/копай\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)/);
    if (!m) return null;
    return {
      type: 'tunnel',
      x: parseInt(m[1]), y: parseInt(m[2]), z: parseInt(m[3]),
      yaw: parseInt(m[4]),
      blockCount: Math.min(parseInt(m[5]), 500)
    };
  }

  return null;
}

async function doDig(bot, params, sayFunc) {
  if (isDigging) {
    sayFunc('⛏️ Я уже копаю! Скажи "стоп копать".');
    return;
  }
  isDigging = true;

  if (params.type === 'box') {
    const minY = Math.min(params.y1, params.y2);
    const maxY = Math.max(params.y1, params.y2);
    if (minY < -64 || maxY > 320) {
      sayFunc('⛏️ Ошибка: Y вне мира.');
      isDigging = false;
      return;
    }
  }

  const blocks = [];

  if (params.type === 'box') {
    const minX = Math.min(params.x1, params.x2);
    const maxX = Math.max(params.x1, params.x2);
    const minY = Math.min(params.y1, params.y2);
    const maxY = Math.max(params.y1, params.y2);
    const minZ = Math.min(params.z1, params.z2);
    const maxZ = Math.max(params.z1, params.z2);

    const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (volume > 5000) {
      sayFunc('⛏️ Слишком большой объём — ' + volume + '. Максимум 5000 блоков.');
      isDigging = false;
      return;
    }

    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          blocks.push(new Vec3(x, y, z));

    sayFunc('⛏️ Копаю от ' + minX + ' ' + minY + ' ' + minZ + ' до ' + maxX + ' ' + maxY + ' ' + maxZ);
  }

  if (params.type === 'tunnel') {
    const dx = Math.cos(params.yaw * Math.PI / 180);
    const dz = Math.sin(params.yaw * Math.PI / 180);
    for (let i = 0; i < params.blockCount; i++) {
      const x = Math.floor(params.x + dx * i);
      const z = Math.floor(params.z + dz * i);
      blocks.push(new Vec3(x, params.y, z));
    }
    sayFunc('⛏️ Рою туннель длиной ' + params.blockCount + ' блоков.');
  }

  // Проходим по блокам и ломаем их
  for (const pos of blocks) {
    if (!isDigging) break;

    const block = bot.blockAt(pos);
    if (!block || block.name === 'air' || block.name === 'water' || block.name === 'lava') continue;

    // Идём к блоку
    try {
      bot.pathfinder.setGoal(new bot.goals.GoalNear(pos.x, pos.y, pos.z, 1.2));
    } catch (e) { continue; }

    await new Promise((resolve, reject) => {
      let timeoutHit = false;
      const timeoutId = setTimeout(() => {
        timeoutHit = true;
        bot.pathfinder.setGoal(null);
        resolve();
      }, 6000);

      bot.once('goal_reached', () => {
        if (timeoutHit) return;
        clearTimeout(timeoutId);
        // Ломаем блок
        try {
          bot.dig(block);
        } catch (e) {}
        setTimeout(resolve, 800); // ждём, чтобы блок начал ломаться
      });

      bot.once('no_path', () => {
        if (timeoutHit) return;
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  isDigging = false;
  sayFunc('⛏️ Готово, копать закончила.');
}

async function doFill(bot, params, sayFunc) {
  if (isDigging) {
    sayFunc('🧱 Я сейчас занята. Сначала закончим текущее действие.');
    return;
  }
  isDigging = true;

  const minX = Math.min(params.x1, params.x2);
  const maxX = Math.max(params.x1, params.x2);
  const minY = Math.min(params.y1, params.y2);
  const maxY = Math.max(params.y1, params.y2);
  const minZ = Math.min(params.z1, params.z2);
  const maxZ = Math.max(params.z1, params.z2);

  const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  if (volume > 5000) {
    sayFunc('🧱 Слишком большой объём для заполнения — ' + volume + '. Максимум 5000 блоков.');
    isDigging = false;
    return;
  }

  sayFunc('🧱 Заполняю область блоками ' + params.blockName);

  const blockType = params.blockName; // например, 'stone_brick'

  // Сначала проверяем, есть ли такой блок в игре (чтобы не ставить несуществующие)
  try {
    const testBlock = bot.registry.blocksByName[blockType];
    if (!testBlock) {
      sayFunc('⚠️ Неизвестный блок: ' + blockType);
      isDigging = false;
      return;
    }
  } catch (e) {
    sayFunc('⚠️ Ошибка проверки блока: ' + e.message);
    isDigging = false;
    return;
  }

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (!isDigging) break;

        const pos = new Vec3(x, y, z);
        const currentBlock = bot.blockAt(pos);

        // Если блок уже нужный — пропускаем
        if (currentBlock && currentBlock.name === blockType) continue;

        // Если тут воздух — ставим блок
        if (!currentBlock || currentBlock.name === 'air') {
          try {
            await bot.setBlock(pos, blockType);
          } catch (e) {
            // Если не можем поставить (например, мешает сущность) — просто пропускаем
          }
          continue;
        }

        // Если тут другой блок — сначала ломаем, потом ставим
        try {
          await bot.dig(currentBlock);
        } catch (e) {
          // Игнорируем ошибки копания
        }

        // Ждём, пока блок сломается (чтобы игра успела обновить состояние)
        await new Promise(resolve => setTimeout(resolve, 400));

        try {
          await bot.setBlock(pos, blockType);
        } catch (e) {
          // Если не получилось поставить — тоже пропускаем
        }
      }
      if (!isDigging) break;
    }
    if (!isDigging) break;
  }

  isDigging = false;
  sayFunc('🧱 Готово! Область заполнена блоками ' + blockType + '.');
}

function handleDigCommand(bot, message) {
  const params = parseDigCommand(message);
  if (!params) {
    global.say('Не поняла команду. Попробуй: выкопай x y z x2 y2 z2, копай x y z yaw длина, закопай x y z x2 y2 z2 [блок].');
    return;
  }

  if (params.type === 'fill') {
    doFill(bot, params, bot.chat.bind(bot));
  } else {
    doDig(bot, params, bot.chat.bind(bot));
  }
}

function getIsDigging() {
  return isDigging;
}

function setIsDigging(v) {
  isDigging = v;
}

module.exports = {
  init,
  parseDigCommand,
  doDig,
  doFill,
  handleDigCommand,
  getIsDigging,
  setIsDigging
};

