// actions/inventory.js — инвентарь, подбор, сундуки

const config = require('../config');
const utils = require('../utils');
const Vec3 = require('vec3');


function init(bot, cfg, ut) {
}








function findAllChests(bot) {
  const origin = bot.entity.position;
  const chests = [];
  const radius = 8;

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const pos = new Vec3(
          Math.floor(origin.x + x),
          Math.floor(origin.y + y),
          Math.floor(origin.z + z));
        const block = bot.blockAt(pos);
        if (!block) continue;
        const name = block.name || '';
        if (name === 'chest' || name === 'ender_chest') {
          const distSq = (pos.x - origin.x) ** 2 + (pos.y - origin.y) ** 2 + (pos.z - origin.z) ** 2;
          chests.push({ block, distSq });
        }
      }
    }
  }

  chests.sort((a, b) => a.distSq - b.distSq);
  return chests.map(c => c.block);
}









function doDrop(bot, message) {
  const msgLower = (message || '').toLowerCase();
  const items = bot.inventory.items();

  if (items.length === 0) {
    global.say('У меня пусто, бросать нечего.');
    return;
  }

  // Выбросить всё
  if (/вс[её]|все предметы|инвентарь/i.test(msgLower)) {
    items.forEach((item, i) => {
      setTimeout(() => {
        bot.tossStack(item).catch(() => {});
      }, i * 200);
    });
    setTimeout(() => {
      global.say('Выбросила всё, карманы пустые!');
    }, items.length * 200 + 500);
    return;
  }

  // Парсим количество и предмет
  const params = utils.parseDropParams(message);
  if (!params.itemId) {
    for (let i = 0; i < items.length; i++) {
      if (msgLower.indexOf(items[i].name) !== -1) {
        params.itemId = items[i].name;
        break;
      }
    }
  }

  if (!params.itemId) {
    global.say('Не поняла, что выбросить. Какой предмет?');
    return;
  }

  const invItems = bot.inventory.items().filter(item => item.name === params.itemId);
  if (invItems.length === 0) {
    global.say('У меня нет ' + params.itemId + '.');
    return;
  }

  if (params.count === 'half') {
    invItems.forEach((item, i) => {
      const toDrop = Math.floor(item.count / 2);
      if (toDrop > 0) {
        setTimeout(() => bot.toss(item.type, item.metadata, toDrop).catch(() => {}), i * 200);
      }
    });
    global.say('Выбросила половину ' + params.itemId + '.');
    return;
  }

  if (params.count === 'all') {
    invItems.forEach((item, i) => {
      setTimeout(() => bot.tossStack(item).catch(() => {}), i * 200);
    });
    const total = invItems.reduce((sum, item) => sum + item.count, 0);
    global.say('Выбросила все ' + total + ' ' + params.itemId + '.');
    return;
  }

  let remaining = params.count;
  invItems.forEach(item => {
    if (remaining <= 0) return;
    const toDrop = Math.min(remaining, item.count);
    bot.toss(item.type, item.metadata, toDrop).catch(() => {});
    remaining -= toDrop;
  });
  global.say('Выбросила ' + params.count + ' ' + params.itemId + '.');
}
















function checkInventorySpace(bot) {
  if (!bot || !bot.inventory) return true;
  let occupied = 0;
  for (let i = 0; i < 36; i++) {
    if (bot.inventory.slots[i]) occupied++;
  }
  const freeSlots = 36 - occupied;
  if (freeSlots < 9) {
    global.say('Инвентарь почти полон! Осталось ' + freeSlots + ' слотов.');
    return false;
  }
  return true;
}










function doCheckCount(bot, message) {
  const msgLower = (message || '').toLowerCase().trim();
  const items = bot.inventory.items();

  let itemId = null;
  // Сначала пробуем алиасы из конфига
  const sortedKeys = Object.keys(config.ITEM_ALIASES).sort((a, b) => b.length - a.length);
  for (let i = 0; i < sortedKeys.length; i++) {
    if (msgLower.indexOf(sortedKeys[i]) !== -1) {
      itemId = config.ITEM_ALIASES[sortedKeys[i]];
      break;
    }
  }

  // Если алиаса нет — ищем по имени предмета в инвентаре
  if (!itemId) {
    for (let j = 0; j < items.length; j++) {
      if (msgLower.indexOf(items[j].name) !== -1) {
        itemId = items[j].name;
        break;
      }
    }
  }

  if (!itemId) {
    global.say('Не поняла, про какой предмет спрашиваешь.');
    return;
  }

  let total = 0;
  items.forEach(item => {
    if (item.name === itemId) total += item.count;
  });

  if (total === 0) {
    global.say('У меня нет ' + itemId + '.');
  } else {
    global.say(itemId + ' у меня ' + total + ' шт.');
  }
}















// ═══════════════════════════════════════════════════════════════
//  depositAllExceptTools — выкладывает все не-инструменты в сундуки
//  Использует activateBlock вместо openContainer (фикс для Paper)
//  Корректно обрабатывает нестакуемые предметы (головы и т.д.)
// ═══════════════════════════════════════════════════════════════
async function depositAllExceptTools(bot) {
  const chests = findAllChests(bot);
  if (chests.length === 0) {
    global.say('Чет я не вижу сундуков, покажи где они');
    return;
  }

  global.say('Нашла ' + chests.length + ' сундук(ов). Начинаю выкладывать...');

  const items = bot.inventory.items();
  const itemsToDeposit = [];

  for (let i = 0; i < items.length; i++) {
    const name = items[i].name;
    const isTool = name.endsWith('_sword') || name.endsWith('_axe') ||
                   name.endsWith('_pickaxe') || name.endsWith('_shovel') || name.endsWith('_hoe');
    const isArmor = name.endsWith('_helmet') || name.endsWith('_chestplate') ||
                    name.endsWith('_leggings') || name.endsWith('_boots');
    const isFood = ['carrot', 'potato', 'beetroot', 'melon_slice', 'apple', 'golden_apple',
                    'steak', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon',
                    'bread', 'cake', 'cookie', 'suspicious_stew'].some(f => name.includes(f));

    if (isTool || isArmor || isFood) continue;
    itemsToDeposit.push(items[i]);
  }

  if (itemsToDeposit.length === 0) {
    global.say('В инвентаре лишних вещей, а то что мне нравится я не отдам)');
    return;
  }

  let depositedCount = 0;
  let remainingItems = itemsToDeposit.slice();

  for (let c = 0; c < chests.length && remainingItems.length > 0; c++) {
    const chest = chests[c];
    const chestPos = chest.position;

    // ── Идём к сундуку ──
    const dist = bot.entity.position.distanceTo(chestPos);
    if (dist > 2) {
      console.log('🚶 Иду к сундуку на ' + chestPos.x + ', ' + chestPos.y + ', ' + chestPos.z);
      try {
        bot.pathfinder.setGoal(new bot.goals.GoalNear(
          chestPos.x, chestPos.y, chestPos.z, 2));
      } catch (e) {
        console.log('⚠️ Не могу построить путь: ' + e.message);
        continue;
      }

      const reached = await new Promise((resolve) => {
        let done = false;
        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          bot.removeListener('goal_reached', onReached);
          resolve(false);
        }, 8000);

        function onReached() {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          resolve(true);
        }

        bot.once('goal_reached', onReached);
      });

      if (!reached) {
        console.log('⚠️ Не дошла до сундука, пропускаю.');
        continue;
      }
    }

    // ── Останавливаем pathfinder ──
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));

    // ── Открываем сундук ВРУЧНУЮ (без openContainer) ──
    // openContainer зависает на Paper-серверах, поэтому используем
    // activateBlock + ручной перехват события windowOpen
    let container = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log('📦 Попытка ' + attempt + ': открываю сундук...');

      // Поворачиваемся к ЦЕНТРУ блока сундука
      // (Paper часто игнорирует клики по углу блока)
      await bot.lookAt(chestPos.offset(0.5, 0.5, 0.5), true);
      await new Promise(r => setTimeout(r, 400));

      // Слушаем windowOpen ПЕРЕД кликом
      const windowPromise = new Promise((resolve) => {
        let done = false;
        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          bot.removeListener('windowOpen', onOpen);
          resolve(null);
        }, 3000);

        function onOpen(window) {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          resolve(window);
        }

        bot.once('windowOpen', onOpen);
      });

      // Отправляем правый клик по блоку
      try {
        await bot.activateBlock(chest);
      } catch (e) {
        console.log('⚠️ activateBlock ошибка: ' + e.message);
      }

      // Ждём окно
      const window = await windowPromise;

      if (window) {
        console.log('✅ Окно открыто! Слотов: ' + window.slots.length);

        // Создаём обёртку для совместимости
        container = {
          window: window,
          close: () => {
            try { bot.closeWindow(window); } catch (e) {}
          }
        };
        break;
      } else {
        console.log('⚠️ Попытка ' + attempt + ': окно не появилось за 3 сек.');
        // Закрываем возможные зависшие окна
        try { bot.closeWindow(bot.currentWindow); } catch (e) {}
      }

      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
    }

    if (!container || !container.window) {
      console.log('⚠️ Не смогла открыть сундук, пропускаю.');
      continue;
    }

    // Ждём прогрузки слотов
    await new Promise(r => setTimeout(r, 500));

    // ── Считаем свободные слоты именно в сундуке ──
    // Окно сундука = слоты сундука + 36 слотов инвентаря игрока
    // У обычного сундука 27 слотов, у двойного — 54
    let chestSlots = container.window.slots.length - 36;
    if (chestSlots < 1) chestSlots = 27;

    let freeChestSlots = 0;
    for (let s = 0; s < chestSlots; s++) {
      if (!container.window.slots[s]) freeChestSlots++;
    }
    console.log('📦 В сундуке ' + freeChestSlots + ' свободных слотов (из ' + chestSlots + ').');

    if (freeChestSlots === 0) {
      console.log('⚠️ Сундук полон, пропускаю.');
      try { container.close(); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      continue;
    }


    // ── Выкладываем предметы (ручными кликами) ──
    // deposit() не работает для нестакуемых предметов с NBT (головы и т.д.)
    // Поэтому используем bot.clickWindow для ручного перемещения
    const invStart = chestSlots; // слоты инвентаря начинаются после слотов сундука
    const invEnd = container.window.slots.length;
    // ── Выкладываем предметы (ручные клики, без правки slots вручную) ──
    const stillRemaining = [];

    for (let j = 0; j < remainingItems.length; j++) {
      if (freeChestSlots <= 0) break;

      const item = remainingItems[j];
      const stackSize = item.stackSize || 64;
      let remaining = item.count;

      while (remaining > 0 && freeChestSlots > 0) {
        const toDeposit = Math.min(remaining, stackSize); // для голов всегда 1

        // ── Ищем слот с этим предметом в инвентаре (в окне) ──
        let invSlot = -1;
        // Слоты сундука: [0 .. chestSlots-1]
        // Слоты инвентаря игрока: [chestSlots .. end]
        for (let s = chestSlots; s < container.window.slots.length; s++) {
          const slotItem = container.window.slots[s];
          if (slotItem && slotItem.type === item.type) {
            // Для нестакуемых (головы) это точно нужный предмет
            invSlot = s;
            break;
          }
        }

        if (invSlot === -1) {
          console.log('⚠️ Не нашла ' + item.name + ' в окне инвентаря. Возможно, предмет уже ушёл на сервер.');
          break; // дальше искать нет смысла — предмета в окне нет
        }

        // ── Ищем пустой слот в сундуке ──
        let chestSlot = -1;
        for (let s = 0; s < chestSlots; s++) {
          if (!container.window.slots[s]) {
            chestSlot = s;
            break;
          }
        }

        if (chestSlot === -1) {
          console.log('⚠️ Нет свободных слотов в сундуке.');
          break;
        }

        try {
          // Берём предмет (левый клик)
          await bot.clickWindow(invSlot, 0, 0);
          await new Promise(r => setTimeout(r, 200));

          // Кладём в сундук (левый клик по пустому слоту)
          await bot.clickWindow(chestSlot, 0, 0);
          await new Promise(r => setTimeout(r, 300)); // чуть дольше для голов

          depositedCount += toDeposit;
          console.log('✅ Выложила 1x ' + item.name);

          remaining -= toDeposit;
          freeChestSlots--;

          // ВАЖНО: НЕ меняем container.window.slots вручную!
          // Пусть сервер пришлёт новые данные.
        } catch (e) {
          console.log('❌ Ошибка при выкладывании ' + item.name + ': ' + e.message);
          break;
        }
      }

      if (remaining > 0) {
        stillRemaining.push({
          type: item.type,
          metadata: item.metadata,
          name: item.name,
          count: remaining
        });
      }
    }

    try { container.close(); } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
    remainingItems = stillRemaining;
  }

  if (depositedCount > 0) {
    global.say('Я Выложила ' + depositedCount + ' предметов');
  } else {
    global.say('Не смогла ничего выложить. Возможно, сундуки полны или защищены. мб что то сломалось?');
  }
  if (remainingItems.length > 0 && depositedCount > 0) {
    global.say(remainingItems.length + ' типов предметов не влезло.');
  }
}

module.exports = {
  init,
  findAllChests,
  doDrop,
  checkInventorySpace,
  doCheckCount,
  depositAllExceptTools
};
