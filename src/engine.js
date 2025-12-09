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
 * Ensure a player exists in the game state
 * If they don't exist, spawn them at the center floor tile
 */
function ensurePlayer(state, username) {
  if (!state.players[username]) {
    // Find center of the map (or first available floor tile)
    const centerY = Math.floor(state.map.length / 2);
    const centerX = Math.floor(state.map[0].length / 2);
    
    // Spawn at center if it's a floor, otherwise find first floor tile
    let spawnX = centerX;
    let spawnY = centerY;
    
    if (state.map[centerY][centerX] !== '.') {
      // Find first floor tile
      for (let y = 0; y < state.map.length; y++) {
        for (let x = 0; x < state.map[y].length; x++) {
          if (state.map[y][x] === '.') {
            spawnX = x;
            spawnY = y;
            break;
          }
        }
        if (state.map[spawnY][spawnX] === '.') break;
      }
    }
    
    state.players[username] = { x: spawnX, y: spawnY };
  }
}

/**
 * Render an ASCII map from the perspective of a specific player
 * @ = the player viewing the map
 * * = other players
 * # = walls
 * . = floor
 */
function renderAsciiMap(state, username) {
  // ANSI Color Codes
  const GREEN = "\u001b[32m";   // floor
  const BLUE = "\u001b[34m";    // walls
  const RED = "\u001b[31m";     // your player
  const YELLOW = "\u001b[33m";  // other players
  const RESET = "\u001b[0m";

  // Copy map into a 2D character array
  const mapCopy = state.map.map(row => row.split(''));

  // Place players
  for (const [playerName, position] of Object.entries(state.players)) {
    const char = playerName === username ? "🧙‍♂️" : "👤";

    if (
      position.y >= 0 && position.y < mapCopy.length &&
      position.x >= 0 && position.x < mapCopy[position.y].length
    ) {
      mapCopy[position.y][position.x] = char;
    }
  }

  // Build colorized map
  const colored = mapCopy
    .map(row =>
      row
        .map(cell => {
          if (cell === "#") return BLUE + cell + RESET;        // walls
          if (cell === ".") return GREEN + cell + RESET;       // floor
          if (cell === "🧙‍♂️") return RED + cell + RESET;     // you
          if (cell === "👤") return YELLOW + cell + RESET;     // other players
          return cell;
        })
        .join("")
    )
    .join("\n");

  return colored;
}


/**
 * Process a command for a specific player
 * Returns an object with: { state, narrative, asciiMap }
 */
function processCommand(state, username, command) {
  const trimmedCommand = command.trim().toLowerCase();
  
  // Handle /look command
  if (trimmedCommand === '/look') {
    state.turn++;
    
    return {
      state,
      narrative: `**${username}** looks around the dungeon.`,
      asciiMap: renderAsciiMap(state, username)
    };
  }
  
  // Handle /move command
  const moveMatch = trimmedCommand.match(/^\/move\s+(north|south|east|west)$/);
  if (moveMatch) {
    const direction = moveMatch[1];
    const player = state.players[username];
    
    // Calculate target position
    let targetX = player.x;
    let targetY = player.y;
    
    switch (direction) {
      case 'north':
        targetY--;
        break;
      case 'south':
        targetY++;
        break;
      case 'east':
        targetX++;
        break;
      case 'west':
        targetX--;
        break;
    }
    
    // Check if target is valid
    if (targetY < 0 || targetY >= state.map.length ||
        targetX < 0 || targetX >= state.map[targetY].length) {
      // Out of bounds
      return {
        state,
        narrative: `**${username}** bumps into a wall.`,
        asciiMap: renderAsciiMap(state, username)
      };
    }
    
    const targetTile = state.map[targetY][targetX];
    
    if (targetTile === '.') {
      // Valid move
      player.x = targetX;
      player.y = targetY;
      state.turn++;
      
      return {
        state,
        narrative: `**${username}** moves ${direction}.`,
        asciiMap: renderAsciiMap(state, username)
      };
    } else {
      // Hit a wall
      return {
        state,
        narrative: `**${username}** bumps into a wall.`,
        asciiMap: renderAsciiMap(state, username)
      };
    }
  }
  
  // Unknown command
  return {
    state,
    narrative: `**${username}** tried an unknown command. Use \`/look\` or \`/move <direction>\`.`,
    asciiMap: renderAsciiMap(state, username)
  };
}

module.exports = {
  loadState,
  saveState,
  ensurePlayer,
  renderAsciiMap,
  processCommand
};
