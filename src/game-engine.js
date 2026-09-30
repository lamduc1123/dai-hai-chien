// src/game-engine.js
// Logic xử lý Đại Hải Đồ 20x20 (400 ô), phân vùng 2-8 người chơi, đếm ngược 60s, kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+)

(() => {
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']; // 20 cột (A -> T)
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; // 20 hàng (1 -> 20)
const GRID_WIDTH = COLS.length;  // 20
const GRID_HEIGHT = ROWS.length; // 20
const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT; // 400 ô

// 8 Đội chơi với màu sắc và linh vật hải quân đặc trưng
const DEFAULT_TEAMS = [
  { id: 1, name: 'Hải Ưng', colorName: 'Xanh Lam', colorHex: '#2563eb', badgeClass: 'bg-blue-600', icon: '🦅' },
  { id: 2, name: 'Thủy Quái', colorName: 'Đỏ Lửa', colorHex: '#dc2626', badgeClass: 'bg-red-600', icon: '🐙' },
  { id: 3, name: 'Cá Mập Trắng', colorName: 'Xanh Lục', colorHex: '#059669', badgeClass: 'bg-emerald-600', icon: '🦈' },
  { id: 4, name: 'Hạm Đội Vàng', colorName: 'Vàng Kim', colorHex: '#d97706', badgeClass: 'bg-amber-600', icon: '👑' },
  { id: 5, name: 'Sấm Sét Biển', colorName: 'Tím Thạch Anh', colorHex: '#7c3aed', badgeClass: 'bg-purple-600', icon: '⚡' },
  { id: 6, name: 'Bão Biển', colorName: 'Cam Lửa', colorHex: '#ea580c', badgeClass: 'bg-orange-600', icon: '🌊' },
  { id: 7, name: 'Sát Thủ Biển Sâu', colorName: 'Lam Ngọc', colorHex: '#0891b2', badgeClass: 'bg-cyan-600', icon: '🔱' },
  { id: 8, name: 'Sao Biển', colorName: 'Hồng Chiến Hạm', colorHex: '#e11d48', badgeClass: 'bg-rose-600', icon: '⭐' },
];

/**
 * Chuyển tọa độ thành key: VD col 'A', row 1 -> 'A1'
 */
function coordToKey(col, row) {
  return `${col}${row}`;
}

/**
 * Phân tích key 'A1' hoặc 'T20' thành object { col, row, colIdx, rowIdx }
 */
function parseKey(key) {
  if (!key || typeof key !== 'string') return null;
  const match = key.trim().toUpperCase().match(/^([A-T])(20|1[0-9]|[1-9])$/);
  if (!match) return null;
  const col = match[1];
  const row = parseInt(match[2], 10);
  const colIdx = COLS.indexOf(col);
  const rowIdx = row - 1;
  return { col, row, colIdx, rowIdx };
}

/**
 * Kiểm tra tính hợp lệ của tọa độ
 */
function isValidCoord(col, row) {
  return COLS.includes(col) && ROWS.includes(row);
}

/**
 * Lấy danh sách chiều dài các tàu dựa vào cấu hình:
 * shipCount: 1..5
 * shipConfigMode: 'mix34' (xen kẽ 4 và 3), 'size3' (toàn 3 ô), 'size4' (toàn 4 ô)
 */
function getShipLengths(shipCount = 2, shipConfigMode = 'mix34') {
  const count = Math.min(Math.max(1, shipCount), 5);
  if (shipConfigMode === 'size3') {
    return Array(count).fill(3);
  }
  if (shipConfigMode === 'size4') {
    return Array(count).fill(4);
  }
  const pattern = [4, 3, 4, 3, 3];
  return pattern.slice(0, count);
}

/**
 * Thuật toán phân vùng thông minh trên hải đồ 20x20 (400 ô):
 * Chia đại dương 20x20 thành N phân vùng độc lập, không chồng lấn cho N người chơi (2 -> 8 người).
 */
function allocatePlayerZones(playerCount = 4) {
  const count = Math.min(Math.max(2, playerCount), 8);
  const zones = {};
  let sectors = [];

  if (count === 2) {
    // 2 người: Nửa trái (A..J) và Nửa phải (K..T), toàn bộ 20 hàng (10x20 = 200 ô)
    sectors = [
      { colStartIdx: 0, colEndIdx: 9, rowStartIdx: 0, rowEndIdx: 19 },   // A..J, 1..20
      { colStartIdx: 10, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 19 }, // K..T, 1..20
    ];
  } else if (count === 3) {
    // 3 người: 3 dải dọc (7, 7, 6 cột x 20 hàng)
    sectors = [
      { colStartIdx: 0, colEndIdx: 6, rowStartIdx: 0, rowEndIdx: 19 },   // A..G, 1..20
      { colStartIdx: 7, colEndIdx: 13, rowStartIdx: 0, rowEndIdx: 19 },  // H..N, 1..20
      { colStartIdx: 14, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 19 }, // O..T, 1..20
    ];
  } else if (count === 4) {
    // 4 người: 4 góc phần tư đối xứng (10 cột x 10 hàng = 100 ô mỗi đội)
    sectors = [
      { colStartIdx: 0, colEndIdx: 9, rowStartIdx: 0, rowEndIdx: 9 },     // Tây Bắc: A..J, 1..10
      { colStartIdx: 10, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 9 },   // Đông Bắc: K..T, 1..10
      { colStartIdx: 0, colEndIdx: 9, rowStartIdx: 10, rowEndIdx: 19 },   // Tây Nam: A..J, 11..20
      { colStartIdx: 10, colEndIdx: 19, rowStartIdx: 10, rowEndIdx: 19 }, // Đông Nam: K..T, 11..20
    ];
  } else if (count === 5 || count === 6) {
    // 5-6 người: 2 hàng x 3 cột (mỗi vùng ~7 cột x 10 hàng = 60-70 ô)
    sectors = [
      { colStartIdx: 0, colEndIdx: 6, rowStartIdx: 0, rowEndIdx: 9 },     // A..G, 1..10
      { colStartIdx: 7, colEndIdx: 13, rowStartIdx: 0, rowEndIdx: 9 },    // H..N, 1..10
      { colStartIdx: 14, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 9 },   // O..T, 1..10
      { colStartIdx: 0, colEndIdx: 6, rowStartIdx: 10, rowEndIdx: 19 },   // A..G, 11..20
      { colStartIdx: 7, colEndIdx: 13, rowStartIdx: 10, rowEndIdx: 19 },  // H..N, 11..20
      { colStartIdx: 14, colEndIdx: 19, rowStartIdx: 10, rowEndIdx: 19 }, // O..T, 11..20
    ];
  } else {
    // 7-8 người: 2 hàng x 4 cột (mỗi vùng 5 cột x 10 hàng = 50 ô)
    sectors = [
      { colStartIdx: 0, colEndIdx: 4, rowStartIdx: 0, rowEndIdx: 9 },     // A..E, 1..10
      { colStartIdx: 5, colEndIdx: 9, rowStartIdx: 0, rowEndIdx: 9 },     // F..J, 1..10
      { colStartIdx: 10, colEndIdx: 14, rowStartIdx: 0, rowEndIdx: 9 },   // K..O, 1..10
      { colStartIdx: 15, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 9 },   // P..T, 1..10
      { colStartIdx: 0, colEndIdx: 4, rowStartIdx: 10, rowEndIdx: 19 },   // A..E, 11..20
      { colStartIdx: 5, colEndIdx: 9, rowStartIdx: 10, rowEndIdx: 19 },   // F..J, 11..20
      { colStartIdx: 10, colEndIdx: 14, rowStartIdx: 10, rowEndIdx: 19 }, // K..O, 11..20
      { colStartIdx: 15, colEndIdx: 19, rowStartIdx: 10, rowEndIdx: 19 }, // P..T, 11..20
    ];
  }

  for (let i = 0; i < count; i++) {
    const sec = sectors[i];
    const cells = [];
    for (let c = sec.colStartIdx; c <= sec.colEndIdx; c++) {
      for (let r = sec.rowStartIdx; r <= sec.rowEndIdx; r++) {
        cells.push(coordToKey(COLS[c], ROWS[r]));
      }
    }
    const teamId = i + 1;
    zones[teamId] = {
      teamId,
      colStart: COLS[sec.colStartIdx],
      colEnd: COLS[sec.colEndIdx],
      rowStart: ROWS[sec.rowStartIdx],
      rowEnd: ROWS[sec.rowEndIdx],
      colStartIdx: sec.colStartIdx,
      colEndIdx: sec.colEndIdx,
      rowStartIdx: sec.rowStartIdx,
      rowEndIdx: sec.rowEndIdx,
      width: sec.colEndIdx - sec.colStartIdx + 1,
      height: sec.rowEndIdx - sec.rowStartIdx + 1,
      cells,
      name: `Vùng ${COLS[sec.colStartIdx]}${ROWS[sec.rowStartIdx]}-${COLS[sec.colEndIdx]}${ROWS[sec.rowEndIdx]}`,
    };
  }

  return zones;
}

/**
 * Sinh hạm đội ngẫu nhiên nằm hoàn toàn trong hải phận quy định
 */
function generateRandomFleetInZone(zone, shipLengths = [4, 3]) {
  const fleet = [];
  const occupiedCells = new Set();

  for (let i = 0; i < shipLengths.length; i++) {
    const length = shipLengths[i];
    const shipName = length === 4 ? `Chiến Hạm Tuần Dương #${i + 1}` : `Tàu Khu Trục Hộ Tống #${i + 1}`;
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < 500) {
      attempts++;
      const isHorizontal = Math.random() < 0.5;
      let startColIdx, startRowIdx;

      if (isHorizontal) {
        startColIdx = zone.colStartIdx + Math.floor(Math.random() * (zone.width - length + 1));
        startRowIdx = zone.rowStartIdx + Math.floor(Math.random() * zone.height);
      } else {
        startColIdx = zone.colStartIdx + Math.floor(Math.random() * zone.width);
        startRowIdx = zone.rowStartIdx + Math.floor(Math.random() * (zone.height - length + 1));
      }

      const shipCells = [];
      let collision = false;

      for (let step = 0; step < length; step++) {
        const c = isHorizontal ? startColIdx + step : startColIdx;
        const r = isHorizontal ? startRowIdx : startRowIdx + step;
        const cellKey = coordToKey(COLS[c], ROWS[r]);

        if (occupiedCells.has(cellKey)) {
          collision = true;
          break;
        }
        shipCells.push(cellKey);
      }

      if (!collision) {
        shipCells.forEach(cell => occupiedCells.add(cell));
        fleet.push({
          id: `ship_${i + 1}`,
          name: shipName,
          size: length,
          orientation: isHorizontal ? 'horizontal' : 'vertical',
          cells: shipCells,
          hits: [],
          isSunk: false,
        });
        placed = true;
      }
    }

    if (!placed) {
      console.warn(`Không thể đặt tàu kích thước ${length} trong hải phận sau 500 lần thử`);
    }
  }

  return fleet;
}

/**
 * Xác thực hạm đội tùy chỉnh của người chơi
 */
function validateCustomFleet(fleet, zone, expectedLengths = [4, 3]) {
  if (!Array.isArray(fleet)) {
    return { valid: false, error: 'Dữ liệu hạm đội không hợp lệ' };
  }

  if (fleet.length !== expectedLengths.length) {
    return { valid: false, error: `Số lượng tàu yêu cầu: ${expectedLengths.length} (nhận được: ${fleet.length})` };
  }

  const zoneCells = new Set(zone.cells);
  const occupied = new Set();
  const sortedExpected = [...expectedLengths].sort((a, b) => b - a);
  const actualLengths = fleet.map(s => s.cells ? s.cells.length : 0).sort((a, b) => b - a);

  for (let i = 0; i < sortedExpected.length; i++) {
    if (actualLengths[i] !== sortedExpected[i]) {
      return { valid: false, error: `Kích thước tàu không khớp cấu hình (${sortedExpected.join(', ')})` };
    }
  }

  for (let sIdx = 0; sIdx < fleet.length; sIdx++) {
    const ship = fleet[sIdx];
    if (!ship.cells || !Array.isArray(ship.cells) || ship.cells.length === 0) {
      return { valid: false, error: `Tàu #${sIdx + 1} không có tọa độ` };
    }

    for (const cellKey of ship.cells) {
      if (!zoneCells.has(cellKey)) {
        return { valid: false, error: `Tọa độ ${cellKey} nằm ngoài hải phận cho phép của đội` };
      }
      if (occupied.has(cellKey)) {
        return { valid: false, error: `Tọa độ ${cellKey} bị chồng lấn giữa các tàu` };
      }
      occupied.add(cellKey);
    }

    const parsedCells = ship.cells.map(parseKey);
    if (parsedCells.some(p => p === null)) {
      return { valid: false, error: 'Tọa độ tàu không hợp lệ' };
    }

    const isHorizontal = parsedCells.every(p => p.row === parsedCells[0].row);
    const isVertical = parsedCells.every(p => p.col === parsedCells[0].col);

    if (!isHorizontal && !isVertical) {
      return { valid: false, error: `Tàu #${sIdx + 1} phải được đặt trên cùng 1 hàng hoặc cùng 1 cột thẳng` };
    }

    if (isHorizontal) {
      const colIndices = parsedCells.map(p => p.colIdx).sort((a, b) => a - b);
      for (let i = 0; i < colIndices.length - 1; i++) {
        if (colIndices[i + 1] !== colIndices[i] + 1) {
          return { valid: false, error: `Các ô của tàu #${sIdx + 1} phải liền kề nhau` };
        }
      }
    } else {
      const rowIndices = parsedCells.map(p => p.rowIdx).sort((a, b) => a - b);
      for (let i = 0; i < rowIndices.length - 1; i++) {
        if (rowIndices[i + 1] !== rowIndices[i] + 1) {
          return { valid: false, error: `Các ô của tàu #${sIdx + 1} phải liền kề nhau` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Khởi tạo trạng thái phòng đấu hoàn chỉnh
 */
function createInitialGameState(options = {}) {
  const playerCount = Math.min(Math.max(2, options.playerCount || 4), 8);
  const shipsPerPlayer = Math.min(Math.max(1, options.shipsPerPlayer || 2), 5);
  const shipConfigMode = options.shipConfigMode || 'mix34';
  const shipLengths = getShipLengths(shipsPerPlayer, shipConfigMode);
  const turnOrderMode = options.turnOrderMode || 'random';
  const turnDuration = options.turnDuration || 60; // 60s mỗi lượt

  const zones = allocatePlayerZones(playerCount);
  const teams = [];

  for (let i = 0; i < playerCount; i++) {
    const teamId = i + 1;
    const defaultMeta = DEFAULT_TEAMS[i];
    const teamZone = zones[teamId];

    teams.push({
      id: teamId,
      name: defaultMeta.name,
      customName: '',
      colorName: defaultMeta.colorName,
      colorHex: defaultMeta.colorHex,
      badgeClass: defaultMeta.badgeClass,
      icon: defaultMeta.icon,
      isBot: false,
      isConnected: false,
      isReady: false,
      isFleetLocked: false,
      zone: {
        ...teamZone,
      },
      fleet: [],
      shipsRemaining: shipsPerPlayer,
      totalShipCells: shipLengths.reduce((a, b) => a + b, 0),
      hitCellsCount: 0,
      score: 0,
      radarScansRemaining: 2, // 2 lượt quét Radar 3x3
      crossfireRemaining: 1,   // 1 lượt bắn tên lửa chữ thập (+)
      isEliminated: false,
      deviceToken: null,
    });
  }

  return {
    phase: 'LOBBY', // 'LOBBY' -> 'PLACEMENT' -> 'BATTLE' -> 'FINISHED'
    grid: {
      cols: COLS,
      rows: ROWS,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      totalCells: TOTAL_CELLS,
    },
    config: {
      playerCount,
      shipsPerPlayer,
      shipConfigMode,
      shipLengths,
      turnOrderMode,
      turnDuration,
    },
    teams,
    zones,
    turnOrder: [],
    currentTurnIndex: 0,
    currentTurnTeamId: null,
    turnNumber: 0,
    turnTimeRemaining: turnDuration,
    turnStartTime: Date.now(),
    shotsHistory: [],
    shotsMap: {},
    winner: null,
    lastShotResult: null,
    lastRadarRecord: null,
    lastCrossfireRecord: null,
  };
}

/**
 * Xáo trộn thứ tự lượt bắn ngẫu nhiên
 */
function shuffleTurnOrder(teamIds) {
  const shuffled = [...teamIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Khởi động giai đoạn dàn trận (PLACEMENT)
 */
function startPlacementPhase(gameState) {
  if (gameState.phase !== 'LOBBY') return false;
  gameState.phase = 'PLACEMENT';

  gameState.teams.forEach(team => {
    if (team.isBot) {
      const zone = gameState.zones[team.id];
      team.fleet = generateRandomFleetInZone(zone, gameState.config.shipLengths);
      team.isFleetLocked = true;
      team.isReady = true;
    }
  });

  return gameState;
}

/**
 * Khởi động giai đoạn chiến đấu (BATTLE)
 */
function startBattlePhase(gameState, manualOrder = null) {
  if (gameState.phase !== 'PLACEMENT' && gameState.phase !== 'LOBBY') return gameState;

  gameState.teams.forEach(team => {
    if (!team.fleet || team.fleet.length === 0) {
      const zone = gameState.zones[team.id];
      team.fleet = generateRandomFleetInZone(zone, gameState.config.shipLengths);
      team.isFleetLocked = true;
      team.isReady = true;
    }
  });

  const activeTeamIds = gameState.teams.map(t => t.id);
  if (manualOrder && Array.isArray(manualOrder) && manualOrder.length === activeTeamIds.length) {
    gameState.turnOrder = [...manualOrder];
  } else if (gameState.config.turnOrderMode === 'random') {
    gameState.turnOrder = shuffleTurnOrder(activeTeamIds);
  } else {
    gameState.turnOrder = [...activeTeamIds];
  }

  gameState.phase = 'BATTLE';
  gameState.currentTurnIndex = 0;
  gameState.currentTurnTeamId = gameState.turnOrder[0];
  gameState.turnNumber = 1;
  gameState.turnTimeRemaining = gameState.config.turnDuration || 60;
  gameState.turnStartTime = Date.now();
  gameState.lastShotResult = null;

  return gameState;
}

/**
 * Chuyển sang lượt tiếp theo (bỏ qua những đội đã bị loại)
 */
function advanceTurn(gameState) {
  if (gameState.phase !== 'BATTLE') return null;

  const livingTeams = gameState.teams.filter(t => !t.isEliminated);
  if (livingTeams.length <= 1) {
    if (livingTeams.length === 1) {
      gameState.winner = livingTeams[0];
    }
    gameState.phase = 'FINISHED';
    return null;
  }

  const livingIds = new Set(livingTeams.map(t => t.id));
  let attempts = 0;
  let nextIndex = gameState.currentTurnIndex;

  while (attempts < gameState.turnOrder.length) {
    nextIndex = (nextIndex + 1) % gameState.turnOrder.length;
    const candidateId = gameState.turnOrder[nextIndex];
    if (livingIds.has(candidateId)) {
      gameState.currentTurnIndex = nextIndex;
      gameState.currentTurnTeamId = candidateId;
      gameState.turnNumber++;
      gameState.turnTimeRemaining = gameState.config.turnDuration || 60;
      gameState.turnStartTime = Date.now();
      return gameState.currentTurnTeamId;
    }
    attempts++;
  }

  return null;
}

/**
 * Thuật toán tính toán mục tiêu bắn thông minh cho Bot AI:
 * - Ưu tiên săn lùng các ô liền kề xung quanh các ô đã bắn trúng nhưng tàu chưa chìm!
 * - Nếu không có tàu bị thương, chọn ngẫu nhiên các ô chưa bắn.
 */
function calculateBotTarget(gameState, botTeamId) {
  const unfired = [];
  for (let c = 0; c < COLS.length; c++) {
    for (let r = 0; r < ROWS.length; r++) {
      const key = coordToKey(COLS[c], ROWS[r]);
      if (!gameState.shotsMap[key]) {
        unfired.push(key);
      }
    }
  }

  if (unfired.length === 0) return null;

  // Tìm các ô đã trúng nhưng tàu chưa chìm
  const injuredHits = [];
  for (const shot of gameState.shotsHistory) {
    if (shot.result === 'HIT') {
      const targetTeam = gameState.teams.find(t => t.id === shot.hitTeamId);
      if (targetTeam) {
        let isNowSunk = false;
        for (const ship of targetTeam.fleet) {
          if (ship.cells.includes(shot.targetKey) && ship.isSunk) {
            isNowSunk = true;
            break;
          }
        }
        if (!isNowSunk) {
          injuredHits.push(shot.targetKey);
        }
      }
    }
  }

  if (injuredHits.length > 0) {
    const candidates = [];
    for (const hitKey of injuredHits) {
      const parsed = parseKey(hitKey);
      if (!parsed) continue;

      const adjacents = [
        { c: parsed.colIdx, r: parsed.rowIdx - 1 },
        { c: parsed.colIdx, r: parsed.rowIdx + 1 },
        { c: parsed.colIdx - 1, r: parsed.rowIdx },
        { c: parsed.colIdx + 1, r: parsed.rowIdx },
      ];

      for (const adj of adjacents) {
        if (adj.c >= 0 && adj.c < COLS.length && adj.r >= 0 && adj.r < ROWS.length) {
          const adjKey = coordToKey(COLS[adj.c], ROWS[adj.r]);
          if (!gameState.shotsMap[adjKey] && !candidates.includes(adjKey)) {
            candidates.push(adjKey);
          }
        }
      }
    }

    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  // Chọn ngẫu nhiên ô chưa bắn
  return unfired[Math.floor(Math.random() * unfired.length)];
}

/**
 * Thực thi 1 phát bắn đơn lẻ vào tọa độ targetKey (dùng chung cho bắn thường và tên lửa chữ thập)
 */
function executeSingleShot(gameState, shooterTeamId, targetKey) {
  const parsed = parseKey(targetKey);
  if (!parsed) return { success: false, error: 'Tọa độ không hợp lệ' };
  if (gameState.shotsMap[targetKey]) return { success: false, error: 'Ô này đã bị bắn' };

  const shooterTeam = gameState.teams.find(t => t.id === shooterTeamId);
  if (!shooterTeam) return { success: false, error: 'Không tìm thấy đội bắn' };

  let hitInfo = null;

  for (const team of gameState.teams) {
    for (const ship of team.fleet) {
      if (ship.cells.includes(targetKey)) {
        hitInfo = { targetTeam: team, ship };
        break;
      }
    }
    if (hitInfo) break;
  }

  let result = 'MISS';
  let sunkShip = null;
  let eliminatedTeam = null;

  if (hitInfo) {
    result = 'HIT';
    const { targetTeam, ship } = hitInfo;

    if (!ship.hits.includes(targetKey)) {
      ship.hits.push(targetKey);
    }
    targetTeam.hitCellsCount = (targetTeam.hitCellsCount || 0) + 1;

    if (ship.hits.length === ship.size) {
      ship.isSunk = true;
      sunkShip = {
        name: ship.name,
        size: ship.size,
        teamId: targetTeam.id,
        teamName: targetTeam.customName || targetTeam.name,
        cells: ship.cells,
      };
      targetTeam.shipsRemaining = Math.max(0, targetTeam.shipsRemaining - 1);
      result = 'SUNK';

      if (targetTeam.shipsRemaining === 0) {
        targetTeam.isEliminated = true;
        eliminatedTeam = {
          id: targetTeam.id,
          name: targetTeam.customName || targetTeam.name,
        };
      }
    }

    shooterTeam.score = (shooterTeam.score || 0) + (result === 'SUNK' ? 50 : 20);
  }

  const shotRecord = {
    id: `shot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    turnNumber: gameState.turnNumber,
    shooterTeamId,
    shooterName: shooterTeam.customName || shooterTeam.name,
    shooterColor: shooterTeam.colorHex,
    shooterIcon: shooterTeam.icon,
    targetKey,
    col: parsed.col,
    row: parsed.row,
    result, // 'HIT', 'MISS', 'SUNK'
    hitTeamId: hitInfo ? hitInfo.targetTeam.id : null,
    hitTeamName: hitInfo ? (hitInfo.targetTeam.customName || hitInfo.targetTeam.name) : null,
    sunkShip,
    eliminatedTeam,
    timestamp: Date.now(),
  };

  gameState.shotsHistory.push(shotRecord);
  gameState.shotsMap[targetKey] = {
    result,
    shooterTeamId,
    targetKey,
    sunkShip: sunkShip ? sunkShip.name : null,
    timestamp: Date.now(),
  };

  return { success: true, shotRecord };
}

/**
 * Xử lý phát bắn thường từ một đội vào tọa độ cụ thể
 */
function processShot(gameState, shooterTeamId, targetKey) {
  if (gameState.phase !== 'BATTLE') {
    return { success: false, error: 'Trận đấu chưa bắt đầu hoặc đã kết thúc' };
  }

  if (gameState.currentTurnTeamId !== shooterTeamId) {
    return { success: false, error: 'Chưa đến lượt bắn của chỉ huy' };
  }

  const shotRes = executeSingleShot(gameState, shooterTeamId, targetKey);
  if (!shotRes.success) return shotRes;

  gameState.lastShotResult = shotRes.shotRecord;

  const livingTeams = gameState.teams.filter(t => !t.isEliminated);
  if (livingTeams.length <= 1) {
    gameState.winner = livingTeams.length === 1 ? livingTeams[0] : null;
    gameState.phase = 'FINISHED';
  } else {
    advanceTurn(gameState);
  }

  return {
    success: true,
    shotRecord: shotRes.shotRecord,
    isGameOver: gameState.phase === 'FINISHED',
    winner: gameState.winner,
    nextTurnTeamId: gameState.currentTurnTeamId,
  };
}

/**
 * Xử lý Kỹ năng Radar Quét Vùng 3x3 (mỗi người chơi có 2 lượt, không gây sát thương)
 */
function processRadarScan(gameState, shooterTeamId, centerKey) {
  if (gameState.phase !== 'BATTLE') {
    return { success: false, error: 'Trận đấu chưa bắt đầu hoặc đã kết thúc' };
  }

  if (gameState.currentTurnTeamId !== shooterTeamId) {
    return { success: false, error: 'Chưa đến lượt của chỉ huy' };
  }

  const shooterTeam = gameState.teams.find(t => t.id === shooterTeamId);
  if (!shooterTeam || shooterTeam.isEliminated) {
    return { success: false, error: 'Đội của bạn đã bị loại' };
  }

  if ((shooterTeam.radarScansRemaining || 0) <= 0) {
    return { success: false, error: 'Đội của bạn đã hết lượt quét Radar!' };
  }

  const parsed = parseKey(centerKey);
  if (!parsed) {
    return { success: false, error: 'Tọa độ tâm quét không hợp lệ' };
  }

  // Thu thập 9 ô trong phạm vi 3x3 quanh tâm
  const scannedCells = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cIdx = parsed.colIdx + dc;
      const rIdx = parsed.rowIdx + dr;
      if (cIdx >= 0 && cIdx < COLS.length && rIdx >= 0 && rIdx < ROWS.length) {
        scannedCells.push(coordToKey(COLS[cIdx], ROWS[rIdx]));
      }
    }
  }

  // Quét tìm tàu đối thủ còn sống
  let detectedCount = 0;
  const scannedSet = new Set(scannedCells);

  for (const team of gameState.teams) {
    if (team.id === shooterTeamId || team.isEliminated) continue;
    for (const ship of team.fleet) {
      if (ship.isSunk) continue;
      const match = ship.cells.filter(cell => scannedSet.has(cell) && !ship.hits.includes(cell));
      detectedCount += match.length;
    }
  }

  shooterTeam.radarScansRemaining = Math.max(0, (shooterTeam.radarScansRemaining || 2) - 1);

  const radarRecord = {
    actionType: 'RADAR',
    shooterTeamId,
    shooterName: shooterTeam.customName || shooterTeam.name,
    shooterColor: shooterTeam.colorHex,
    shooterIcon: shooterTeam.icon,
    centerKey,
    scannedCells,
    hasEnemyShip: detectedCount > 0,
    detectedCount,
    remainingScans: shooterTeam.radarScansRemaining,
    timestamp: Date.now(),
  };

  gameState.lastRadarRecord = radarRecord;

  // Sử dụng radar cũng tính là hoàn thành 1 lượt chiến thuật -> chuyển lượt
  advanceTurn(gameState);

  return {
    success: true,
    radarRecord,
    nextTurnTeamId: gameState.currentTurnTeamId,
  };
}

/**
 * Xử lý Kỹ năng Tên Lửa Chữ Thập (+) (mỗi người chơi có 1 lượt, công phá 5 ô)
 */
function processCrossfire(gameState, shooterTeamId, centerKey) {
  if (gameState.phase !== 'BATTLE') {
    return { success: false, error: 'Trận đấu chưa bắt đầu hoặc đã kết thúc' };
  }

  if (gameState.currentTurnTeamId !== shooterTeamId) {
    return { success: false, error: 'Chưa đến lượt của chỉ huy' };
  }

  const shooterTeam = gameState.teams.find(t => t.id === shooterTeamId);
  if (!shooterTeam || shooterTeam.isEliminated) {
    return { success: false, error: 'Đội của bạn đã bị loại' };
  }

  if ((shooterTeam.crossfireRemaining || 0) <= 0) {
    return { success: false, error: 'Đội của bạn đã hết lượt Tên lửa Chữ Thập!' };
  }

  const parsed = parseKey(centerKey);
  if (!parsed) {
    return { success: false, error: 'Tọa độ tâm bắn không hợp lệ' };
  }

  shooterTeam.crossfireRemaining = Math.max(0, (shooterTeam.crossfireRemaining || 1) - 1);

  // 5 ô: tâm, trên, dưới, trái, phải
  const targetKeys = [];
  const deltas = [
    { dc: 0, dr: 0 },
    { dc: 0, dr: -1 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 0 },
  ];

  for (const d of deltas) {
    const cIdx = parsed.colIdx + d.dc;
    const rIdx = parsed.rowIdx + d.dr;
    if (cIdx >= 0 && cIdx < COLS.length && rIdx >= 0 && rIdx < ROWS.length) {
      targetKeys.push(coordToKey(COLS[cIdx], ROWS[rIdx]));
    }
  }

  const crossfireShots = [];
  for (const tKey of targetKeys) {
    if (!gameState.shotsMap[tKey]) {
      const shotRes = executeSingleShot(gameState, shooterTeamId, tKey);
      if (shotRes.success) {
        crossfireShots.push(shotRes.shotRecord);
      }
    }
  }

  const crossfireRecord = {
    actionType: 'CROSSFIRE',
    shooterTeamId,
    shooterName: shooterTeam.customName || shooterTeam.name,
    shooterColor: shooterTeam.colorHex,
    shooterIcon: shooterTeam.icon,
    centerKey,
    targetKeys,
    shots: crossfireShots,
    remainingCrossfire: shooterTeam.crossfireRemaining,
    timestamp: Date.now(),
  };

  gameState.lastCrossfireRecord = crossfireRecord;
  if (crossfireShots.length > 0) {
    gameState.lastShotResult = crossfireShots[crossfireShots.length - 1];
  }

  const livingTeams = gameState.teams.filter(t => !t.isEliminated);
  if (livingTeams.length <= 1) {
    gameState.winner = livingTeams.length === 1 ? livingTeams[0] : null;
    gameState.phase = 'FINISHED';
  } else {
    advanceTurn(gameState);
  }

  return {
    success: true,
    crossfireRecord,
    isGameOver: gameState.phase === 'FINISHED',
    winner: gameState.winner,
    nextTurnTeamId: gameState.currentTurnTeamId,
  };
}

/**
 * Xử lý khi hết 60s đếm ngược: Tự động khai hỏa ngẫu nhiên 1 ô chưa bắn
 */
function handleTurnTimeout(gameState) {
  if (gameState.phase !== 'BATTLE' || gameState.phase === 'FINISHED') return null;

  const currentTeamId = gameState.currentTurnTeamId;
  const currentTeam = gameState.teams.find(t => t.id === currentTeamId);
  if (!currentTeam || currentTeam.isEliminated) {
    advanceTurn(gameState);
    return null;
  }

  // Tìm 1 ô ngẫu nhiên chưa bắn
  const targetKey = calculateBotTarget(gameState, currentTeamId);
  if (!targetKey) {
    advanceTurn(gameState);
    return null;
  }

  return processShot(gameState, currentTeamId, targetKey);
}

/**
 * Hoàn tác phát bắn gần nhất (MC Undo)
 */
function undoLastShot(gameState) {
  if (gameState.phase !== 'BATTLE' && gameState.phase !== 'FINISHED') return false;
  if (gameState.shotsHistory.length === 0) return false;

  const lastShot = gameState.shotsHistory.pop();
  delete gameState.shotsMap[lastShot.targetKey];

  if (lastShot.result === 'HIT' || lastShot.result === 'SUNK') {
    const hitTeam = gameState.teams.find(t => t.id === lastShot.hitTeamId);
    if (hitTeam) {
      hitTeam.hitCellsCount = Math.max(0, (hitTeam.hitCellsCount || 1) - 1);
      for (const ship of hitTeam.fleet) {
        if (ship.cells.includes(lastShot.targetKey)) {
          ship.hits = ship.hits.filter(k => k !== lastShot.targetKey);
          if (ship.isSunk) {
            ship.isSunk = false;
            hitTeam.shipsRemaining++;
            hitTeam.isEliminated = false;
          }
          break;
        }
      }
    }

    const shooterTeam = gameState.teams.find(t => t.id === lastShot.shooterTeamId);
    if (shooterTeam) {
      shooterTeam.score = Math.max(0, (shooterTeam.score || 0) - (lastShot.result === 'SUNK' ? 50 : 20));
    }
  }

  if (gameState.phase === 'FINISHED') {
    gameState.phase = 'BATTLE';
    gameState.winner = null;
  }

  const shooterOrderIdx = gameState.turnOrder.indexOf(lastShot.shooterTeamId);
  if (shooterOrderIdx !== -1) {
    gameState.currentTurnIndex = shooterOrderIdx;
    gameState.currentTurnTeamId = lastShot.shooterTeamId;
  }
  gameState.turnNumber = Math.max(1, gameState.turnNumber - 1);
  gameState.turnTimeRemaining = gameState.config.turnDuration || 60;
  gameState.turnStartTime = Date.now();
  return gameState;
}

/**
 * Trạng thái lọc an toàn tuyệt đối gửi cho Màn hình Trình chiếu (Zero-Leak)
 */
function getScreenState(gameState) {
  return {
    phase: gameState.phase,
    grid: gameState.grid,
    config: {
      playerCount: gameState.config.playerCount,
      shipsPerPlayer: gameState.config.shipsPerPlayer,
      shipConfigMode: gameState.config.shipConfigMode,
      shipLengths: gameState.config.shipLengths,
      turnDuration: gameState.config.turnDuration || 60,
    },
    teams: gameState.teams.map(t => ({
      id: t.id,
      name: t.customName || t.name,
      colorHex: t.colorHex,
      badgeClass: t.badgeClass,
      icon: t.icon,
      isBot: t.isBot,
      isConnected: t.isConnected,
      isReady: t.isReady,
      isFleetLocked: t.isFleetLocked,
      shipsRemaining: t.shipsRemaining,
      score: t.score,
      radarScansRemaining: t.radarScansRemaining ?? 2,
      crossfireRemaining: t.crossfireRemaining ?? 1,
      isEliminated: t.isEliminated,
    })),
    turnOrder: gameState.turnOrder,
    currentTurnTeamId: gameState.currentTurnTeamId,
    turnNumber: gameState.turnNumber,
    turnTimeRemaining: gameState.turnTimeRemaining || 60,
    turnStartTime: gameState.turnStartTime || Date.now(),
    shotsHistory: gameState.shotsHistory.slice(-20),
    shotsMap: gameState.shotsMap,
    winner: gameState.winner ? {
      id: gameState.winner.id,
      name: gameState.winner.customName || gameState.winner.name,
      colorHex: gameState.winner.colorHex,
      icon: gameState.winner.icon,
      score: gameState.winner.score,
    } : null,
    lastShotResult: gameState.lastShotResult,
    lastRadarRecord: gameState.lastRadarRecord,
    lastCrossfireRecord: gameState.lastCrossfireRecord,
  };
}

/**
 * Trạng thái cho MC Host
 */
function getHostState(gameState) {
  const screenState = getScreenState(gameState);
  return {
    ...screenState,
    teams: gameState.teams.map(t => ({
      ...t,
      name: t.customName || t.name,
    })),
    zones: gameState.zones,
  };
}

/**
 * Trạng thái gửi riêng cho từng Điện Thoại Người Chơi
 */
function getPlayerState(gameState, teamId) {
  const currentTeam = gameState.teams.find(t => t.id === teamId);
  if (!currentTeam) return null;

  return {
    phase: gameState.phase,
    grid: gameState.grid,
    config: {
      playerCount: gameState.config.playerCount,
      shipsPerPlayer: gameState.config.shipsPerPlayer,
      shipConfigMode: gameState.config.shipConfigMode,
      shipLengths: gameState.config.shipLengths,
      turnDuration: gameState.config.turnDuration || 60,
    },
    myTeam: {
      id: currentTeam.id,
      name: currentTeam.customName || currentTeam.name,
      colorHex: currentTeam.colorHex,
      badgeClass: currentTeam.badgeClass,
      icon: currentTeam.icon,
      isBot: currentTeam.isBot,
      isReady: currentTeam.isReady,
      isFleetLocked: currentTeam.isFleetLocked,
      zone: currentTeam.zone,
      fleet: currentTeam.fleet,
      shipsRemaining: currentTeam.shipsRemaining,
      score: currentTeam.score,
      radarScansRemaining: currentTeam.radarScansRemaining ?? 2,
      crossfireRemaining: currentTeam.crossfireRemaining ?? 1,
      isEliminated: currentTeam.isEliminated,
    },
    teamsOverview: gameState.teams.map(t => ({
      id: t.id,
      name: t.customName || t.name,
      colorHex: t.colorHex,
      icon: t.icon,
      isBot: t.isBot,
      isConnected: t.isConnected,
      isFleetLocked: t.isFleetLocked,
      shipsRemaining: t.shipsRemaining,
      score: t.score,
      radarScansRemaining: t.radarScansRemaining ?? 2,
      crossfireRemaining: t.crossfireRemaining ?? 1,
      isEliminated: t.isEliminated,
    })),
    turnOrder: gameState.turnOrder,
    currentTurnTeamId: gameState.currentTurnTeamId,
    turnNumber: gameState.turnNumber,
    turnTimeRemaining: gameState.turnTimeRemaining || 60,
    turnStartTime: gameState.turnStartTime || Date.now(),
    isMyTurn: gameState.currentTurnTeamId === teamId && !currentTeam.isEliminated && gameState.phase === 'BATTLE',
    shotsMap: gameState.shotsMap,
    lastShotResult: gameState.lastShotResult,
    lastRadarRecord: gameState.lastRadarRecord,
    lastCrossfireRecord: gameState.lastCrossfireRecord,
    winner: gameState.winner ? {
      id: gameState.winner.id,
      name: gameState.winner.customName || gameState.winner.name,
      colorHex: gameState.winner.colorHex,
      icon: gameState.winner.icon,
    } : null,
  };
}

const engineExports = {
  COLS,
  ROWS,
  GRID_WIDTH,
  GRID_HEIGHT,
  TOTAL_CELLS,
  DEFAULT_TEAMS,
  coordToKey,
  parseKey,
  isValidCoord,
  getShipLengths,
  allocatePlayerZones,
  generateRandomFleetInZone,
  validateCustomFleet,
  createInitialGameState,
  shuffleTurnOrder,
  startPlacementPhase,
  startBattlePhase,
  advanceTurn,
  calculateBotTarget,
  executeSingleShot,
  processShot,
  processRadarScan,
  processCrossfire,
  handleTurnTimeout,
  undoLastShot,
  getScreenState,
  getHostState,
  getPlayerState,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = engineExports;
}
if (typeof window !== 'undefined') {
  window.GameEngine = engineExports;
}
})();
