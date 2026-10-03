// ИДИ СЮДА — бот идёт на позицию игрока и говорит: «Я тут, чего хотел?»
// иди туда X Y Z — бот идёт по координатам и говорит: «Ну я на месте, что дальше?»
// Если координаты не указаны — бот вежливо просит их указать.
// actions/GoTo.js — движение к игроку или координатам

const Vec3 = require('vec3');

let isMoving = false;

async function goToPlayer(bot, username) {
  if (isMoving) {
    global.say('Я уже иду, подожди немного!');
    return;
  }

  // --- НАЧАЛО: Умный поиск игрока с повторной попыткой ---
  let player = bot.players[username];
  
  // Если сразу не нашли — ждём 1.5 секунды и пробуем ещё раз
  if (!player || !player.position) {
    console.log(`⚠️ Игрок ${username} не найден сразу, жду...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    player = bot.players[username]; // Проверяем ещё раз
  }

  if (!player || !player.position) {
    // Если всё равно не нашли — пробуем найти по имени в списке сущностей (запасной вариант)
    const foundEntity = Object.values(bot.entities).find(e => 
      e.type === 'player' && e.username === username
    );
    
    if (foundEntity && foundEntity.position) {
      player = { position: foundEntity.position };
    }
  }
  // --- КОНЕЦ: Умный поиск ---

  if (!player || !player.position) {
    global.say('Не вижу тебя! Стой на месте 2 секунды и напиши "иди сюда" ещё раз.');
    return;
  }

  await goToPosition(bot, player.position, 'Я тут, чего хотел?');
}

async function goToCoords(bot, x, y, z) {
  if (isMoving) {
    global.say('Я уже иду, подожди немного!');
    return;
  }
  const target = new Vec3(x, y, z);
  await goToPosition(bot, target, 'Ну я на месте, что дальше?');
}

function askForCoords() {
  global.say('КУДА МНЕ ИДТИ? Укажи координаты. Пример: иди туда 102 70 340');
}

async function goToPosition(bot, position, successMessage) {
  isMoving = true;
  const current = bot.entity.position;
  const dist = current.distanceTo(position);
  console.log(`🚶 Иду к ${position.x}, ${position.y}, ${position.z} (расстояние: ${dist.toFixed(1)} блоков)`);

  if (dist < 1.5) {
    global.say(successMessage);
    isMoving = false;
    return;
  }

  try {
    bot.pathfinder.setGoal(new bot.goals.GoalNear(
      position.x, position.y, position.z, 1.2
    ));
  } catch (e) {
    console.error('Ошибка установки цели:', e.message);
    global.say('Что-то пошло не так, не могу туда дойти.');
    isMoving = false;
    return;
  }

  return new Promise((resolve) => {
    let resolved = false;

    function finish() {
      if (resolved) return;
      resolved = true;
      bot.removeListener('goal_reached', onGoalReached);
      bot.removeListener('pathing_error', onPathingError);
      isMoving = false;
      resolve();
    }

    function onGoalReached() {
      console.log('✅ Дошёл до цели');
      global.say(successMessage);
      finish();
    }

    function onPathingError(err) {
      console.error('❌ Ошибка пути:', err.message);
      global.say('Не смогла дойти — путь заблокирован.');
      finish();
    }

    bot.once('goal_reached', onGoalReached);
    bot.once('pathing_error', onPathingError);
  });
}

module.exports = { goToPlayer, goToCoords, askForCoords };