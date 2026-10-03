const config = require('../config');
const utils = require('../utils');
const Vec3 = require('vec3');

let isAttacking = false;
let lastDefendTime = 0;
let lastTargetEntity = null;
let prevHealth = 20;
let revengeList = []; // массив { entity, id, name, addedAt } // ── Лист мести: запоминаем всех, кто атаковал бота ──
let lastDamageSourceId = null;  // ID сущности, которая нанесла последний урон
let damagePacketDebug = false; // Логировать пакет один раз для отладки
let unreachableIds = []; // ID мобов, к которым не удалось дойти

const HOSTILE_NAMES = [
  'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime',
  'enderman', 'blaze', 'ghast', 'magma_cube', 'silverfish',
  'cave_spider', 'guardian', 'elder_guardian', 'shulker',
  'vindicator', 'evoker', 'pillager', 'ravager', 'hoglin',
  'zoglin', 'piglin_brute', 'warden', 'wither', 'drowned',
  'husk', 'stray', 'phantom', 'breeze', 'creaking'
];



function init(bot, cfg, ut) {
  bot.on('health', () => {
    if (bot.ended) return;
    const currentHP = bot.health;
    if (currentHP < prevHealth && currentHP > 0) {
      console.log('💔 Получен урон! HP: ' + prevHealth + ' → ' + currentHP);
      autoDefend(bot);
    }
    prevHealth = currentHP;
  });

  // ── Ловим атакующего из пакета damage_event ──
  if (bot._client) {
    bot._client.on('damage_event', (packet) => {
      if (!bot.entity) return;
      if (packet.entityId !== bot.entity.id) return;

      // Логируем весь пакет один раз для отладки
      if (!damagePacketDebug) {
        damagePacketDebug = true;
        console.log('📦 damage_event пакет (первый раз): ' + JSON.stringify(packet));
      }

      // Пытаемся найти ID атакующего во всех возможных полях
      const possibleFields = [
        'sourceCauseId', 'sourceDirectId', 'directCauseId',
        'sourceId', 'causeId', 'attackerId'
      ];

      let sourceId = -1;
      for (const field of possibleFields) {
        if (packet[field] !== undefined && packet[field] > 0) {
          sourceId = packet[field];
          console.log('🎯 Найден источник урона в поле ' + field + ' = ' + sourceId);
          break;
        }
      }

      // Если нашли — запоминаем
      if (sourceId > 0) {
        lastDamageSourceId = sourceId;

        // Проверяем, есть ли эта сущность
        let ent = bot.entities[sourceId];
        if (!ent) {
          // Пробуем sourceId - 1 (на некоторых версиях ID сдвинут на 1)
          ent = bot.entities[sourceId - 1];
          if (ent) {
            lastDamageSourceId = sourceId - 1;
            console.log('🎯 Сущность найдена со сдвигом -1: ' + lastDamageSourceId);
          }
        }
        if (!ent) {
          // Пробуем sourceId + 1
          ent = bot.entities[sourceId + 1];
          if (ent) {
            lastDamageSourceId = sourceId + 1;
            console.log('🎯 Сущность найдена со сдвигом +1: ' + lastDamageSourceId);
          }
        }

        if (ent) {
          const name = ent.name || ent.username || 'unknown';
          console.log('🎯 Источник урона: ' + name + ' (entityId: ' + lastDamageSourceId + ')');
        } else {
          console.log('⚠️ sourceId=' + sourceId + ', но сущность не найдена в bot.entities. Доступные ID: ' +
            Object.keys(bot.entities).slice(0, 20).join(', '));
        }
      } else {
        console.log('⚠️ В пакете damage_event не найден ID атакующего. Поля: ' + JSON.stringify(packet));
      }
    });
  }

  // ── entityHurt — запасной способ ──
  bot.on('entityHurt', (entity, source) => {
    if (!entity || !bot.entity) return;
    if (entity.id !== bot.entity.id) return;

    if (source) {
      const sourceId = source.id || source.entityId;
      if (sourceId) {
        lastDamageSourceId = sourceId;
        const name = source.name || source.username || 'unknown';
        console.log('🎯 [entityHurt] Источник урона: ' + name + ' (id: ' + sourceId + ')');
      }
    }
  });


  bot.on('end', () => {
    revengeList = [];
    lastDamageSourceId = null;
    damagePacketDebug = false;
    unreachableIds = [];
  });
}



function getIsAttacking() {
  return isAttacking;
}




function stopOtherActions(bot) {
  if (bot._followInterval) { clearInterval(bot._followInterval); bot._followInterval = null; }
  if (bot._wanderInterval) { clearTimeout(bot._wanderInterval); bot._wanderInterval = null; }
  bot._isWandering = false;
  try { bot.pathfinder.setGoal(null); } catch (e) {}
}





// ── Проверка: не стоит ли моб в бедроке ──
function isTrappedInBedrock(bot, pos) {
  try {
    const checks = [
      [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
      [0, -1, 0]
    ];

    let bedrockCount = 0;
    for (const [dx, dy, dz] of checks) {
      const block = bot.blockAt(pos.offset(dx, dy, dz));
      if (block && block.name === 'bedrock') {
        bedrockCount++;
      }
    }

    // Если 6+ блоков из 9 — бедрок, моб заперт
    if (bedrockCount >= 6) {
      console.log('🚫 Моб заперт в бедроке (блоков: ' + bedrockCount + '/9)');
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ── Проверка достижимости через pathfinder ──
function isReachable(bot, targetEntity) {
  if (!targetEntity || !targetEntity.position) return false;

  // 1. Проверка на бедрок
  if (isTrappedInBedrock(bot, targetEntity.position)) return false;

  // 2. Проверка через pathfinder — пробуем построить путь
  try {
    const Movements = require('mineflayer-pathfinder').Movements;
    const GoalNear = require('mineflayer-pathfinder').goals.GoalNear;
    const movements = new Movements(bot);
    const goal = new GoalNear(
      Math.floor(targetEntity.position.x),
      Math.floor(targetEntity.position.y),
      Math.floor(targetEntity.position.z),
      2
    );
    const result = bot.pathfinder.getPathTo(movements, goal, 2000);

    if (result && (result.status === 'success' || result.status === 'partial')) {
      return true;
    }
    console.log('🚫 Pathfinder не нашёл путь к ' + (targetEntity.name || 'мобу') + ' (status: ' + (result ? result.status : 'null') + ')');
    return false;
  } catch (e) {
    // Если pathfinder недоступен — считаем достижимым, проверим таймаутом
    return true;
  }
}





// ── Только мечи считаются оружием ──
function isHoldingWeapon(bot) {
  const item = bot.inventory.itemInHand;
  if (!item) return false;
  return item.name.endsWith('_sword');
}





function ensureWeapon(bot) {
  const items = bot.inventory.items();
  const swordPriority = [
    'netherite_sword', 'diamond_sword', 'iron_sword',
    'golden_sword', 'stone_sword', 'wooden_sword'
  ];

  for (const swordName of swordPriority) {
    const sword = items.find(i => i.name === swordName);
    if (sword) {
      bot.equip(sword, 'hand');
      return true;
    }
  }
  return false;
}





// ── Проверка и экипировка лучшего меча перед каждым ударом ──
function checkAndEquipWeapon(bot) {
  const heldItem = bot.inventory.itemInHand;

  // Если в руке уже лучший меч — не делаем ничего
  if (heldItem && heldItem.name.endsWith('_sword')) {
    // Проверяем, есть ли меч лучше
    const items = bot.inventory.items();
    const swordPriority = [
      'netherite_sword', 'diamond_sword', 'iron_sword',
      'golden_sword', 'stone_sword', 'wooden_sword'
    ];

    const heldIndex = swordPriority.indexOf(heldItem.name);
    if (heldIndex === -1) return;

    for (let i = 0; i < heldIndex; i++) {
      const better = items.find(item => item.name === swordPriority[i]);
      if (better) {
        try {
          bot.equip(better, 'hand');
          console.log('🗡️ Перехватила на меч получше: ' + better.name);
        } catch (e) {}
        return;
      }
    }
    return; // В руке лучший — ок
  }

  // В руке не меч — экипируем
  if (!ensureWeapon(bot)) {
    if (!bot._noWeaponWarned) {
      bot._noWeaponWarned = true;
      global.say('У меня нет меча!');
      setTimeout(() => { bot._noWeaponWarned = false; }, 10000);
    }
  }
}






function equipBestWeapon(bot) {
  if (isHoldingWeapon(bot)) return;
  if (!ensureWeapon(bot)) {
    if (!bot._noWeaponWarned) {
      bot._noWeaponWarned = true;
      global.say('У меня нет меча!');
      setTimeout(() => { bot._noWeaponWarned = false; }, 10000);
    }
  }
}





function doStopAttack(bot) {
  isAttacking = false;
  lastTargetEntity = null;
  stopOtherActions(bot);
  try { bot.pathfinder.setGoal(null); } catch (e) {}
  //global.say('Перестала атаковать.');
}












// Найти ближайшего враждебного моба
function findNearestHostile(bot, radius) {
  const origin = bot.entity.position;
  radius = radius || 32;

  const hostiles = Object.values(bot.entities).filter(e => {
    if (!e.position) return false;
    if (!e.isValid && e.isValid !== undefined) return false;
    if (e.type !== 'mob' && e.type !== 'hostile') return false;
    if (HOSTILE_NAMES.indexOf((e.name || '').toLowerCase()) === -1) return false;
    return origin.distanceTo(e.position) <= radius;
  });

  if (hostiles.length === 0) return null;

  hostiles.sort((a, b) =>
    origin.distanceSquared(a.position) - origin.distanceSquared(b.position)
  );
  return hostiles[0];
}








// ── Поиск ВСЕХ враждебных мобов в радиусе ──
function findAllHostiles(bot, radius) {
  const origin = bot.entity.position;
  radius = radius || 32;

  const hostiles = Object.values(bot.entities).filter(e => {
    if (!e.position) return false;
    if (!e.isValid && e.isValid !== undefined) return false;
    if (e.type !== 'mob' && e.type !== 'hostile') return false;
    if (HOSTILE_NAMES.indexOf((e.name || '').toLowerCase()) === -1) return false;
    return origin.distanceTo(e.position) <= radius;
  });

  return hostiles;
}







// ── Добавление в лист мести ──
function addToRevengeList(entity) {
  if (!entity || !entity.id) return;
  const exists = revengeList.find(r => r.id === entity.id);
  if (exists) return;

  const name = entity.name || entity.username || 'unknown';
  revengeList.push({
    entity: entity,
    id: entity.id,
    name: name,
    addedAt: Date.now()
  });
  console.log('📜 Добавлен в лист мести: ' + name + ' (id: ' + entity.id + ', всего: ' + revengeList.length + ')');
}

// ── Очистка мёртвых/исчезнувших ──
function cleanRevengeList(bot) {
  const before = revengeList.length;
  revengeList = revengeList.filter(r => {
    const ent = bot.entities[r.id];
    if (!ent) return false;
    if (ent.isValid === false) return false;
    if (!ent.position) return false;
    r.entity = ent;
    return true;
  });

  if (revengeList.length !== before) {
    console.log('📜 Лист мести после очистки: ' + before + ' → ' + revengeList.length);
  }
}






// ── Ближайшая цель из листа мести ──
function findNearestFromRevengeList(bot) {
  cleanRevengeList(bot);
  if (revengeList.length === 0) return null;

  const origin = bot.entity.position;
  let nearest = null;
  let nearestDist = Infinity;

  for (const r of revengeList) {
    if (!r.entity || !r.entity.position) continue;

    // Пропускаем недостижимых
    if (unreachableIds.includes(r.id)) continue;

    const dist = origin.distanceSquared(r.entity.position);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = r.entity;
    }
  }

  // Если все в списке недостижимы — вернём null
  if (!nearest && revengeList.length > 0) {
    console.log('🚫 Все цели из листа мести недостижимы (' + unreachableIds.length + ' в чёрном списке)');
  }

  return nearest;
}


















// ── Авто-защита ──
function autoDefend(bot) {
  if (isAttacking) {
    if (lastDamageSourceId) {
      const ent = bot.entities[lastDamageSourceId];
      if (ent) {
        addToRevengeList(ent);
        console.log('🎯 Новый атакующий добавлен: ' +
          (ent.name || ent.username || 'unknown') +
          ' (всего: ' + revengeList.length + ')');

        // ── Проверяем, не ближе ли новый атакующий текущей цели ──
        if (lastTargetEntity && lastTargetEntity.position && ent.position) {
          const distCurrent = bot.entity.position.distanceSquared(lastTargetEntity.position);
          const distNew = bot.entity.position.distanceSquared(ent.position);
          // Если новый на 4+ блока ближе — переключаемся
          if (distNew + 16 < distCurrent) {
            console.log('🔄 Переключаюсь на более близкого: ' +
              (ent.name || 'unknown') + ' (был ' + Math.sqrt(distCurrent).toFixed(1) +
              ', стал ' + Math.sqrt(distNew).toFixed(1) + ')');
            isAttacking = false; // Прерываем текущую атаку
            lastTargetEntity = null;
            try { bot.pathfinder.setGoal(null); } catch (e) {}
            // doAttackOne завершится, autoDefend вызовется снова через health
            setTimeout(() => {
              if (!isAttacking && !bot.ended) {
                const target = findNearestFromRevengeList(bot);
                if (target) doAttackOne(bot, target);
              }
            }, 300);
          }
        }
      }
      lastDamageSourceId = null;
    }
    return;
  }

  const now = Date.now();
  if (now - lastDefendTime < 1000) return;
  lastDefendTime = now;

  if (lastDamageSourceId) {
    const attacker = bot.entities[lastDamageSourceId];
    if (attacker) {
      addToRevengeList(attacker);
      console.log('🎯 Атакующий добавлен: ' +
        (attacker.name || attacker.username || 'unknown'));
    }
    lastDamageSourceId = null;
  } else {
    const nearest = findNearestHostile(bot, 16);
    if (nearest) {
      addToRevengeList(nearest);
      console.log('⚠️ Источник не определён, добавляю ближайшего: ' +
        (nearest.name || 'unknown'));
    } else {
      console.log('⚠️ Получен урон, но не удалось найти атакующего');
      return;
    }
  }

  cleanRevengeList(bot);

  if (revengeList.length === 0) {
    console.log('⚠️ Лист мести пуст');
    return;
  }

  const target = findNearestFromRevengeList(bot);
  if (!target) {
    console.log('⚠️ Все цели недостижимы или исчезли');
    return;
  }

  console.log('🛡️ Атакован! Цель: ' + (target.name || 'unknown') +
    ' (дистанция ' + bot.entity.position.distanceTo(target.position).toFixed(1) +
    ', в листе мести: ' + revengeList.length + ')');
  doAttackOne(bot, target);
}






// ── Получение HP моба ──
function getEntityHealth(entity) {
  if (entity.health !== undefined && entity.health !== null) {
    return entity.health;
  }
  if (entity.metadata) {
    for (let i = 0; i < entity.metadata.length; i++) {
      if (typeof entity.metadata[i] === 'number' && entity.metadata[i] >= 0 && entity.metadata[i] <= 20) {
        return entity.metadata[i];
      }
    }
  }
  return '?';
}







// ── Атака одной цели ──
async function doAttackOne(bot, target) {
  if (isAttacking) return;

  isAttacking = true;
  stopOtherActions(bot);
  checkAndEquipWeapon(bot);

  if (!target || !target.position) {
    isAttacking = false;
    return;
  }

  // ── Проверяем достижимость перед стартом ──
  if (!isReachable(bot, target)) {
    console.log('🚫 Цель недостижима, пропускаю: ' + (target.name || 'unknown'));
    if (!unreachableIds.includes(target.id)) {
      unreachableIds.push(target.id);
    }
    isAttacking = false;
    // Берём следующего из листа
    const nextTarget = findNearestFromRevengeList(bot);
    if (nextTarget) {
      setTimeout(() => {
        if (!isAttacking && !bot.ended) doAttackOne(bot, nextTarget);
      }, 300);
    }
    return;
  }

  lastTargetEntity = target;
  const entity = target;

  let attackLoops = 0;
  const maxLoops = 50;
  let attackCount = 0;
  let approachTime = 0; // Время в попытках подойти

  while (isAttacking && attackLoops < maxLoops) {
    attackLoops++;

    if (!entity || !entity.position) {
      revengeList = revengeList.filter(r => r.id !== (entity ? entity.id : -1));
      break;
    }

    if (entity.isValid === false) {
      revengeList = revengeList.filter(r => r.id !== entity.id);
      // Убираем из недостижимых тоже
      unreachableIds = unreachableIds.filter(id => id !== entity.id);
      break;
    }

    const dist = bot.entity.position.distanceTo(entity.position);

    if (dist > 32) {
      revengeList = revengeList.filter(r => r.id !== entity.id);
      break;
    }

    // ── Проверяем, не подошёл ли кто-то ближе ──
    if (attackCount > 0 && attackLoops % 5 === 0) {
      const closerTarget = findNearestFromRevengeList(bot);
      if (closerTarget && closerTarget.id !== entity.id) {
        const distCloser = bot.entity.position.distanceTo(closerTarget.position);
        if (distCloser + 3 < dist) {
          console.log('🔄 Переключаюсь на более близкого: ' +
            (closerTarget.name || 'unknown') + ' (' + distCloser.toFixed(1) +
            ' < ' + dist.toFixed(1) + ')');
          isAttacking = false;
          try { bot.pathfinder.setGoal(null); } catch (e) {}
          setTimeout(() => {
            if (!isAttacking && !bot.ended) doAttackOne(bot, closerTarget);
          }, 300);
          return;
        }
      }
    }

    if (dist <= 3.5) {
      approachTime = 0; // Сброс — мы рядом
      try {
        checkAndEquipWeapon(bot);
        await bot.lookAt(entity.position.offset(0, 1, 0));
        const hpBefore = getEntityHealth(entity);
        bot.attack(entity);
        attackCount++;
        const hpAfter = getEntityHealth(entity);
        console.log('⚔️ Удар #' + attackCount + ' по ' + (entity.name || 'мобу') +
          ' | HP: ' + hpBefore + ' → ' + hpAfter);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    } else {
      approachTime++;
      // ── Если не можем дойти 10 циклов (~30 сек) — помечаем недостижимым ──
      if (approachTime > 10) {
        console.log('🚫 Не могу дойти до ' + (entity.name || 'моба') + ' уже 30 сек, пропускаю');
        if (!unreachableIds.includes(entity.id)) {
          unreachableIds.push(entity.id);
        }
        revengeList = revengeList.filter(r => r.id !== entity.id);
        try { bot.pathfinder.setGoal(null); } catch (e) {}
        break;
      }

      try {
        bot.pathfinder.setGoal(new bot.goals.GoalFollow(entity, 2), true);
      } catch (e) {}

      const waitStart = Date.now();
      while (isAttacking && Date.now() - waitStart < 3000) {
        if (!entity || !entity.position || entity.isValid === false) {
          revengeList = revengeList.filter(r => r.id !== (entity ? entity.id : -1));
          break;
        }
        const d = bot.entity.position.distanceTo(entity.position);
        if (d <= 3.5) {
          try { bot.pathfinder.setGoal(null); } catch (e) {}
          break;
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  try { bot.pathfinder.setGoal(null); } catch (e) {}
  isAttacking = false;
  lastTargetEntity = null;
  console.log('✅ Атака завершена (' + attackCount + ' ударов, в листе мести: ' + revengeList.length + ')');

  // ── Берём следующего из листа ──
  cleanRevengeList(bot);
  if (revengeList.length > 0 && !isAttacking && !bot.ended) {
    const nextTarget = findNearestFromRevengeList(bot);
    if (nextTarget) {
      console.log('📜 Следующая цель: ' + (nextTarget.name || 'unknown') +
        ' (осталось: ' + revengeList.length + ')');
      setTimeout(() => {
        if (!isAttacking && !bot.ended) doAttackOne(bot, nextTarget);
      }, 400);
    }
  }
}








async function doAttackAll(bot) {
  if (isAttacking) {
    global.say('Я уже атакую!');
    return;
  }

  const origin = bot.entity.position;
  const radius = 10;

  const mobs = Object.values(bot.entities)
    .filter(e => (e.type === 'mob' || e.type === 'hostile') && e.position && origin.distanceTo(e.position) <= radius)
    .sort((a, b) => origin.distanceSquared(a.position) - origin.distanceSquared(b.position));

  if (mobs.length === 0) {
    global.say('Рядом нет мобов для атаки.');
    return;
  }

  for (const mob of mobs) {
    addToRevengeList(mob);
  }

  checkAndEquipWeapon(bot);
  global.say('Атакую ' + mobs.length + ' мобов!');

  for (let i = 0; i < mobs.length; i++) {
    if (!isAttacking) break;
    await doAttackOne(bot, mobs[i]);
    await new Promise(r => setTimeout(r, 300));
  }

  //global.say('Закончила атаку.');
}





// ── Очистка листа мести (внешний вызов) ──
function clearRevengeList() {
  revengeList = [];
  unreachableIds = [];
  console.log('📜 Лист мести и чёрный список очищены');
}

function getRevengeList() {
  return revengeList.map(r => r.name);
}




module.exports = {
  init,
  stopOtherActions,
  equipBestWeapon,
  isHoldingWeapon,
  ensureWeapon,
  doStopAttack,
  doAttackAll,
  doAttackOne,
  autoDefend,
  findNearestHostile,
  getIsAttacking,
  clearRevengeList,
  getRevengeList
};