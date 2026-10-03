// Выносим сюда всё, что связано с перемещением: телепорт, бродить, следовать.
// actions/combat.js: equipBestWeapon, isHoldingWeapon, ensureWeapon, doAttackAll, doAttackOne, doStopAttack, stopOtherActions.
// actions/inventory.js: doDrop, doPickup, doCheckCount, depositAllExceptTools, findAllChests.
// actions/digging.js: parseDigCommand, doDig, doFill, getFaceDirection, плюс функции-обработчики команд handleDigCommand и handleFillCommand, которые вызывают парсер и затем doDig / doFill.
// actions/hunger.js: checkHunger, tryEatFood.


const Vec3 = require('vec3');
const config = require('../config');
const utils = require('../utils');

function init(bot, cfg, ut) {
  // больше не нужно ничего сохранять — config и utils импортированы сверху
}





function stopOtherActions(bot) {
  if (bot._followInterval) { clearInterval(bot._followInterval); bot._followInterval = null; }
  if (bot._wanderInterval) { clearTimeout(bot._wanderInterval); bot._wanderInterval = null; }
  bot._isWandering = false;
  try { bot.pathfinder.setGoal(null); } catch (e) {}
}





function doStop(bot) {
  stopOtherActions(bot);
  try { bot.clearControlStates(); } catch (e) {}
  global.say('Остановилась.');
}





function doTeleport(bot) {
  stopOtherActions(bot);
  const name = utils.findAnyPlayerName(bot);
  if (!name) {
    global.say('Нет игроков для телепорта.');
    return;
  }
  const cmd = '/tp ' + config.BOT_NAME + ' ' + name;
  console.log('🌌 Телепорт: ' + cmd);
  global.say(cmd);
}





function doFollow(bot) {
  stopOtherActions(bot);

  const target = utils.findNearestPlayer(bot);
  if (!target || !target.entity || !target.entity.position) {
    global.say('Не вижу игроков рядом.');
    return;
  }

  if (bot.movements) bot.pathfinder.setMovements(bot.movements);
  const targetEntity = target.entity;
  bot.pathfinder.setGoal(new bot.goals.GoalFollow(targetEntity, 1), true);
  console.log('🟢 Следую за ' + target.username);

  bot._followInterval = setInterval(() => {
    if (!targetEntity || !targetEntity.position) {
      clearInterval(bot._followInterval);
      bot._followInterval = null;
      return;
    }
    const dist = bot.entity.position.distanceTo(targetEntity.position);
    if (dist > 5) {
      bot.pathfinder.setGoal(new bot.goals.GoalFollow(targetEntity, 1), true);
    }
  }, 2000);
}








function doWander(bot) {
  stopOtherActions(bot);

  if (bot.movements) bot.pathfinder.setMovements(bot.movements);

  const WANDER_RADIUS = 15;
  const WAIT_MIN = 3;
  const WAIT_MAX = 8;

  bot._isWandering = true;
  console.log('🚶 Свободный режим включён');

  function pickWanderPoint() {
    const origin = bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * WANDER_RADIUS;

    let x = Math.floor(origin.x + Math.cos(angle) * dist);
    let z = Math.floor(origin.z + Math.sin(angle) * dist);
    let y = Math.floor(origin.y);

    const groundBlock = bot.blockAt(new Vec3(x, y - 1, z));
    if (!groundBlock || groundBlock.name === 'air') {
      for (let dy = -3; dy <= 3; dy++) {
        const check = bot.blockAt(new Vec3(x, y - 1 + dy, z));
        if (check && check.name !== 'air') {
          y = y + dy;
          break;
        }
      }
    }
    return { x, y, z };
  }










  function wanderStep() {
    if (!bot._isWandering) return;
    const point = pickWanderPoint();
    console.log('🚶 Иду к ' + point.x + ', ' + point.y + ', ' + point.z);
    try {
      bot.pathfinder.setGoal(new bot.goals.GoalBlock(point.x, point.y, point.z));
    } catch (e) {
      console.log('⚠️ Не могу построить путь');
    }

    const waitMs = (WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN)) * 1000;
    bot._wanderInterval = setTimeout(() => {
      console.log('👀 Осматриваюсь...');
      try { bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5); } catch (e) {}
      bot._wanderInterval = setTimeout(wanderStep, waitMs);
    }, 15000);
  }

  wanderStep();
}








module.exports = {
  init,
  doStop,
  doTeleport,
  doFollow,
  doWander
};
