// actions/DeathRecovery.js

let deathPos = null;
let isRecovering = false;
let attackerName = null;
let lastDamageTime = 0;


// ── Временная заглушка PartialReadError ──
let _originalConsoleError = null;
let muteUntil = 0;

function mutePartialReadError(seconds) {
  if (!_originalConsoleError) {
    _originalConsoleError = console.error;
  }

  muteUntil = Date.now() + seconds * 1000;

  console.error = function (...args) {
    const text = args.map(a =>
      a && a.message ? a.message : (typeof a === 'string' ? a : '')
    ).join(' ');

    if (text.includes('PartialReadError') && Date.now() < muteUntil) {
      return; // Глотаем
    }

    _originalConsoleError.apply(console, args);
  };

  // Восстанавливаем через N секунд
  setTimeout(() => {
    if (Date.now() >= muteUntil && _originalConsoleError) {
      console.error = _originalConsoleError;
    }
  }, seconds * 1000 + 500);
}



function init(bot, stopFunctions) {
  const stop = stopFunctions || {};

  // ── СПОСОБ 1: entityHurt — стандартное событие mineflayer ──
  bot.on('entityHurt', (entity, source) => {
    if (!entity || !bot.entity) return;
    if (entity.id !== bot.entity.id) return; // урон не нам — пропускаем

    lastDamageTime = Date.now();

    if (source) {
      const name = source.username || source.displayName || source.name || null;
      if (name && name !== bot.username) {
        attackerName = name;
        console.log('💥 Урон по мне от: ' + attackerName);
      }
    }
  });

  // ── СПОСОБ 2: сырой пакет damage_event — запасной, для 1.20+ ──
  if (bot._client) {
    bot._client.on('damage_event', (packet) => {
      if (!bot.entity) return;
      if (packet.entityId !== bot.entity.id) return;

      lastDamageTime = Date.now();

      // sourceCauseId — это ID + 1 сущности-источника (0 = нет источника)
      if (packet.sourceCauseId && packet.sourceCauseId > 0) {
        const sourceEntity = bot.entities[packet.sourceCauseId - 1];
        if (sourceEntity) {
          const name = sourceEntity.username || sourceEntity.displayName || sourceEntity.name || null;
          if (name && name !== bot.username) {
            attackerName = name;
            console.log('💥 [packet] Урон по мне от: ' + attackerName);
          }
        }
      }
    });
  }

  // ── СМЕРТЬ ──
  bot.on('death', () => {
    if (bot.ended) return;

    try {
      if (bot.entity && bot.entity.position) {
        deathPos = bot.entity.position.clone();
        mutePartialReadError(8); // ← Глушим на 8 секунд с момента смерти
        console.log('💀 Запомнила место смерти: X=' + Math.floor(deathPos.x) + ', Y=' + Math.floor(deathPos.y) + ', Z=' + Math.floor(deathPos.z));
      } else {
        deathPos = null;
        return;
      }

      try { if (stop.stopDigging) stop.stopDigging(); } catch (e) {}
      try { if (stop.stopAttack) stop.stopAttack(); } catch (e) {}
      try { if (stop.stopMovement) stop.stopMovement(); } catch (e) {}
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (e) {}

      // ── Сообщение о смерти ──
      const timeSinceDamage = Date.now() - lastDamageTime;
      if (attackerName && timeSinceDamage < 5000) {
        global.say('Ай, меня убил ' + attackerName + '! Сейчас вернусь на место.');
        console.log('💀 Убил: ' + attackerName);
      } else {
        global.say('Блин, я умерла, ща вернусь и продолжим.');
        console.log('💀 Смерть не от игрока/NPC (последний урон ' + Math.round(timeSinceDamage / 1000) + ' сек назад)');
      }

      attackerName = null;
      lastDamageTime = 0;
    } catch (e) {
      console.error('⚠️ Ошибка при обработке смерти:', e.message);
    }
  });

  // ── РЕСПАВН ──
  bot.on('respawn', async () => {
    if (!deathPos || bot.ended) {
      isRecovering = false;
      deathPos = null;
      return;
    }

    isRecovering = true;

    const offsetX = Math.floor(Math.random() * 7) - 3;
    const offsetZ = Math.floor(Math.random() * 7) - 3;

    const targetX = Math.floor(deathPos.x) + offsetX;
    const targetY = Math.floor(deathPos.y) + 1;
    const targetZ = Math.floor(deathPos.z) + offsetZ;

    // Тихо ждём 5 секунд (без спама в чат)
    await new Promise(r => setTimeout(r, 5000));

    try {
      bot.chat('/tp @s ' + targetX + ' ' + targetY + ' ' + targetZ);
      mutePartialReadError(10); // ← ДОБАВИ ЭТУ СТРОКУ: глушим на 10 секун
      await new Promise(r => setTimeout(r, 1000));
      console.log('✅ Телепорт выполнен');
      global.say('Вернулась! Сейчас заберу свои вещи...');
    } catch (e) {
      console.error('⚠️ Не удалось телепортнуться:', e.message);
      global.say('Не смогла телепортнуться...');
      isRecovering = false;
      deathPos = null;
      return;
    }

    try {
      await lootDeathChest(bot, deathPos);
    } catch (e) {
      console.error('⚠️ Ошибка при обыске сундука:', e.message);
      global.say('Не нашла сундук с вещами...');
    }

    isRecovering = false;
    deathPos = null;
  });

  bot.on('end', () => {
    isRecovering = false;
    deathPos = null;
    attackerName = null;
    lastDamageTime = 0;
  });
}

function isChest(block) {
  if (!block) return false;
  const name = block.name.toLowerCase();
  return name === 'chest' || name === 'trapped_chest' || name === 'barrel' ||
         name === 'shulker_box' || name.includes('shulker');
}

function findDeathChest(bot, deathPos) {
  const offsets = [
    [0, 0, 0], [0, 1, 0], [0, -1, 0], [0, 2, 0], [0, -2, 0]
  ];

  for (const [dx, dy, dz] of offsets) {
    const pos = deathPos.offset(dx, dy, dz);
    const block = bot.blockAt(pos);
    if (block) {
      console.log('  Блок на ' + pos.x + ', ' + pos.y + ', ' + pos.z + ': ' + block.name + ' (id: ' + block.id + ')');
    }
    if (block && isChest(block)) {
      console.log('📦 Сундук найден на смещении ' + dx + ', ' + dy + ', ' + dz + '!');
      return block;
    }
  }

  console.log('🔎 На точных координатах нет сундука, ищу в радиусе 6...');
  const found = bot.findBlock({
    point: deathPos,
    matching: block => block && isChest(block),
    maxDistance: 6,
    count: 1
  });

  if (found) {
    console.log('📦 Сундук найден поблизости: ' + found.position.x + ', ' + found.position.y + ', ' + found.position.z);
  }

  return found || null;
}

async function lootDeathChest(bot, deathPos) {
  console.log('🔎 Ищу сундук на: ' + Math.floor(deathPos.x) + ', ' + Math.floor(deathPos.y) + ', ' + Math.floor(deathPos.z));

  // Ждём 2 сек (вместо 3) — чанки грузятся
  await new Promise(r => setTimeout(r, 2000));

  let chestBlock = findDeathChest(bot, deathPos);

  if (!chestBlock) {
    console.log('⏳ Не нашёл, жду ещё 2 сек...');
    await new Promise(r => setTimeout(r, 2000));
    chestBlock = findDeathChest(bot, deathPos);
  }

  if (!chestBlock) {
    console.log('⏳ Последняя попытка через 2 сек...');
    await new Promise(r => setTimeout(r, 2000));
    chestBlock = findDeathChest(bot, deathPos);
  }

  if (!chestBlock) {
    console.log('❌ Сундук не найден');
    global.say('Не вижу сундук с вещами... Может, его уже кто-то забрал?');
    return;
  }

  console.log('📦 Сундук: ' + chestBlock.position.x + ', ' + chestBlock.position.y + ', ' + chestBlock.position.z);

  // Подходим, если далеко
  const distToChest = bot.entity.position.distanceTo(chestBlock.position);
  if (distToChest > 4) {
    console.log('🚶 Иду к сундуку (расстояние: ' + distToChest.toFixed(1) + ')...');
    try {
      bot.pathfinder.setGoal(new bot.goals.GoalNear(
        chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2
      ));
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          bot.removeListener('goal_reached', onReached);
          resolve();
        };
        function onReached() { finish(); }
        bot.once('goal_reached', onReached);
        setTimeout(finish, 6000);
      });
    } catch (e) {
      console.log('⚠️ Не дошла: ' + e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Открываем сундук (2 попытки, быстрее)
  let chest = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log('📦 Открываю сундук (попытка ' + attempt + ')...');
    try {
      chest = await bot.openChest(chestBlock);
      break;
    } catch (e) {
      console.log('  ⚠️ Не удалось: ' + e.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!chest) {
    global.say('Не могу открыть сундук...');
    return;
  }

  // Ждём синхронизации (1 сек вместо 1.5)
  console.log('⏳ Жду синхронизации...');
  await new Promise(r => setTimeout(r, 1000));

  const window = bot.currentWindow;
  if (!window) {
    global.say('Окно сундука недоступно...');
    return;
  }

  const totalSlots = window.slots.length;
  const inventoryStart = totalSlots - 36;

  console.log('📦 Всего слотов: ' + totalSlots + ', инвентарь с: ' + inventoryStart);

  const chestItems = [];
  for (let slot = 0; slot < inventoryStart; slot++) {
    const item = window.slots[slot];
    if (item && item.type !== 0 && item.type !== null) {
      chestItems.push({ slot, item });
    }
  }

  console.log('📦 Найдено предметов: ' + chestItems.length);

  if (chestItems.length === 0) {
    console.log('⏳ Пусто? Жду 1 сек...');
    await new Promise(r => setTimeout(r, 1000));
    chestItems.length = 0;
    for (let slot = 0; slot < inventoryStart; slot++) {
      const item = window.slots[slot];
      if (item && item.type !== 0 && item.type !== null) {
        chestItems.push({ slot, item });
      }
    }
    console.log('📦 После повторной проверки: ' + chestItems.length + ' предметов');
  }

  if (chestItems.length === 0) {
    global.say('Сундук пустой... Видимо, кто-то уже забрал.');
    try { chest.close(); } catch (e) {}
    return;
  }

  let taken = 0;
  let failedCount = 0;
  let inventoryFull = false;

  for (const { slot, item } of chestItems) {
    if (inventoryFull) {
      failedCount += item.count;
      continue;
    }

    let emptySlot = -1;
    for (let i = inventoryStart; i < totalSlots; i++) {
      const slotItem = window.slots[i];
      if (!slotItem || slotItem.type === 0 || slotItem.type === null) {
        emptySlot = i;
        break;
      }
    }

    if (emptySlot === -1) {
      console.log('  ❌ Нет пустого слота! Инвентарь полон.');
      inventoryFull = true;
      failedCount += item.count;
      continue;
    }

    try {
      bot.moveSlotItem(slot, emptySlot);
      taken += item.count;
      console.log('  ✅ ' + item.name + ' x' + item.count);
      await new Promise(r => setTimeout(r, 30)); // 30 мс вместо 120 — очень быстро
    } catch (e) {
      console.error('  ❌ Ошибка: ' + e.message);
      try {
        bot.moveSlotItem(slot, emptySlot);
        taken += item.count;
        console.log('  ✅ Со второй попытки: ' + item.name + ' x' + item.count);
        await new Promise(r => setTimeout(r, 30));
      } catch (e2) {
        console.error('  ❌ Совсем не вышло: ' + e2.message);
        failedCount += item.count;
      }
    }
  }

  try { chest.close(); } catch (e) {}

  if (inventoryFull && failedCount > 0) {
    global.say('Забрала ' + taken + ' предметов, но инвентарь забит! Осталось ' + failedCount + ' в сундуке.');
  } else if (failedCount > 0) {
    global.say('Забрала ' + taken + ' предметов, но ' + failedCount + ' не смогла забрать.');
  } else {
    global.say('Забрала все вещи из сундука! ' + taken + ' предметов.');
  }
}

function getIsRecovering() {
  return isRecovering;
}

module.exports = { init, getIsRecovering };
