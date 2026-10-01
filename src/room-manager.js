// src/room-manager.js
// Quản lý phòng chơi, thiết bị kết nối, điều khiển MC, bảo vệ ngắt kết nối và Bot AI tự động

const {
  createInitialGameState,
  startPlacementPhase,
  startBattlePhase,
  advanceTurn,
  calculateBotTarget,
  processShot,
  processCrossfire,
  undoLastShot,
  generateRandomFleetInZone,
  validateCustomFleet,
  getScreenState,
  getPlayerState,
  getHostState,
} = require('./game-engine');

const ROOMS = new Map(); // roomId -> RoomObject
const DISCONNECT_GRACE_PERIOD_MS = 5 * 60 * 1000;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function createRoom(options = {}) {
  let roomId = generateRoomCode();
  while (ROOMS.has(roomId)) {
    roomId = generateRoomCode();
  }

  const hostToken = generateToken();
  const gameState = createInitialGameState(options);

  const room = {
    roomId,
    hostToken,
    createdAt: Date.now(),
    gameState,
    sockets: {
      host: null,
      screens: new Set(),
      teams: new Map(), // teamId -> socketId
    },
    playerSessions: new Map(), // deviceToken -> { teamId, lastSeen }
    disconnectTimers: new Map(),
    botTurnTimer: null,
  };

  ROOMS.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  if (!roomId) return null;
  return ROOMS.get(roomId.toUpperCase().trim()) || null;
}

function registerHost(roomId, socketId) {
  const room = getRoom(roomId);
  if (!room) return false;
  room.sockets.host = socketId;
  return true;
}

function registerScreen(roomId, socketId) {
  const room = getRoom(roomId);
  if (!room) return false;
  room.sockets.screens.add(socketId);
  return true;
}

function updateRoomConfig(roomId, newConfig = {}) {
  const room = getRoom(roomId);
  if (!room || room.gameState.phase !== 'LOBBY') return false;

  const currentOpts = room.gameState.config;
  const updatedOpts = {
    gridCols: newConfig.gridCols !== undefined ? newConfig.gridCols : currentOpts.gridCols,
    gridRows: newConfig.gridRows !== undefined ? newConfig.gridRows : currentOpts.gridRows,
    playerCount: newConfig.playerCount !== undefined ? newConfig.playerCount : currentOpts.playerCount,
    shipsPerPlayer: newConfig.shipsPerPlayer !== undefined ? newConfig.shipsPerPlayer : currentOpts.shipsPerPlayer,
    shipConfigMode: newConfig.shipConfigMode || currentOpts.shipConfigMode,
    turnOrderMode: newConfig.turnOrderMode || currentOpts.turnOrderMode,
  };

  const oldTeams = room.gameState.teams;
  const newGameState = createInitialGameState(updatedOpts);

  newGameState.teams.forEach(nt => {
    const ot = oldTeams.find(t => t.id === nt.id);
    if (ot) {
      nt.customName = ot.customName;
      nt.isConnected = ot.isConnected;
      nt.isReady = ot.isReady;
      nt.isBot = ot.isBot;
      nt.deviceToken = ot.deviceToken;
    }
  });

  room.gameState = newGameState;
  return true;
}

/**
 * Thêm 1 máy (Bot) vào đội còn trống
 */
function addBot(roomId) {
  const room = getRoom(roomId);
  if (!room || room.gameState.phase !== 'LOBBY') return null;

  const targetTeam = room.gameState.teams.find(t => !t.isConnected && !t.isBot);
  if (!targetTeam) return null;

  targetTeam.isBot = true;
  targetTeam.isConnected = true;
  targetTeam.isReady = true;
  targetTeam.customName = `Chiến Hạm Máy #${targetTeam.id} 🤖`;

  return targetTeam;
}

/**
 * Lấp đầy tất cả các đội còn trống bằng máy (Bot)
 */
function fillRemainingBots(roomId) {
  const room = getRoom(roomId);
  if (!room || room.gameState.phase !== 'LOBBY') return 0;

  let added = 0;
  room.gameState.teams.forEach(t => {
    if (!t.isConnected && !t.isBot) {
      t.isBot = true;
      t.isConnected = true;
      t.isReady = true;
      t.customName = `Chiến Hạm Máy #${t.id} 🤖`;
      added++;
    }
  });

  return added;
}

/**
 * Xóa bot khỏi một đội
 */
function removeBot(roomId, teamId) {
  const room = getRoom(roomId);
  if (!room || room.gameState.phase !== 'LOBBY') return false;

  const team = room.gameState.teams.find(t => t.id === teamId);
  if (!team || !team.isBot) return false;

  team.isBot = false;
  team.isConnected = false;
  team.isReady = false;
  team.customName = '';

  return true;
}

function joinTeam(roomId, { teamId, playerName, deviceToken, socketId }) {
  const room = getRoom(roomId);
  if (!room) return { success: false, error: 'Phòng không tồn tại' };

  let team = null;
  if (deviceToken) {
    team = room.gameState.teams.find(t => t.deviceToken === deviceToken);
  }
  const parsedTeamId = teamId ? parseInt(teamId, 10) : null;
  if (!team && parsedTeamId) {
    const candidate = room.gameState.teams.find(t => t.id === parsedTeamId);
    if (candidate && (!candidate.isConnected || candidate.deviceToken === deviceToken)) {
      team = candidate;
    }
  }
  if (!team) {
    team = room.gameState.teams.find(t => !t.isConnected && !t.isBot);
  }
  if (!team) {
    return { success: false, error: 'Phòng đã đủ số lượng người chơi!' };
  }

  const finalTeamId = team.id;
  if (room.disconnectTimers.has(finalTeamId)) {
    clearTimeout(room.disconnectTimers.get(finalTeamId));
    room.disconnectTimers.delete(finalTeamId);
  }

  let finalToken = deviceToken;
  if (!finalToken) {
    finalToken = generateToken();
  }

  team.deviceToken = finalToken;
  team.isConnected = true;
  team.isBot = false;
  team.isReady = true;
  if (playerName && playerName.trim()) {
    team.customName = playerName.trim().substring(0, 20);
    team.name = team.customName;
  } else if (!team.name) {
    team.name = `Chiến Hạm #${finalTeamId}`;
    team.customName = team.name;
  }

  room.sockets.teams.set(finalTeamId, socketId);
  room.playerSessions.set(finalToken, { teamId: finalTeamId, lastSeen: Date.now() });

  return {
    success: true,
    teamId: finalTeamId,
    deviceToken: finalToken,
    team,
    phase: room.gameState.phase,
  };
}

function toggleTeamReady(roomId, teamId) {
  const room = getRoom(roomId);
  if (!room) return false;
  const team = room.gameState.teams.find(t => t.id === teamId);
  if (!team) return false;
  team.isReady = !team.isReady;
  return true;
}

function startPlacement(roomId) {
  const room = getRoom(roomId);
  if (!room) return false;
  return startPlacementPhase(room.gameState);
}

function autoPlaceTeamFleet(roomId, teamId) {
  const room = getRoom(roomId);
  if (!room) return { success: false, error: 'Phòng không tồn tại' };
  const team = room.gameState.teams.find(t => t.id === teamId);
  if (!team) return { success: false, error: 'Không tìm thấy đội' };

  const zone = room.gameState.zones[teamId];
  team.fleet = generateRandomFleetInZone(zone, room.gameState.config.shipLengths);
  team.isFleetLocked = true;
  return { success: true, fleet: team.fleet };
}

function lockTeamFleet(roomId, teamId, fleet) {
  const room = getRoom(roomId);
  if (!room) return { success: false, error: 'Phòng không tồn tại' };
  const team = room.gameState.teams.find(t => t.id === teamId);
  if (!team) return { success: false, error: 'Không tìm thấy đội' };

  const zone = room.gameState.zones[teamId];
  const validation = validateCustomFleet(fleet, zone, room.gameState.config.shipLengths);

  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  team.fleet = fleet.map((s, idx) => ({
    id: `ship_${idx + 1}`,
    name: s.cells.length === 4 ? `Thiết Giáp Hạm ${idx + 1}` : `Tuần Dương Hạm ${idx + 1}`,
    size: s.cells.length,
    orientation: s.orientation || 'H',
    cells: s.cells,
    hits: [],
    isSunk: false,
  }));
  team.isFleetLocked = true;

  return { success: true, fleet: team.fleet };
}

function startBattle(roomId, manualTurnOrder = null) {
  const room = getRoom(roomId);
  if (!room) return false;
  return startBattlePhase(room.gameState, manualTurnOrder);
}

function handleShot(roomId, teamId, targetKey) {
  const room = getRoom(roomId);
  if (!room) return { success: false, error: 'Phòng không tồn tại' };
  return processShot(room.gameState, teamId, targetKey);
}

function handleCrossfire(roomId, teamId, centerKey) {
  const room = getRoom(roomId);
  if (!room) return { success: false, error: 'Phòng không tồn tại' };
  return processCrossfire(room.gameState, teamId, centerKey);
}

function manualChangeTurn(roomId, targetTeamId) {
  const room = getRoom(roomId);
  if (!room || room.gameState.phase !== 'BATTLE') return false;

  const parsedId = parseInt(targetTeamId, 10);
  const targetTeam = room.gameState.teams.find(t => t.id === parsedId);
  if (!targetTeam || targetTeam.isEliminated) return false;

  const idx = room.gameState.turnOrder.indexOf(parsedId);
  if (idx !== -1) {
    room.gameState.currentTurnIndex = idx;
    room.gameState.currentTurnTeamId = parsedId;
    return true;
  }
  return false;
}

function undoShot(roomId) {
  const room = getRoom(roomId);
  if (!room) return false;
  return undoLastShot(room.gameState);
}

function resetGame(roomId) {
  const room = getRoom(roomId);
  if (!room) return false;

  if (room.botTurnTimer) {
    clearTimeout(room.botTurnTimer);
    room.botTurnTimer = null;
  }

  const oldConfig = room.gameState.config;
  const oldTeams = room.gameState.teams;

  room.gameState = createInitialGameState(oldConfig);

  room.gameState.teams.forEach(nt => {
    const ot = oldTeams.find(t => t.id === nt.id);
    if (ot) {
      nt.customName = ot.customName;
      nt.isConnected = ot.isConnected;
      nt.isBot = ot.isBot;
      nt.isReady = ot.isReady;
      nt.deviceToken = ot.deviceToken;
    }
  });

  return true;
}

function handleDisconnect(socketId) {
  let affectedRoom = null;

  for (const [rId, room] of ROOMS.entries()) {
    if (room.sockets.host === socketId) {
      room.sockets.host = null;
      affectedRoom = room;
    }

    if (room.sockets.screens.has(socketId)) {
      room.sockets.screens.delete(socketId);
      affectedRoom = room;
    }

    for (const [teamId, sId] of room.sockets.teams.entries()) {
      if (sId === socketId) {
        room.sockets.teams.delete(teamId);
        const team = room.gameState.teams.find(t => t.id === teamId);
        if (team && !team.isBot) {
          team.isConnected = false;
          const timer = setTimeout(() => {
            room.disconnectTimers.delete(teamId);
          }, DISCONNECT_GRACE_PERIOD_MS);
          room.disconnectTimers.set(teamId, timer);
        }
        affectedRoom = room;
      }
    }
  }

  return affectedRoom;
}

module.exports = {
  ROOMS,
  createRoom,
  getRoom,
  registerHost,
  registerScreen,
  updateRoomConfig,
  addBot,
  fillRemainingBots,
  removeBot,
  joinTeam,
  toggleTeamReady,
  startPlacement,
  autoPlaceTeamFleet,
  lockTeamFleet,
  startBattle,
  handleShot,
  handleCrossfire,
  manualChangeTurn,
  undoShot,
  resetGame,
  handleDisconnect,
  getScreenState,
  getPlayerState,
  getHostState,
};
