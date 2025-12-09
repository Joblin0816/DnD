const fs = require('fs').promises;
const path = require('path');

/**
 * Load the state for a given session
 */
async function loadState(sessionId) {
  const stateFile = path.join(process.cwd(), 'state', `session-${sessionId}.json`);
  try {
    const data = await fs.readFile(stateFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to load state for session ${sessionId}: ${error.message}`);
  }
}

/**
 * Save the state for a given session
 */
async function saveState(sessionId, state) {
  const stateFile = path.join(process.cwd(), 'state', `session-${sessionId}.json`);
  try {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    throw new Error(`Failed to save state for session ${sessionId}: ${error.message}`);
  }
}

/**
 * Random dungeon generator
 * Produces a state object if called with no existing state
 */
function generateRandomState(width = 11, height = 9, monsterCount = 6, itemCount = 6) {
  // Ensure odd width/height for nicer central spawn
  if (width % 2 === 0) width++;
  if (height % 2 === 0) height++;

  const map = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      // border walls
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row += '#';
      } else {
        // random walls
        row += (Math.random() < 0.2) ? '#' : '.';
      }
    }
    map.push(row);
  }

  // Clear center region for spawn
  const centerY = Math.floor(height / 2);
  const centerX = Math.floor(width / 2);
  map[centerY] = replaceChar(map[centerY], centerX, '.');
  if (centerX + 1 < width - 1) map[centerY] = replaceChar(map[centerY], centerX + 1, '.');
  if (centerX - 1 > 0) map[centerY] = replaceChar(map[centerY], centerX - 1, '.');

  const state = {
    map,
    players: {}, // playerName -> {x,y, hp, maxHp, atk, inventory: []}
    monsters: {}, // id -> {x,y,type,hp,atk}
    items: {}, // id -> {x,y,type,name}
    turn: 0,
    nextMonsterId: 1,
    nextItemId: 1
  };

  // Place monsters randomly on floor tiles
  const floorTiles = getAllFloorTiles(map);
  shuffleArray(floorTiles);
  for (let i = 0; i < Math.min(monsterCount, floorTiles.length); i++) {
    const [x, y] = floorTiles[i];
    const type = randomMonsterType();
    const stats = monsterStatsByType(type);
    const id = state.nextMonsterId++;
    state.monsters[id] = { id, x, y, type, hp: stats.hp, atk: stats.atk };
  }

  // Place items randomly on floor tiles (after monsters)
  const leftover = floorTiles.slice(monsterCount);
  shuffleArray(leftover);
  const itemTypes = ['sword', 'potion', 'gem'];
  for (let i = 0; i < Math.min(itemCount, leftover.length); i++) {
    const [x, y] = leftover[i];
    const type = itemTypes[i % itemTypes.length];
    const id = state.nextItemId++;
    state.items[id] = {
      id,
      x,
      y,
      type,
      name: itemNameByType(type)
    };
  }

  return state;
}

/* --- Utility helpers --- */
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
    case 'demon': return { hp: 12, atk: 4 };
    case 'snake': return { hp: 6, atk: 2 };
    case 'zombie': return { hp: 8, atk: 3 };
    default: return { hp: 5, atk: 1 };
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

/* --- Player ensure/spawn --- */
function ensurePlayer(state, username) {
  if (!state.players[username]) {
    // spawn at center floor tile or first available
    let spawnX, spawnY;
    const centerY = Math.floor(state.map.length / 2);
    const centerX = Math.floor(state.map[0].length / 2);

    if (state.map[centerY][centerX] === '.') {
      spawnX = centerX; spawnY = centerY;
    } else {
      // find first floor tile
      const tiles = getAllFloorTiles(state.map);
      if (tiles.length > 0) {
        [spawnX, spawnY] = tiles[0];
      } else {
        // fallback to center
        spawnX = centerX; spawnY = centerY;
      }
    }

    state.players[username] = {
      x: spawnX,
      y: spawnY,
      hp: 20,
      maxHp: 20,
      atk: 3, // base attack
      inventory: []
    };
  }
}

/* --- Render map to emoji-based ASCII (no ANSI) --- */
function renderAsciiMap(state, username) {
  // Tiles as emojis
  const WALL = "🟥";     // wall
  const FLOOR = "⬜";    // floor
  const PLAYER = "🧙‍♂️"; // player icon
  const OTHER = "👤";    // other players
  const MONSTER_ICONS = {
    demon: "👹",
    snake: "🐍",
    zombie: "🧟"
  };
  const ITEM_ICONS = {
    sword: "🗡️",
    potion: "🧪",
    gem: "💎"
  };

  // work with a 2D array of "cells", but we'll place emojis instead of single characters
  const mapCopy = state.map.map(row => row.split(''));

  // overlay items (we will represent items by single-character placeholders first)
  // We'll create a map of coordinates to what to show (priority: player > monster > item)
  const overlays = {}; // "x,y" -> {type: 'player'|'monster'|'item', char: emoji}

  // place items
  for (const item of Object.values(state.items)) {
    const key = `${item.x},${item.y}`;
    overlays[key] = overlays[key] || { type: 'item', char: ITEM_ICONS[item.type] || '❔' };
  }

  // place monsters
  for (const m of Object.values(state.monsters)) {
    const key = `${m.x},${m.y}`;
    overlays[key] = { type: 'monster', char: MONSTER_ICONS[m.type] || '👾' };
  }

  // place players (player overwrites)
  for (const [pname, pos] of Object.entries(state.players)) {
    const key = `${pos.x},${pos.y}`;
    const char = (pname === username) ? PLAYER : OTHER;
    overlays[key] = { type: 'player', char };
  }

  // Build rows using emoji tiles: walls/floors replaced, then overlay emojis placed on top
  const rows = [];
  for (let y = 0; y < state.map.length; y++) {
    let rowStr = '';
    for (let x = 0; x < state.map[y].length; x++) {
      const base = state.map[y][x];
      let tileEmoji = base === '#' ? WALL : FLOOR;
      const key = `${x},${y}`;
      if (overlays[key]) {
        tileEmoji = overlays[key].char;
      }
      rowStr += tileEmoji;
    }
    rows.push(rowStr);
  }
  return rows.join('\n');
}

/* --- Command processing --- */
function processCommand(state, username, command) {
  const trimmed = (command || '').trim();
  if (!trimmed) {
    return {
      state,
      narrative: `**${username}** sent an empty command.`,
      asciiMap: renderAsciiMap(state, username)
    };
  }
  const lower = trimmed.toLowerCase();
  state.turn = (state.turn || 0);

  // admin spawn dungeon (for testing) - only player named 'owner' can use or you can allow everyone
  if (lower.startsWith('/spawn')) {
    const newState = generateRandomState();
    // keep turn number
    newState.turn = state.turn + 1;
    return {
      state: newState,
      narrative: `**${username}** regenerated the dungeon.`,
      asciiMap: renderAsciiMap(newState, username)
    };
  }

  // ensure player exists
  ensurePlayer(state, username);
  const player = state.players[username];

  // /look
  if (lower === '/look') {
    state.turn++;
    const nearby = describeNearby(state, player.x, player.y);
    const narrative = `**${username}** looks around the dungeon.\n\n${nearby}`;
    return { state, narrative, asciiMap: renderAsciiMap(state, username) };
  }

  // /inventory
  if (lower === '/inventory') {
    const inv = player.inventory.length ? player.inventory.map((it, i) => `${i+1}. ${it.name}`).join('\n') : '_empty_';
    return {
      state,
      narrative: `**${username}** opens their inventory:\n${inv}`,
      asciiMap: renderAsciiMap(state, username)
    };
  }

  // /use <itemName>
  if (lower.startsWith('/use ')) {
    const arg = trimmed.slice(5).trim().toLowerCase();
    const idx = player.inventory.findIndex(it => it.type === arg || it.name.toLowerCase().includes(arg));
    if (idx < 0) {
      return { state, narrative: `**${username}** doesn't have a "${arg}" to use.`, asciiMap: renderAsciiMap(state, username) };
    }
    const item = player.inventory.splice(idx, 1)[0];
    let narrative = `**${username}** uses ${item.name}.`;
    if (item.type === 'potion') {
      const heal = 8;
      player.hp = Math.min(player.maxHp, player.hp + heal);
      narrative += ` Restored ${heal} HP (HP: ${player.hp}/${player.maxHp}).`;
    } else if (item.type === 'sword') {
      // equip sword: add to atk permanently for simplicity
      player.atk += 2;
      narrative += ` ${player.name || username} feels stronger (+2 ATK).`;
    } else {
      narrative += ` Nothing obvious happens.`;
    }
    state.turn++;
    return { state, narrative, asciiMap: renderAsciiMap(state, username) };
  }

  // /pickup
  if (lower === '/pickup') {
    // find item at player's tile
    const itemId = Object.values(state.items).find(it => it.x === player.x && it.y === player.y);
    if (!itemId) {
      return { state, narrative: `**${username}** finds nothing to pick up here.`, asciiMap: renderAsciiMap(state, username) };
    }
    const id = itemId.id;
    const item = state.items[id];
    // add to inventory
    player.inventory.push({ id: item.id, type: item.type, name: item.name });
    // remove from map
    delete state.items[id];
    state.turn++;
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
    // bounds
    if (ty < 0 || ty >= state.map.length || tx < 0 || tx >= state.map[0].length) {
      return { state, narrative: `**${username}** bumps into the edge of the dungeon.`, asciiMap: renderAsciiMap(state, username) };
    }
    const tile = state.map[ty][tx];
    if (tile !== '.') {
      return { state, narrative: `**${username}** bumps into a wall.`, asciiMap: renderAsciiMap(state, username) };
    }
    // check if monster occupies target tile (can't move into monster)
    const monsterThere = Object.values(state.monsters).find(m => m.x === tx && m.y === ty);
    if (monsterThere) {
      return { state, narrative: `**${username}** cannot move: a ${monsterThere.type} blocks the way!`, asciiMap: renderAsciiMap(state, username) };
    }
    // move
    player.x = tx; player.y = ty;
    state.turn++;
    // auto-pickup if there's an item? (no automatic pickup)
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
    // check bounds
    if (ty < 0 || ty >= state.map.length || tx < 0 || tx >= state.map[0].length) {
      return { state, narrative: `**${username}** swings wildly at nothing.`, asciiMap: renderAsciiMap(state, username) };
    }
    // find monster at that tile
    const target = Object.values(state.monsters).find(m => m.x === tx && m.y === ty);
    if (!target) {
      return { state, narrative: `**${username}** swings at empty air — no monster there.`, asciiMap: renderAsciiMap(state, username) };
    }

    // player attack
    const dmg = Math.max(1, player.atk + (Math.floor(Math.random() * 3) - 1)); // small randomness
    target.hp -= dmg;
    let narrative = `**${username}** attacks the ${target.type} for ${dmg} damage (HP left: ${Math.max(0, target.hp)}).`;

    // if monster dies
    if (target.hp <= 0) {
      narrative += ` The ${target.type} dies!`;
      // drop a gem or potion with some chance
      const drop = Math.random();
      if (drop < 0.5) {
        const id = state.nextItemId++;
        const itemType = (Math.random() < 0.5) ? 'gem' : 'potion';
        state.items[id] = { id, x: target.x, y: target.y, type: itemType, name: itemNameByType(itemType) };
        narrative += ` It dropped a ${state.items[id].name}.`;
      }
      // remove monster
      delete state.monsters[target.id];
      state.turn++;
      return { state, narrative, asciiMap: renderAsciiMap(state, username) };
    }

    // monster retaliates if still alive
    const monAtk = Math.max(1, target.atk + (Math.floor(Math.random() * 2))); // small randomness
    player.hp -= monAtk;
    narrative += ` The ${target.type} counterattacks for ${monAtk} damage (You HP: ${Math.max(0, player.hp)}/${player.maxHp}).`;

    // if player dies
    if (player.hp <= 0) {
      // respawn player at center with half HP and drop all inventory
      const dropItems = player.inventory.splice(0, player.inventory.length);
      // scatter drops at player's pos
      dropItems.forEach(it => {
        const id = state.nextItemId++;
        state.items[id] = { id, x: player.x, y: player.y, type: it.type, name: it.name };
      });

      // respawn
      player.hp = Math.floor(player.maxHp / 2);
      const centerY = Math.floor(state.map.length / 2);
      const centerX = Math.floor(state.map[0].length / 2);
      player.x = centerX; player.y = centerY;
      narrative += `\n**${username}** was defeated and wakes up at the dungeon center (HP: ${player.hp}/${player.maxHp}).`;
    }

    state.turn++;
    return { state, narrative, asciiMap: renderAsciiMap(state, username) };
  }

  // default unknown
  return {
    state,
    narrative: `**${username}** tried an unknown command. Use \`/look\`, \`/move <direction>\`, \`/attack <direction>\`, \`/pickup\`, \`/inventory\`, or \`/use <item>\`.`,
    asciiMap: renderAsciiMap(state, username)
  };
}

/* --- Utility: describe nearby entities --- */
function describeNearby(state, x, y, radius = 3) {
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

/* --- Exported API --- */
module.exports = {
  loadState,
  saveState,
  ensurePlayer,
  renderAsciiMap,
  processCommand,
  generateRandomState // exported so you can call from other scripts if needed
};
