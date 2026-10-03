// Здесь улучшенная версия сборки с проверкой достижимости, таймаутами и пропуском недоступных предметов.'

const config = require('../config');
const utils = require('../utils');
const Vec3 = require('vec3');

function init(bot, cfg, ut) {}

// Блоки, через которые точно нельзя пройти
const UNREACHABLE_BLOCKS = [
  'bedrock', 'water', 'lava', 'flowing_water', 'flowing_lava',
  'barrier', 'command_block', 'structure_block', 'repeating_command_block',
  'chain_command_block', 'obsidian', 'spawner'
];

// Проверка, можно ли вообще дойти до предмета
function isItemReachable(bot, itemPos) {
  // Проверяем сам блок, где лежит предмет
  const itemBlock = bot.blockAt(itemPos);
  if (itemBlock && UNREACHABLE_BLOCKS.indexOf(itemBlock.name) !== -1) {
    return false;
  }

  // Проверяем блок под предметом (нужна опора)
  const belowBlock = bot.blockAt(itemPos.offset(0, -1, 0));
  if (belowBlock && UNREACHABLE_BLOCKS.indexOf(belowBlock.name) !== -1) {
    // Если под предметом вода/лава — скорее всего он упал туда
    if (belowBlock.name === 'water' || belowBlock.name === 'lava' ||
        belowBlock.name === 'flowing_water' || belowBlock.name === 'flowing_lava') {
      return false;
    }
  }

  // Проверяем блоки вокруг предмета (нужно хотя бы одно свободное место сверху или сбоку)
  const checks = [
    itemPos.offset(0, 1, 0),  // сверху
    itemPos.offset(1, 0, 0),  // сбоку
    itemPos.offset(-1, 0, 0),
    itemPos.offset(0, 0, 1),
    itemPos.offset(0, 0, -1),
  ];

  let hasAirNearby = false;
  for (let i = 0; i < checks.length; i++) {
    const b = bot.blockAt(checks[i]);
    if (!b || b.name === 'air' || b.name === 'cave_air') {
      hasAirNearby = true;
      break;
    }
  }

  if (!hasAirNearby) return false; // предмет зажат между блоками

  // Проверяем, есть ли путь через бедрок между ботом и предметом
  // Простая проверка: смотрим несколько блоков по прямой
  const origin = bot.entity.position;
  const dist = origin.distanceTo(itemPos);
  if (dist > 30) return false; // слишком далеко

  // Проверяем несколько точек на прямой между ботом и предметом
  const steps = Math.ceil(dist);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const checkPos = new Vec3(
      Math.floor(origin.x + (itemPos.x - origin.x) * t),
      Math.floor(origin.y + (itemPos.y - origin.y) * t),
      Math.floor(origin.z + (itemPos.z - origin.z) * t)
    );
    const b = bot.blockAt(checkPos);
    if (b && b.name === 'bedrock') {
      return false; // бедрок на пути
    }
  }

  return true;
}

function doPickup(bot) {
  const origin = bot.entity.position;
  const PICKUP_RADIUS = 16;

  // Собираем все предметы (Entity type: 'item' или name: 'item')
  const allTargets = Object.values(bot.entities).filter(e => {
    if (!e.position || !e.isValid) return false;
    if (e.name !== 'item') return false;
    return e.position.distanceTo(origin) <= PICKUP_RADIUS;
  });

  if (allTargets.length === 0) {
    global.say('Вокруг ничего нет, подбирать нечего.');
    return;
  }

  // Сортируем по расстоянию
  allTargets.sort((a, b) =>
    origin.distanceSquared(a.position) - origin.distanceSquared(b.position)
  );

  // Фильтруем недоступные
  const reachable = [];
  const skipped = [];
  for (let i = 0; i < allTargets.length; i++) {
    const target = allTargets[i];
    if (isItemReachable(bot, target.position)) {
      reachable.push(target);
    } else {
      skipped.push(target);
      console.log('⏭️ Пропускаю предмет в ' + target.position + ' — недоступен');
    }
  }

  console.log('🧹 Нашла ' + allTargets.length + ' предметов: ' +
    reachable.length + ' доступно, ' + skipped.length + ' пропущено');

  if (reachable.length === 0) {
    global.say('Видела ' + allTargets.length + ' предметов, но все недоступны — за стеной или в воде.');
    return;
  }

  let pickedCount = 0;
  let skippedCount = 0;
  let currentIdx = 0;

  function pickNext() {
    // Проверяем, не умер бот
    if (!bot.entity || !bot.entity.position) return;

    if (currentIdx >= reachable.length) {
      global.say('Готово! Собрала ' + pickedCount + ' предметов' +
        (skippedCount > 0 ? ', ' + skippedCount + ' не получилось.' : '.'));
      return;
    }

    const target = reachable[currentIdx];

    // Проверяем, что предмет ещё существует
    if (!target || !target.isValid || !target.position) {
      currentIdx++;
      setTimeout(pickNext, 100);
      return;
    }

    const goalPos = target.position;
    const dist = bot.entity.position.distanceTo(goalPos);

    // Если уже рядом — предмет подобран или почти подобран
    if (dist < 1.5) {
      pickedCount++;
      currentIdx++;
      setTimeout(pickNext, 300);
      return;
    }

    // Проверяем достижимость ещё раз (предмет мог упасть в лаву за время сбора)
    if (!isItemReachable(bot, goalPos)) {
      skippedCount++;
      currentIdx++;
      console.log('⏭️ Пропускаю — стал недоступен: ' + goalPos);
      setTimeout(pickNext, 100);
      return;
    }

    // Пробуем построить путь
    let pathFound = false;
    let timeoutHit = false;

    try {
      bot.pathfinder.setGoal(new bot.goals.GoalBlock(
        Math.floor(goalPos.x), Math.floor(goalPos.y), Math.floor(goalPos.z)
      ));
      pathFound = true;
    } catch (e) {
      skippedCount++;
      currentIdx++;
      console.log('⚠️ Не могу построить путь к ' + goalPos + ': ' + e.message);
      setTimeout(pickNext, 200);
      return;
    }

    // Ждём максимум 5 секунд на каждый предмет
    const timeoutId = setTimeout(() => {
      timeoutHit = true;
      bot.removeListener('goal_reached', onReached);
      bot.removeListener('no_path', onNoPath);
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      skippedCount++;
      currentIdx++;
      console.log('⏱️ Таймаут — пропускаю предмет в ' + goalPos);
      setTimeout(pickNext, 200);
    }, 5000);

    function onReached() {
      if (timeoutHit) return;
      clearTimeout(timeoutId);
      bot.removeListener('no_path', onNoPath);
      pickedCount++;
      currentIdx++;
      console.log('✅ Подобрала предмет в ' + goalPos);
      setTimeout(pickNext, 300);
    }

    function onNoPath() {
      if (timeoutHit) return;
      clearTimeout(timeoutId);
      bot.removeListener('goal_reached', onReached);
      skippedCount++;
      currentIdx++;
      console.log('🚫 Нет пути к предмету в ' + goalPos);
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      setTimeout(pickNext, 200);
    }

    bot.once('goal_reached', onReached);
    bot.once('no_path', onNoPath);
  }

  pickNext();
}

module.exports = {
  init,
  doPickup
};
