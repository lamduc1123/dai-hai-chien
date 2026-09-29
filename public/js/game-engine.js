// src/game-engine.js
// Logic xử lý Đại Hải Đồ 20x10 (200 ô), phân vùng 2-8 người chơi, đặt tàu và xử lý chiến đấu thuần Tiếng Việt 100%

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']; // 20 cột (A -> T)
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 10 hàng (1 -> 10)
const GRID_WIDTH = COLS.length;  // 20
const GRID_HEIGHT = ROWS.length; // 10
const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT; // 200 ô

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
 * Phân tích key 'A1' hoặc 'T10' thành object { col, row, colIdx, rowIdx }
 */
function parseKey(key) {
  if (!key || typeof key !== 'string') return null;
  const match = key.trim().toUpperCase().match(/^([A-T])([1-9]|10)$/);
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
 * Thuật toán phân vùng thông minh (Sector Allocation):
 * Chia đại dương 20x10 (200 ô) thành N phân vùng độc lập, không chồng lấn cho N người chơi (2 -> 8 người).
 */
function allocatePlayerZones(playerCount = 4) {
  const count = Math.min(Math.max(2, playerCount), 8);
  const zones = {};

  let sectors = [];

  if (count === 2) {
    // Chia đôi trái - phải: mỗi vùng 10x10 = 100 ô
    sectors = [
      { colStartIdx: 0, colEndIdx: 9, rowStartIdx: 0, rowEndIdx: 9 },   // A..J, 1..10
      { colStartIdx: 10, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 9 }, // K..T, 1..10
    ];
  } else if (count === 3) {
    // 3 cột dọc: 7 cột, 7 cột, 6 cột x 10 hàng
    sectors = [
      { colStartIdx: 0, colEndIdx: 6, rowStartIdx: 0, rowEndIdx: 9 },   // A..G, 1..10
      { colStartIdx: 7, colEndIdx: 13, rowStartIdx: 0, rowEndIdx: 9 },  // H..N, 1..10
      { colStartIdx: 14, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 9 }, // O..T, 1..10
    ];
  } else if (count === 4) {
    // 4 góc phần tư: 2 hàng x 2 cột (mỗi vùng 10 cột x 5 hàng = 50 ô)
    sectors = [
      { colStartIdx: 0, colEndIdx: 9, rowStartIdx: 0, rowEndIdx: 4 },   // Tây Bắc (A..J, 1..5)
      { colStartIdx: 10, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 4 }, // Đông Bắc (K..T, 1..5)
      { colStartIdx: 0, colEndIdx: 9, rowStartIdx: 5, rowEndIdx: 9 },   // Tây Nam (A..J, 6..10)
      { colStartIdx: 10, colEndIdx: 19, rowStartIdx: 5, rowEndIdx: 9 }, // Đông Nam (K..T, 6..10)
    ];
  } else if (count === 5 || count === 6) {
    // 2 hàng x 3 cột: 6 vùng (mỗi vùng ~6-7 cột x 5 hàng = 30-35 ô)
    sectors = [
      { colStartIdx: 0, colEndIdx: 6, rowStartIdx: 0, rowEndIdx: 4 },   // Hàng 1, Vùng 1
      { colStartIdx: 7, colEndIdx: 13, rowStartIdx: 0, rowEndIdx: 4 },  // Hàng 1, Vùng 2
      { colStartIdx: 14, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 4 }, // Hàng 1, Vùng 3
      { colStartIdx: 0, colEndIdx: 6, rowStartIdx: 5, rowEndIdx: 9 },   // Hàng 2, Vùng 1
      { colStartIdx: 7, colEndIdx: 13, rowStartIdx: 5, rowEndIdx: 9 },  // Hàng 2, Vùng 2
      { colStartIdx: 14, colEndIdx: 19, rowStartIdx: 5, rowEndIdx: 9 }, // Hàng 2, Vùng 3
    ];
  } else {
    // 7 hoặc 8 người: 2 hàng x 4 cột (mỗi vùng 5 cột x 5 hàng = 25 ô)
    sectors = [
      { colStartIdx: 0, colEndIdx: 4, rowStartIdx: 0, rowEndIdx: 4 },   // A..E, 1..5
      { colStartIdx: 5, colEndIdx: 9, rowStartIdx: 0, rowEndIdx: 4 },   // F..J, 1..5
      { colStartIdx: 10, colEndIdx: 14, rowStartIdx: 0, rowEndIdx: 4 }, // K..O, 1..5
      { colStartIdx: 15, colEndIdx: 19, rowStartIdx: 0, rowEndIdx: 4 }, // P..T, 1..5
      { colStartIdx: 0, colEndIdx: 4, rowStartIdx: 5, rowEndIdx: 9 },   // A..E, 6..10
      { colStartIdx: 5, colEndIdx: 9, rowStartIdx: 5, rowEndIdx: 9 },   // F..J, 6..10
      { colStartIdx: 10, colEndIdx: 14, rowStartIdx: 5, rowEndIdx: 9 }, // K..O, 6..10
      { colStartIdx: 15, colEndIdx: 19, rowStartIdx: 5, rowEndIdx: 9 }, // P..T, 6..10
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
      cells,
      cellSet: new Set(cells),
    };
  }

  return zones;
}

/**
 * Tự động xếp các tàu hợp lệ trong phân vùng được chỉ định
 */
function generateRandomFleetInZone(zone, shipLengths) {
  const fleet = [];
  const occupied = new Set();
  const maxAttempts = 500;

  for (let sIdx = 0; sIdx < shipLengths.length; sIdx++) {
    const len = shipLengths[sIdx];
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < maxAttempts) {
      attempts++;
      const orientation = Math.random() < 0.5 ? 'H' : 'V';
      let startColIdx, startRowIdx;

      if (orientation === 'H') {
        const maxCol = zone.colEndIdx - len + 1;
        if (maxCol < zone.colStartIdx) continue;
        startColIdx = zone.colStartIdx + Math.floor(Math.random() * (maxCol - zone.colStartIdx + 1));
        startRowIdx = zone.rowStartIdx + Math.floor(Math.random() * (zone.rowEndIdx - zone.rowStartIdx + 1));
      } else {
        const maxRow = zone.rowEndIdx - len + 1;
        if (maxRow < zone.rowStartIdx) continue;
        startColIdx = zone.colStartIdx + Math.floor(Math.random() * (zone.colEndIdx - zone.colStartIdx + 1));
        startRowIdx = zone.rowStartIdx + Math.floor(Math.random() * (maxRow - zone.rowStartIdx + 1));
      }

      const shipCells = [];
      let collision = false;

      for (let i = 0; i < len; i++) {
        const cIdx = orientation === 'H' ? startColIdx + i : startColIdx;
        const rIdx = orientation === 'H' ? startRowIdx : startRowIdx + i;
        const key = coordToKey(COLS[cIdx], ROWS[rIdx]);

        if (!zone.cellSet.has(key) || occupied.has(key)) {
          collision = true;
          break;
        }
        shipCells.push(key);
      }

      if (!collision && shipCells.length === len) {
        shipCells.forEach(k => occupied.add(k));
        fleet.push({
          id: `ship_${sIdx + 1}`,
          name: len === 4 ? `Thiết Giáp Hạm ${sIdx + 1}` : `Tuần Dương Hạm ${sIdx + 1}`,
          size: len,
          orientation,
          cells: shipCells,
          hits: [],
          isSunk: false,
        });
        placed = true;
      }
    }

    if (!placed) {
      return generateRandomFleetInZone(zone, shipLengths);
    }
  }

  return fleet;
}

/**
 * Kiểm tra hạm đội do người chơi tùy chỉnh gửi lên
 */
function validateCustomFleet(fleet, zone, shipLengths) {
  if (!Array.isArray(fleet) || fleet.length !== shipLengths.length) {
    return { valid: false, error: `Số lượng tàu phải bằng ${shipLengths.length}` };
  }

  const occupied = new Set();
  const sortedReqSizes = [...shipLengths].sort((a, b) => b - a);
  const submittedSizes = fleet.map(s => s.cells ? s.cells.length : 0).sort((a, b) => b - a);

  for (let i = 0; i < sortedReqSizes.length; i++) {
    if (sortedReqSizes[i] !== submittedSizes[i]) {
      return { valid: false, error: `Kích thước tàu không khớp với cấu hình game (${shipLengths.join(', ')} ô)` };
    }
  }

  for (let sIdx = 0; sIdx < fleet.length; sIdx++) {
    const ship = fleet[sIdx];
    if (!Array.isArray(ship.cells) || ship.cells.length < 3) {
      return { valid: false, error: `Tàu #${sIdx + 1} không hợp lệ` };
    }

    const parsedCoords = [];
    for (const key of ship.cells) {
      const parsed = parseKey(key);
      if (!parsed) {
        return { valid: false, error: `Tọa độ ô ${key} không hợp lệ` };
      }
      if (zone && !zone.cellSet.has(key)) {
        return { valid: false, error: `Tọa độ ${key} nằm ngoài phân khu của bạn (${zone.colStart}${zone.rowStart} - ${zone.colEnd}${zone.rowEnd})` };
      }
      if (occupied.has(key)) {
        return { valid: false, error: `Tọa độ ${key} bị trùng lặp với tàu khác` };
      }
      occupied.add(key);
      parsedCoords.push(parsed);
    }

    const isHorizontal = parsedCoords.every(c => c.rowIdx === parsedCoords[0].rowIdx);
    const isVertical = parsedCoords.every(c => c.colIdx === parsedCoords[0].colIdx);

    if (!isHorizontal && !isVertical) {
      return { valid: false, error: `Tàu phải được đặt thẳng hàng ngang hoặc dọc` };
    }

    if (isHorizontal) {
      const sortedCols = parsedCoords.map(c => c.colIdx).sort((a, b) => a - b);
      for (let i = 0; i < sortedCols.length - 1; i++) {
        if (sortedCols[i + 1] !== sortedCols[i] + 1) {
          return { valid: false, error: `Các ô của tàu nằm ngang phải liền kề nhau` };
        }
      }
    } else {
      const sortedRows = parsedCoords.map(c => c.rowIdx).sort((a, b) => a - b);
      for (let i = 0; i < sortedRows.length - 1; i++) {
        if (sortedRows[i + 1] !== sortedRows[i] + 1) {
          return { valid: false, error: `Các ô của tàu nằm dọc phải liền kề nhau` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Khởi tạo Game State hoàn toàn mới
 */
function createInitialGameState(options = {}) {
  const playerCount = Math.min(Math.max(2, options.playerCount || 4), 8);
  const shipsPerPlayer = Math.min(Math.max(1, options.shipsPerPlayer || 2), 5);
  const shipConfigMode = options.shipConfigMode || 'mix34';
  const turnOrderMode = options.turnOrderMode || 'random';

  const shipLengths = getShipLengths(shipsPerPlayer, shipConfigMode);
  const zones = allocatePlayerZones(playerCount);

  const teams = [];
  for (let i = 0; i < playerCount; i++) {
    const defaultMeta = DEFAULT_TEAMS[i];
    const teamId = i + 1;
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
        colStart: teamZone.colStart,
        colEnd: teamZone.colEnd,
        rowStart: teamZone.rowStart,
        rowEnd: teamZone.rowEnd,
        cells: teamZone.cells,
      },
      fleet: [],
      shipsRemaining: shipsPerPlayer,
      totalShipCells: shipLengths.reduce((a, b) => a + b, 0),
      hitCellsCount: 0,
      score: 0,
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
    },
    teams,
    zones,
    turnOrder: [],
    currentTurnIndex: 0,
    currentTurnTeamId: null,
    turnNumber: 0,
    shotsHistory: [],
    shotsMap: {},
    winner: null,
    lastShotResult: null,
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

  // Tự động xếp tàu và khóa hạm đội cho toàn bộ Bot
  gameState.teams.forEach(team => {
    if (team.isBot) {
      const zone = gameState.zones[team.id];
      team.fleet = generateRandomFleetInZone(zone, gameState.config.shipLengths);
      team.isFleetLocked = true;
    }
  });

  return true;
}

/**
 * Khởi động giai đoạn chiến đấu (BATTLE)
 */
function startBattlePhase(gameState, manualOrder = null) {
  if (gameState.phase !== 'PLACEMENT' && gameState.phase !== 'LOBBY') return false;

  gameState.teams.forEach(team => {
    if (!team.fleet || team.fleet.length === 0) {
      const zone = gameState.zones[team.id];
      team.fleet = generateRandomFleetInZone(zone, gameState.config.shipLengths);
      team.isFleetLocked = true;
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
  gameState.lastShotResult = null;

  return true;
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

      const adjs = [
        { c: parsed.colIdx - 1, r: parsed.rowIdx },
        { c: parsed.colIdx + 1, r: parsed.rowIdx },
        { c: parsed.colIdx, r: parsed.rowIdx - 1 },
        { c: parsed.colIdx, r: parsed.rowIdx + 1 },
      ];

      for (const adj of adjs) {
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
 * Xử lý phát bắn từ một đội vào tọa độ cụ thể
 */
function processShot(gameState, shooterTeamId, targetKey) {
  if (gameState.phase !== 'BATTLE') {
    return { success: false, error: 'Trận đấu chưa bắt đầu hoặc đã kết thúc' };
  }

  if (gameState.currentTurnTeamId !== shooterTeamId) {
    return { success: false, error: 'Chưa đến lượt bắn của chỉ huy' };
  }

  const parsed = parseKey(targetKey);
  if (!parsed) {
    return { success: false, error: 'Tọa độ bắn không hợp lệ' };
  }

  if (gameState.shotsMap[targetKey]) {
    return { success: false, error: 'Tọa độ này đã bị khai hỏa trước đó' };
  }

  const shooterTeam = gameState.teams.find(t => t.id === shooterTeamId);
  if (!shooterTeam || shooterTeam.isEliminated) {
    return { success: false, error: 'Đội bắn không hợp lệ hoặc đã bị loại' };
  }

  let hitInfo = null;

  for (const team of gameState.teams) {
    for (const ship of team.fleet) {
      if (ship.cells.includes(targetKey)) {
        hitInfo = {
          targetTeam: team,
          ship: ship,
        };
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

  gameState.lastShotResult = shotRecord;

  const livingTeams = gameState.teams.filter(t => !t.isEliminated);
  if (livingTeams.length <= 1) {
    gameState.winner = livingTeams.length === 1 ? livingTeams[0] : null;
    gameState.phase = 'FINISHED';
  } else {
    advanceTurn(gameState);
  }

  return {
    success: true,
    shotRecord,
    isGameOver: gameState.phase === 'FINISHED',
    winner: gameState.winner,
    nextTurnTeamId: gameState.currentTurnTeamId,
  };
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
    const targetTeam = gameState.teams.find(t => t.id === lastShot.hitTeamId);
    if (targetTeam) {
      for (const ship of targetTeam.fleet) {
        const hitIdx = ship.hits.indexOf(lastShot.targetKey);
        if (hitIdx !== -1) {
          ship.hits.splice(hitIdx, 1);
          if (ship.isSunk) {
            ship.isSunk = false;
            targetTeam.shipsRemaining++;
          }
          break;
        }
      }
      targetTeam.hitCellsCount = Math.max(0, (targetTeam.hitCellsCount || 1) - 1);
      if (targetTeam.isEliminated) {
        targetTeam.isEliminated = false;
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
  gameState.lastShotResult = gameState.shotsHistory[gameState.shotsHistory.length - 1] || null;

  return true;
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
      isEliminated: t.isEliminated,
    })),
    turnOrder: gameState.turnOrder,
    currentTurnTeamId: gameState.currentTurnTeamId,
    turnNumber: gameState.turnNumber,
    shotsHistory: gameState.shotsHistory.slice(-15),
    shotsMap: gameState.shotsMap,
    winner: gameState.winner ? {
      id: gameState.winner.id,
      name: gameState.winner.customName || gameState.winner.name,
      colorHex: gameState.winner.colorHex,
      icon: gameState.winner.icon,
      score: gameState.winner.score,
    } : null,
    lastShotResult: gameState.lastShotResult,
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
    },
    myTeam: {
      id: currentTeam.id,
      name: currentTeam.customName || currentTeam.name,
      colorHex: currentTeam.colorHex,
      badgeClass: currentTeam.badgeClass,
      icon: currentTeam.icon,
      isBot: currentTeam.isBot,
      isConnected: currentTeam.isConnected,
      isReady: currentTeam.isReady,
      isFleetLocked: currentTeam.isFleetLocked,
      shipsRemaining: currentTeam.shipsRemaining,
      score: currentTeam.score,
      isEliminated: currentTeam.isEliminated,
      zone: currentTeam.zone,
      fleet: currentTeam.fleet,
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
      isEliminated: t.isEliminated,
    })),
    turnOrder: gameState.turnOrder,
    currentTurnTeamId: gameState.currentTurnTeamId,
    turnNumber: gameState.turnNumber,
    isMyTurn: gameState.currentTurnTeamId === teamId && !currentTeam.isEliminated && gameState.phase === 'BATTLE',
    shotsMap: gameState.shotsMap,
    lastShotResult: gameState.lastShotResult,
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
  processShot,
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
