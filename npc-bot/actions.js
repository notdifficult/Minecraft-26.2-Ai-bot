// Главный диспетчер actions.js (вместо огромного файла)
// Здесь только логика «какая команда → какой модуль». Никакого дублирования кода.


const config = require('./config');      // или '../config' — зависит от структуры
const utils = require('./utils');        // или '../utils'
const Vec3 = require('vec3');

const movementActions = require('./actions/movement');
const combatActions = require('./actions/combat');
const inventoryActions = require('./actions/inventory');
const diggingActions = require('./actions/digging');
const hungerActions = require('./actions/hunger');
const lootActions = require('./actions/LootSearch'); // подбор лута
const goToActions  = require('./actions/GoTo'); // иди туда иди сюда
const deathRecovery = require('./actions/DeathRecovery'); // тп на место смерти
//const selfDefense = require('./actions/SelfDefense');

let botInstance = null;
let configInstance = null;
let utilsInstance = null;

function init(bot, cfg, ut) {
    botInstance = bot;
    configInstance = cfg;
    utilsInstance = ut;

    movementActions.init(bot, cfg, ut);
    combatActions.init(bot, cfg, ut);
    inventoryActions.init(bot, cfg, ut);
    diggingActions.init(bot, cfg, ut);
    hungerActions.init(bot, cfg, ut);
    lootActions.init(bot, cfg, ut);

    //selfDefense.init(bot, stopFunctions);
    // ── DEATH RECOVERY ──
    deathRecovery.init(bot, {
        stopDigging: () => diggingActions.setDigging(false),
        stopAttack: () => combatActions.doStopAttack(bot),
        stopMovement: () => movementActions.doStop(bot),
        stopLoot: () => {
        try { bot.pathfinder.setGoal(null); } catch (e) {}
        }
    });
}

function dispatchAction(bot, user, message) {
  const msg = (message || '').toLowerCase().trim();

  // Движение
  if (msg.startsWith('/tp') || msg.includes('телепорт')) {
    return movementActions.doTeleport(bot);
  }
  if (msg === '/wander' || msg.includes('броди')) {
    return movementActions.doWander(bot);
  }

  // Инвентарь и сундуки
  if (msg.includes('выброси') || msg.includes('выкинь')) {
    return inventoryActions.doDrop(bot, message);
  }
  if (msg.includes('подбери') || msg.includes('собери')) {
    return inventoryActions.doPickup(bot);
  }
  if (msg.includes('сколько') || msg.includes('посчитать')) {
    return inventoryActions.doCheckCount(bot, message);
  }
  if (msg.includes('сундук') || msg.includes('выложи')) {
    return inventoryActions.depositAllExceptTools(bot);
  }

  // Бой
  if (msg.includes('атакуй') || msg.includes('убей')) {
    const target = msg.replace(/атакуй|убей/g, '').trim();
    if (target) {
      return combatActions.doAttackOne(bot, target);
    }
    return combatActions.doAttackAll(bot);
  }
  if (msg.includes('стоп драться')) {
    return combatActions.doStopAttack(bot);
  }

  // Копание и строительство
  if (msg.startsWith('выкопай') || msg.startsWith('копай')) {
    return diggingActions.handleDigCommand(bot, message);
  }
  if (msg.startsWith('закопай')) {
    return diggingActions.handleFillCommand(bot, message);
  }

  // Голод и еда
  if (msg.includes('голод') || msg.includes('сытость')) {
    return hungerActions.checkHunger(bot);
  }
  if (msg.includes('поешь') || msg.includes('съешь')) {
    return hungerActions.tryEatFood(bot);
  }
}

// ── Реэкспорт служебных функций из модулей ──
const combat = require('./actions/combat');

function isAttacking() {
  // combat.js хранит isAttacking локально, нужно добавить геттер
  return combat.getIsAttacking();
}



//function say(text) {
  // Сначала пишем в консоль — чтобы ты всё видел
 // console.log(`💬 [Miyuki] говорит: ${text}`);

  // Потом отправляем в чат игры, если бот уже подключён
 // if (bot && bot.chat) {
 //   bot.chat(text);
 // } else {
 //   console.warn('⚠️ Бот ещё не готов к чату, текст только в консоль:', text);
 // }
//}


module.exports = {
    init,
    dispatchAction,
    isAttacking,

    // Movement
    doTeleport: movementActions.doTeleport,
    doFollow: movementActions.doFollow,
    doWander: movementActions.doWander,
    doStop: movementActions.doStop,

    // Combat
    doAttackAll: combatActions.doAttackAll,
    doAttackOne: combatActions.doAttackOne,
    doStopAttack: combatActions.doStopAttack,
    stopOtherActions: combatActions.stopOtherActions,

    // Inventory
    doDrop: inventoryActions.doDrop,
    doPickup: lootActions.doPickup,
    doCheckCount: inventoryActions.doCheckCount,
    depositAllExceptTools: inventoryActions.depositAllExceptTools,
    checkInventorySpace: inventoryActions.checkInventorySpace,

    // Digging
    parseDigCommand: diggingActions.parseDigCommand,
    doDig: diggingActions.doDig,
    doFill: diggingActions.doFill,
    handleDigCommand: diggingActions.handleDigCommand,
    isDigging: diggingActions.getIsDigging,
    setDigging: diggingActions.setIsDigging,

    // Hunger
    checkHunger: hungerActions.checkHunger,
    tryEatFood: hungerActions.tryEatFood,


    // GoTo — ДОБАВИЛИ СЮДА
    goToPlayer: goToActions.goToPlayer,
    goToCoords: goToActions.goToCoords,
    askForCoords: goToActions.askForCoords,

    
    // Death Recovery
    isRecovering: deathRecovery.getIsRecovering
};

