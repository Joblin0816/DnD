const fs = require('fs').promises;
const path = require('path');

/* -------------------------
   Persistence helpers
   ------------------------- */
async function loadState(sessionId) {
  const stateFile = path.join(process.cwd(), 'state', `session-${sessionId}.json`);
  try {
    const data = await fs.readFile(stateFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to load state for session ${sessionId}: ${error.message}`);
  }
}

async function saveState(sessionId, state) {
  const stateFile = path.join(process.cwd(), 'state', `session-${sessionId}.json`);
  try {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    throw new Error(`Failed to save state for session ${sessionId}: ${error.message}`);
  }
}

/* -------------------------
   Random dungeon generator
   ------------------------- */
function generateRandomState(width = 11, height = 9, monsterCount = 6, itemCount = 6) {
  if (width % 2 === 0) width++;
  if (height % 2 === 0) height++;

  const map = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row += '#';
      } else {
        row += (Math.random() < 0.18) ? '#' : '.';
      }
    }
    map.push(row);
  }

  const centerY = Math.floor(height / 2);
  const centerX = Math.floor(width / 2);
  map[centerY] = replaceChar(map[centerY], centerX, '.');
  if (centerX + 1 < width - 1) map[centerY] = replaceChar(map[centerY], centerX + 1, '.');
  if (centerX - 1 > 0) map[centerY] = replaceChar(map[centerY], centerX - 1, '.');

  const state = {
    map,
    players: {}, // username -> {x,y,hp,maxHp,atk,inventory:[],xp,level}
    monsters: {}, // id -> {id,x,y,type,hp,atk}
    items: {}, // id -> {id,x,y,type,name}
    turn: 0,
    nextMonsterId: 1,
    nextItemId: 1
  };

  const floorTiles = getAllFloorTiles(map);
  shuffleArray(floorTiles);

  for (let i = 0; i < Math.min(monsterCount, floorTiles.length); i++) {
    const [x, y] = floorTiles[i];
    const type = randomMonsterType();
    const stats = monsterStatsByType(type);
    const id = state.nextMonsterId++;
    state.monsters[id] = { id, x, y, type, hp: stats.hp, atk: stats.atk };
  }

  const leftover = floorTiles.slice(monsterCount);
  shuffleArray(leftover);
  const itemTypes = ['sword', 'potion', 'gem'];
  for (let i = 0; i < Math.min(itemCount, leftover.length); i++) {
    const [x, y] = leftover[i];
    const type = itemTypes[i % itemTypes.length];
    const id = state.nextItemId++;
    state.items[id] = { id, x, y, type, name: itemNameByType(type) };
  }

  return state;
}

/* -------------------------
   Utilities
   ------------------------- */
function replaceChar(str, index, ch) {
  return str.substr(0, index) + ch + str.substr(index + 1);
}

function getAllFloorTiles(map) {
  const res = [];
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === '.') res.push([x, y]);
    }
  }
  return res;
}

function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function randomMonsterType() {
  const types = ['demon', 'snake', 'zombie'];
  return types[Math.floor(Math.random() * types.length)];
}

function monsterStatsByType(type) {
  switch (type) {
    case 'demon': return { hp: 12, atk: 4, xp: 20 };
    case 'snake': return { hp: 6, atk: 2, xp: 8 };
    case 'zombie': return { hp: 8, atk: 3, xp: 12 };
    default: return { hp: 5, atk: 1, xp: 5 };
  }
}

function itemNameByType(type) {
  switch (type) {
    case 'sword': return 'Rusty Sword (+2 ATK)';
    case 'potion': return 'Healing Potion (+8 HP)';
    case 'gem': return 'Shiny Gem ($50)';
    default: return type;
  }
}

/* XP / Leveling helper
   - XP to next level: 20 * level  (simple)
   - Level up grants +4 maxHp, +1 atk, and full heal to max
*/
function xpToNextLevel(level) {
  return 20 * level;
}

function tryLevelUp(player) {
  let leveled = false;
  while (player.xp >= xpToNextLevel(player.level)) {
    player.xp -= xpToNextLevel(player.level);
    player.level++;
    player.maxHp += 4;
    player.atk += 1;
    player.hp = player.maxHp; // heal on level
    leveled = true;
  }
  return leveled;
}

/* -------------------------
   Player ensure/spawn
   ------------------------- */
function ensurePlayer(state, username) {
  if (!state.players[username]) {
    // assign next unique player emoji
    if (!state.playerIcons) state.playerIcons = {}; // store emoji assignment table
    if (!state.nextPlayerIconIndex) state.nextPlayerIconIndex = 0;

    const PLAYER_ICONS = [
      "🧙‍♂️","🧝‍♂️","🧚‍♂️","🧛‍♂️","🧞‍♂️",
      "👨‍🚀","👩‍🚀","🤺","🕵️‍♂️","🧟‍♂️",
      "👨‍🔬","👩‍🎨","👨‍🎤","👨‍💻","👩‍💻"
    ];

    const icon = PLAYER_ICONS[state.nextPlayerIconIndex % PLAYER_ICONS.length];
    state.playerIcons[username] = icon;
    state.nextPlayerIconIndex++;

    // Spawn location
    const centerY = Math.floor(state.map.length / 2);
    const centerX = Math.floor(state.map[0].length / 2);
    let spawnX = centerX, spawnY = centerY;

    if (state.map[centerY][centerX] !== '.') {
      const tiles = getAllFloorTiles(state.map);
      if (tiles.length > 0) [spawnX, spawnY] = tiles[0];
    }

    state.players[username] = {
      x: spawnX,
      y: spawnY,
      hp: 20,
      maxHp: 20,
      atk: 3,
      inventory: [],
      xp: 0,
      level: 1
    };
  }
}


/* -------------------------
   Emoji map rendering
   ------------------------- */
function renderAsciiMap(state, username) {
  const WALL = "🟥";
  const FLOOR = "⬜";
  const PLAYER = "🧙‍♂️";
  const OTHER = "👤";
  const MONSTER_ICONS = { demon: "👹", snake: "🐍", zombie: "🧟" };
  const ITEM_ICONS = { sword: "🗡️", potion: "🧪", gem: "💎" };

  const overlays = {}; // "x,y" -> char

  for (const it of Object.values(state.items)) {
    overlays[`${it.x},${it.y}`] = ITEM_ICONS[it.type] || '❔';
  }
  for (const m of Object.values(state.monsters)) {
    overlays[`${m.x},${m.y}`] = MONSTER_ICONS[m.type] || '👾';
  }
  for (const [pname, p] of Object.entries(state.players)) {
    const icon = state.playerIcons[pname] || "👤";
overlays[`${p.x},${p.y}`] = icon;

  }

  const rows = [];
  for (let y = 0; y < state.map.length; y++) {
    let rowStr = '';
    for (let x = 0; x < state.map[y].length; x++) {
      const base = state.map[y][x];
      let tileEmoji = (base === '#') ? WALL : FLOOR;
      const key = `${x},${y}`;
      if (overlays[key]) tileEmoji = overlays[key];
      rowStr += tileEmoji;
    }
    rows.push(rowStr);
  }
  return rows.join('\n');
}

/* -------------------------
   Monster AI & actions
   ------------------------- */

/*
 - For each monster:
   - If adjacent to any player -> attack that player
   - Else if player within aggro range -> move one step toward nearest player (simple path: reduce manhattan)
   - Else random walk with small chance
 - Avoid walking into walls, other monsters, or players
*/
function monstersAct(state) {
  const monsters = Object.values(state.monsters);
  const players = Object.entries(state.players).map(([name, p]) => ({ name, ...p }));

  // Build occupancy maps to avoid collisions
  const occupied = new Set();
  for (const m of monsters) occupied.add(`${m.x},${m.y}`);
  for (const p of players) occupied.add(`${p.x},${p.y}`);

  // We'll update positions in a new object to avoid conflicts
  const updates = {};

  for (const m of monsters) {
    if (!state.monsters[m.id]) continue; // might have died earlier
    // find nearest player
    let best = null;
    let bestDist = 1e9;
    for (const p of players) {
      const d = Math.abs(p.x - m.x) + Math.abs(p.y - m.y);
      if (d < bestDist) { bestDist = d; best = p; }
    }

    if (!best) continue;

    // if adjacent -> attack
    if (bestDist === 1) {
      // attack player
      const damage = Math.max(1, m.atk + Math.floor(Math.random() * 2));
      const playerObj = state.players[best.name];
      playerObj.hp -= damage;
      // if player dies -> respawn and drop inventory
      let narrative = `The ${m.type} attacks ${best.name} for ${damage} damage.`;
      if (playerObj.hp <= 0) {
        // drop inventory
        const drops = playerObj.inventory.splice(0, playerObj.inventory.length);
        drops.forEach(it => {
          const id = state.nextItemId++;
          state.items[id] = { id, x: playerObj.x, y: playerObj.y, type: it.type, name: it.name };
        });
        playerObj.hp = Math.floor(playerObj.maxHp / 2);
        const centerY = Math.floor(state.map.length / 2);
        const centerX = Math.floor(state.map[0].length / 2);
        playerObj.x = centerX; playerObj.y = centerY;
        // narrative appended by caller (we return narrative at end of turn)
      }
      // no movement occurs for attacker
      continue;
    }

    // if player within aggro range (5), move toward them
    if (bestDist <= 5) {
      const dx = Math.sign(best.x - m.x);
      const dy = Math.sign(best.y - m.y);
      // try horizontal then vertical (try both)
      const tryPositions = [
        { x: m.x + dx, y: m.y },
        { x: m.x, y: m.y + dy },
        { x: m.x + dx, y: m.y + dy } // diagonal attempt rarely
      ];
      let moved = false;
      for (const pos of tryPositions) {
        if (!isWalkable(state, pos.x, pos.y)) continue;
        const key = `${pos.x},${pos.y}`;
        if (occupied.has(key)) continue;
        // reserve new position
        updates[m.id] = { x: pos.x, y: pos.y };
        occupied.delete(`${m.x},${m.y}`);
        occupied.add(key);
        moved = true;
        break;
      }
      if (moved) continue;
    }

    // otherwise small chance to random-walk
    if (Math.random() < 0.3) {
      const cand = shuffleDirs().map(d => ({ x: m.x + d.x, y: m.y + d.y }));
      for (const pos of cand) {
        if (!isWalkable(state, pos.x, pos.y)) continue;
        const key = `${pos.x},${pos.y}`;
        if (occupied.has(key)) continue;
        updates[m.id] = { x: pos.x, y: pos.y };
        occupied.delete(`${m.x},${m.y}`);
        occupied.add(key);
        break;
      }
    }
  }

  // apply updates
  for (const idStr of Object.keys(updates)) {
    const id = Number(idStr);
    const u = updates[id];
    if (state.monsters[id]) {
      state.monsters[id].x = u.x;
      state.monsters[id].y = u.y;
    }
  }
}

/* helpers used by monstersAct */
function isWalkable(state, x, y) {
  if (y < 0 || y >= state.map.length || x < 0 || x >= state.map[0].length) return false;
  if (state.map[y][x] !== '.') return false;
  // check monsters & players occupancy
  for (const m of Object.values(state.monsters)) {
    if (m.x === x && m.y === y) return false;
  }
  for (const p of Object.values(state.players)) {
    if (p.x === x && p.y === y) return false;
  }
  return true;
}

function shuffleDirs() {
  const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
  shuffleArray(dirs);
  return dirs;
}

/* -------------------------
   Command processing
   ------------------------- */
function processCommand(state, username, command) {
  const trimmed = (command || '').trim();
  if (!trimmed) {
    return { state, narrative: `**${username}** sent an empty command.`, asciiMap: renderAsciiMap(state, username) };
  }
  const lower = trimmed.toLowerCase();

  // /spawn regenerates a fresh dungeon (admin or testing)
  if (lower.startsWith('/spawn')) {
    const newState = generateRandomState();
    newState.turn = (state.turn || 0) + 1;
    return { state: newState, narrative: `**${username}** regenerated the dungeon.`, asciiMap: renderAsciiMap(newState, username) };
  }

  // Ensure player exists and state fields are present (migration safety)
  if (!state.monsters) state.monsters = {};
  if (!state.items) state.items = {};
  if (typeof state.nextMonsterId === 'undefined') state.nextMonsterId = 1;
  if (typeof state.nextItemId === 'undefined') state.nextItemId = 1;
  if (typeof state.turn === 'undefined') state.turn = 0;

  ensurePlayer(state, username);
  const player = state.players[username];

  // /look
  if (lower === '/look') {
    state.turn++;
    const nearby = describeNearby(state, player.x, player.y);
    const narrative = `**${username}** looks around the dungeon.\n\n${nearby}`;
    // monsters may still act on look? we will not move monsters on look to let player inspect safely
    return { state, narrative, asciiMap: renderAsciiMap(state, username) };
  }

  // /inventory
  if (lower === '/inventory') {
    const inv = player.inventory.length ? player.inventory.map((it, i) => `${i+1}. ${it.name}`).join('\n') : '_empty_';
    return { state, narrative: `**${username}** opens their inventory:\n${inv}`, asciiMap: renderAsciiMap(state, username) };
  }

  // /use <item>
  if (lower.startsWith('/use ')) {
    const arg = trimmed.slice(5).trim().toLowerCase();
    const idx = player.inventory.findIndex(it => it.type === arg || it.name.toLowerCase().includes(arg));
    if (idx < 0) {
      return { state, narrative: `**${username}** doesn't have "${arg}".`, asciiMap: renderAsciiMap(state, username) };
    }
    const item = player.inventory.splice(idx, 1)[0];
    let narrative = `**${username}** uses ${item.name}.`;
    if (item.type === 'potion') {
      const heal = 8;
      player.hp = Math.min(player.maxHp, player.hp + heal);
      narrative += ` Restored ${heal} HP (HP: ${player.hp}/${player.maxHp}).`;
    } else if (item.type === 'sword') {
      player.atk += 2;
      narrative += ` ${username} feels stronger (+2 ATK).`;
    } else {
      narrative += ` Nothing happens.`;
    }
    state.turn++;
    monstersAct(state); // monsters react after player's use
    return { state, narrative, asciiMap: renderAsciiMap(state, username) };
  }

  // /pickup
  if (lower === '/pickup') {
    const itemEntry = Object.values(state.items).find(it => it.x === player.x && it.y === player.y);
    if (!itemEntry) {
      // monsters act even when trying to pickup nothing
      monstersAct(state);
      state.turn++;
      return { state, narrative: `**${username}** finds nothing to pick up here.`, asciiMap: renderAsciiMap(state, username) };
    }
    const id = itemEntry.id;
    const item = state.items[id];
    player.inventory.push({ id: item.id, type: item.type, name: item.name });
    delete state.items[id];
    state.turn++;
    monstersAct(state);
    return { state, narrative: `**${username}** picked up ${item.name}.`, asciiMap: renderAsciiMap(state, username) };
  }

  // /move <dir>
  const moveMatch = lower.match(/^\/move\s+(north|south|east|west)$/);
  if (moveMatch) {
    const dir = moveMatch[1];
    let tx = player.x, ty = player.y;
    if (dir === 'north') ty--;
    if (dir === 'south') ty++;
    if (dir === 'east') tx++;
    if (dir === 'west') tx--;
    if (ty < 0 || ty >= state.map.length || tx < 0 || tx >= state.map[0].length) {
      monstersAct(state); state.turn++;
      return { state, narrative: `**${username}** bumps into the edge of the dungeon.`, asciiMap: renderAsciiMap(state, username) };
    }
    const tile = state.map[ty][tx];
    if (tile !== '.') {
      monstersAct(state); state.turn++;
      return { state, narrative: `**${username}** bumps into a wall.`, asciiMap: renderAsciiMap(state, username) };
    }
    const monsterThere = Object.values(state.monsters).find(m => m.x === tx && m.y === ty);
    if (monsterThere) {
      // cannot walk into monster
      monstersAct(state); state.turn++;
      return { state, narrative: `**${username}** cannot move: a ${monsterThere.type} blocks the way!`, asciiMap: renderAsciiMap(state, username) };
    }
    player.x = tx; player.y = ty;
    state.turn++;
    monstersAct(state);
    return { state, narrative: `**${username}** moves ${dir}.`, asciiMap: renderAsciiMap(state, username) };
  }

  // /attack <dir>
  const atkMatch = lower.match(/^\/attack\s+(north|south|east|west)$/);
  if (atkMatch) {
    const dir = atkMatch[1];
    let tx = player.x, ty = player.y;
    if (dir === 'north') ty--;
    if (dir === 'south') ty++;
    if (dir === 'east') tx++;
    if (dir === 'west') tx--;
    if (ty < 0 || ty >= state.map.length || tx < 0 || tx >= state.map[0].length) {
      monstersAct(state); state.turn++;
      return { state, narrative: `**${username}** swings at nothing.`, asciiMap: renderAsciiMap(state, username) };
    }
    const target = Object.values(state.monsters).find(m => m.x === tx && m.y === ty);
    if (!target) {
      monstersAct(state); state.turn++;
      return { state, narrative: `**${username}** swings at empty air — no monster there.`, asciiMap: renderAsciiMap(state, username) };
    }

    // player attack
    const dmg = Math.max(1, player.atk + (Math.floor(Math.random() * 3) - 1));
    target.hp -= dmg;
    let narrative = `**${username}** attacks the ${target.type} for ${dmg} damage (HP left: ${Math.max(0, target.hp)}).`;

    // if monster dies -> award XP and possibly drop
    if (target.hp <= 0) {
      narrative += ` The ${target.type} dies!`;
      const stats = monsterStatsByType(target.type);
      player.xp = (player.xp || 0) + (stats.xp || 5);
      narrative += ` Gained ${stats.xp || 5} XP.`;
      // drop chance
      if (Math.random() < 0.5) {
        const id = state.nextItemId++;
        const itemType = (Math.random() < 0.5) ? 'gem' : 'potion';
        state.items[id] = { id, x: target.x, y: target.y, type: itemType, name: itemNameByType(itemType) };
        narrative += ` It dropped ${state.items[id].name}.`;
      }
      delete state.monsters[target.id];
      // level up check
      if (tryLevelUp(player)) narrative += `\n**${username}** leveled up to level ${player.level}! (+4 HP, +1 ATK)`;
      state.turn++;
      monstersAct(state);
      return { state, narrative, asciiMap: renderAsciiMap(state, username) };
    }

    // monster retaliates
    const monAtk = Math.max(1, target.atk + Math.floor(Math.random() * 2));
    player.hp -= monAtk;
    narrative += ` The ${target.type} counterattacks for ${monAtk} damage (You HP: ${Math.max(0, player.hp)}/${player.maxHp}).`;

    // if player dies
    if (player.hp <= 0) {
      const drops = player.inventory.splice(0, player.inventory.length);
      drops.forEach(it => {
        const id = state.nextItemId++;
        state.items[id] = { id, x: player.x, y: player.y, type: it.type, name: it.name };
      });
      player.hp = Math.floor(player.maxHp / 2);
      const centerY = Math.floor(state.map.length / 2);
      const centerX = Math.floor(state.map[0].length / 2);
      player.x = centerX; player.y = centerY;
      narrative += `\n**${username}** was defeated and wakes up at the dungeon center (HP: ${player.hp}/${player.maxHp}).`;
    }

    state.turn++;
    monstersAct(state);
    return { state, narrative, asciiMap: renderAsciiMap(state, username) };
  }

  // default unknown command
  return {
    state,
    narrative: `**${username}** tried an unknown command. Use \`/look\`, \`/move <direction>\`, \`/attack <direction>\`, \`/pickup\`, \`/inventory\`, or \`/use <item>\`.`,
    asciiMap: renderAsciiMap(state, username)
  };
}

/* -------------------------
   Nearby description
   ------------------------- */
function describeNearby(state, x, y, radius = 4) {
  const found = [];
  for (const m of Object.values(state.monsters)) {
    const d = Math.abs(m.x - x) + Math.abs(m.y - y);
    if (d <= radius) found.push(`Monster: ${m.type} at (${m.x},${m.y}) HP:${m.hp}`);
  }
  for (const it of Object.values(state.items)) {
    const d = Math.abs(it.x - x) + Math.abs(it.y - y);
    if (d <= radius) found.push(`Item: ${it.name} at (${it.x},${it.y})`);
  }
  if (found.length === 0) return '_No monsters or items nearby._';
  return found.join('\n');
}

/* -------------------------
   Exports
   ------------------------- */
module.exports = {
  loadState,
  saveState,
  ensurePlayer,
  renderAsciiMap,
  processCommand,
  generateRandomState
};
