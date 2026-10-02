// src/game-engine.js
// Logic xử lý Đại Hải Đồ 20x20 (400 ô), phân vùng 2-8 người chơi, đếm ngược 60s, kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+)

(() => {
const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
let COLS = ALL_LETTERS.slice(0, 20); // Mặc định 20 cột (A -> T)
let ROWS = Array.from({ length: 20 }, (_, i) => i + 1); // Mặc định 20 hàng (1 -> 20)
let GRID_WIDTH = COLS.length;  // 20
let GRID_HEIGHT = ROWS.length; // 20
let TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT; // 400 ô

/**
 * Cập nhật kích thước hải đồ động (Trục ngang X: Cột A..Z, Trục dọc Y: Hàng 1..26)
 */
function setGridDimensions(colsCount = 20, rowsCount = 20) {
  const c = Math.min(Math.max(8, parseInt(colsCount, 10) || 20), ALL_LETTERS.length);
  const r = Math.min(Math.max(8, parseInt(rowsCount, 10) || 20), 26);
  COLS = ALL_LETTERS.slice(0, c);
  ROWS = Array.from({ length: r }, (_, i) => i + 1);
  GRID_WIDTH = COLS.length;
  GRID_HEIGHT = ROWS.length;
  TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT;
  return { COLS, ROWS, GRID_WIDTH, GRID_HEIGHT, TOTAL_CELLS };
}

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
 * Phân tích key 'A1' hoặc 'Z26' thành object { col, row, colIdx, rowIdx }
 */
function parseKey(key, customCols = COLS, customRows = ROWS) {
  if (!key || typeof key !== 'string') return null;
  const match = key.trim().toUpperCase().match(/^([A-Z])([0-9]{1,2})$/);
  if (!match) return null;
  const col = match[1];
  const row = parseInt(match[2], 10);
  const colIdx = customCols.indexOf(col);
  const rowIdx = customRows.indexOf(row);
  if (colIdx === -1 || rowIdx === -1) return null;
  return { col, row, colIdx, rowIdx };
}

/**
 * Kiểm tra tính hợp lệ của tọa độ
 */
function isValidCoord(colOrKey, row = null, customCols = COLS, customRows = ROWS) {
  if (row === null || row === undefined) {
    return parseKey(colOrKey, customCols, customRows) !== null;
  }
  return customCols.includes(colOrKey) && customRows.includes(row);
}

/**
 * Lấy danh sách chiều dài các tàu dựa vào cấu hình:
 * shipCount: 1..5
 * shipConfigMode: 'mix34' (4 và 3 ô), 'mix234' (4, 3 và 2 ô), 'size2' (toàn 2 ô), 'size3' (toàn 3 ô), 'size4' (toàn 4 ô)
 */
function getShipLengths(shipCount = 2, shipConfigMode = 'mix34', customLengths = null) {
  if (Array.isArray(customLengths) && customLengths.length > 0) {
    return [...customLengths];
  }
  const count = Math.min(Math.max(1, shipCount), 10);
  if (shipConfigMode === 'size2') {
    return Array(count).fill(2);
  }
  if (shipConfigMode === 'size3') {
    return Array(count).fill(3);
  }
  if (shipConfigMode === 'size4') {
    return Array(count).fill(4);
  }
  if (shipConfigMode === 'mix234') {
    const pattern = [4, 3, 2, 3, 2, 4, 3, 2];
    return pattern.slice(0, count);
  }
  const pattern = [4, 3, 4, 3, 3, 4, 3];
  return pattern.slice(0, count);
}

/**
 * Thuật toán phân vùng thông minh trên hải đồ theo kích thước động:
 * Chia đại dương thành N phân vùng độc lập, không chồng lấn cho N người chơi (2 -> 8 người).
 */
function allocatePlayerZones(playerCount = 4, colsCount = COLS.length, rowsCount = ROWS.length) {
  const count = Math.min(Math.max(2, playerCount), 8);
  const zones = {};
  let sectors = [];

  const midCol = Math.floor(colsCount / 2);
  const midRow = Math.floor(rowsCount / 2);

  if (count === 2) {
    // 2 người: Nửa trái và Nửa phải
    sectors = [
      { colStartIdx: 0, colEndIdx: midCol - 1, rowStartIdx: 0, rowEndIdx: rowsCount - 1 },
      { colStartIdx: midCol, colEndIdx: colsCount - 1, rowStartIdx: 0, rowEndIdx: rowsCount - 1 },
    ];
  } else if (count === 3) {
    // 3 người: 3 dải dọc
    const w1 = Math.floor(colsCount / 3);
    const w2 = Math.floor((colsCount * 2) / 3);
    sectors = [
      { colStartIdx: 0, colEndIdx: w1 - 1, rowStartIdx: 0, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w1, colEndIdx: w2 - 1, rowStartIdx: 0, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w2, colEndIdx: colsCount - 1, rowStartIdx: 0, rowEndIdx: rowsCount - 1 },
    ];
  } else if (count === 4) {
    // 4 người: 4 góc phần tư đối xứng
    sectors = [
      { colStartIdx: 0, colEndIdx: midCol - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: midCol, colEndIdx: colsCount - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: 0, colEndIdx: midCol - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
      { colStartIdx: midCol, colEndIdx: colsCount - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
    ];
  } else if (count === 5 || count === 6) {
    // 5-6 người: 2 hàng x 3 cột
    const w1 = Math.floor(colsCount / 3);
    const w2 = Math.floor((colsCount * 2) / 3);
    sectors = [
      { colStartIdx: 0, colEndIdx: w1 - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: w1, colEndIdx: w2 - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: w2, colEndIdx: colsCount - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: 0, colEndIdx: w1 - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w1, colEndIdx: w2 - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w2, colEndIdx: colsCount - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
    ];
  } else {
    // 7-8 người: 2 hàng x 4 cột
    const w1 = Math.floor(colsCount / 4);
    const w2 = Math.floor((colsCount * 2) / 4);
    const w3 = Math.floor((colsCount * 3) / 4);
    sectors = [
      { colStartIdx: 0, colEndIdx: w1 - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: w1, colEndIdx: w2 - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: w2, colEndIdx: w3 - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: w3, colEndIdx: colsCount - 1, rowStartIdx: 0, rowEndIdx: midRow - 1 },
      { colStartIdx: 0, colEndIdx: w1 - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w1, colEndIdx: w2 - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w2, colEndIdx: w3 - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
      { colStartIdx: w3, colEndIdx: colsCount - 1, rowStartIdx: midRow, rowEndIdx: rowsCount - 1 },
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
 * Trả về class bộ phận của tàu (Patrol Boat 2 ô, Cruiser 3 ô & Carrier 4 ô)
 * Giúp hiển thị trọn vẹn 1 chiến hạm liền khối đẹp mắt
 */
function getShipPartClass(ship, cellKey) {
  if (!ship || !Array.isArray(ship.cells)) return '';
  const idx = ship.cells.indexOf(cellKey);
  if (idx === -1) return '';
  const total = ship.cells.length;
  const isHorizontal = ship.orientation === 'horizontal';

  // 1. Tàu 4 ô: Tàu Sân Bay (Aircraft Carrier)
  if (total === 4) {
    if (idx === 0) return isHorizontal ? 'ship-carrier-bow-h ship-bow-h' : 'ship-carrier-bow-v ship-bow-v';
    if (idx === 1) return isHorizontal ? 'ship-carrier-mid1-h ship-mid-h' : 'ship-carrier-mid1-v ship-mid-v';
    if (idx === 2) return isHorizontal ? 'ship-carrier-mid2-h ship-mid-h' : 'ship-carrier-mid2-v ship-mid-v';
    return isHorizontal ? 'ship-carrier-stern-h ship-stern-h' : 'ship-carrier-stern-v ship-stern-v';
  }

  // 2. Tàu 3 ô: Tuần Dương Hạm (Cruiser)
  if (total === 3) {
    if (idx === 0) return isHorizontal ? 'ship-cruiser-bow-h ship-bow-h' : 'ship-cruiser-bow-v ship-bow-v';
    if (idx === total - 1) return isHorizontal ? 'ship-cruiser-stern-h ship-stern-h' : 'ship-cruiser-stern-v ship-stern-v';
    return isHorizontal ? 'ship-cruiser-mid-h ship-mid-h' : 'ship-cruiser-mid-v ship-mid-v';
  }

  // 3. Tàu 2 ô: Pháo Hạm / Tàu Tuần Tra (Patrol Boat)
  if (total === 2) {
    if (idx === 0) return isHorizontal ? 'ship-patrol-bow-h ship-bow-h' : 'ship-patrol-bow-v ship-bow-v';
    return isHorizontal ? 'ship-patrol-stern-h ship-stern-h' : 'ship-patrol-stern-v ship-stern-v';
  }

  // Tàu 1 ô hoặc độ dài khác
  return 'ship-bow-v';
}

/**
 * Sinh hạm đội ngẫu nhiên trên toàn bộ đại dương 400 ô (hoặc theo vùng chỉ định)
 * Không bị bó buộc nửa hải đồ, tự do phân tán chiến thuật, chỉ cần không trùng với tàu của đối phương
 */
function generateRandomFleetOpenOcean(shipLengths = [4, 3], existingEnemyCells = new Set(), bounds = null) {
  const fleet = [];
  const occupiedCells = new Set([...existingEnemyCells]);

  const minCol = bounds ? bounds.minCol : 0;
  const maxCol = bounds ? bounds.maxCol : (COLS.length - 1);
  const minRow = bounds ? bounds.minRow : 0;
  const maxRow = bounds ? bounds.maxRow : (ROWS.length - 1);
  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;

  for (let i = 0; i < shipLengths.length; i++) {
    const length = shipLengths[i];
    let shipName = `Tuần Dương Hạm #${i + 1}`;
    if (length === 4) shipName = `Tàu Sân Bay #${i + 1}`;
    else if (length === 3) shipName = `Tuần Dương Hạm #${i + 1}`;
    else if (length === 2) shipName = `Pháo Hạm #${i + 1}`;
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < 800) {
      attempts++;
      const isHorizontal = Math.random() < 0.5;
      let startColIdx, startRowIdx;

      if (isHorizontal) {
        startColIdx = minCol + Math.floor(Math.random() * Math.max(1, width - length + 1));
        startRowIdx = minRow + Math.floor(Math.random() * height);
      } else {
        startColIdx = minCol + Math.floor(Math.random() * width);
        startRowIdx = minRow + Math.floor(Math.random() * Math.max(1, height - length + 1));
      }

      const shipCells = [];
      let collision = false;

      for (let step = 0; step < length; step++) {
        const c = isHorizontal ? startColIdx + step : startColIdx;
        const r = isHorizontal ? startRowIdx : startRowIdx + step;

        if (c >= COLS.length || r >= ROWS.length) {
          collision = true;
          break;
        }

        const cellKey = coordToKey(COLS[c], ROWS[r]);
        if (occupiedCells.has(cellKey)) {
          collision = true;
          break;
        }
        shipCells.push(cellKey);
      }

      if (!collision && shipCells.length === length) {
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
      console.warn(`Không thể đặt tàu kích thước ${length} sau 800 lần thử`);
    }
  }

  return fleet;
}

/**
 * Sinh hạm đội ngẫu nhiên (tương thích ngược với zone cũ, nhưng mặc định mở rộng toàn bộ đại dương nếu cần)
 */
function generateRandomFleetInZone(zone, shipLengths = [4, 3], existingEnemyCells = new Set()) {
  if (!zone || !zone.width) {
    return generateRandomFleetOpenOcean(shipLengths, existingEnemyCells);
  }
  return generateRandomFleetOpenOcean(shipLengths, existingEnemyCells, {
    minCol: zone.colStartIdx,
    maxCol: zone.colEndIdx,
    minRow: zone.rowStartIdx,
    maxRow: zone.rowEndIdx,
  });
}

/**
 * Xác thực hạm đội tùy chỉnh của người chơi:
 * Cho phép đặt tàu ở bất kỳ đâu trên 400 ô đại dương, chỉ cần các tàu không chồng lên nhau
 * và không trùng với vị trí tàu của đối phương đã bố trí.
 */
function validateCustomFleet(fleet, expectedLengths = [4, 3], existingEnemyCells = new Set()) {
  if (!Array.isArray(fleet)) {
    return { valid: false, error: 'Dữ liệu hạm đội không hợp lệ' };
  }

  if (fleet.length !== expectedLengths.length) {
    return { valid: false, error: `Số lượng tàu yêu cầu: ${expectedLengths.length} (nhận được: ${fleet.length})` };
  }

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
      if (!isValidCoord(cellKey)) {
        return { valid: false, error: `Tọa độ ${cellKey} nằm ngoài phạm vi hải đồ (A-T × 1-20)` };
      }
      if (occupied.has(cellKey)) {
        return { valid: false, error: `Tọa độ ${cellKey} bị chồng lấn giữa các tàu của bạn` };
      }
      if (existingEnemyCells && existingEnemyCells.has(cellKey)) {
        return { valid: false, error: `Tọa độ ${cellKey} bị trùng với khu vực của tàu đối phương!` };
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
  const gridCols = Math.min(Math.max(8, parseInt(options.gridCols, 10) || 20), ALL_LETTERS.length);
  const gridRows = Math.min(Math.max(8, parseInt(options.gridRows, 10) || 20), 26);
  setGridDimensions(gridCols, gridRows);

  const playerCount = Math.min(Math.max(2, options.playerCount || 4), 8);
  const shipConfigMode = options.shipConfigMode || 'custom';
  const customCounts = options.customShipCounts || null;
  let shipLengths = null;
  if (options.customShipLengths && Array.isArray(options.customShipLengths) && options.customShipLengths.length > 0) {
    shipLengths = [...options.customShipLengths];
  } else if (customCounts && (customCounts.count4 !== undefined || customCounts.count3 !== undefined || customCounts.count2 !== undefined)) {
    const list = [];
    const c4 = Math.max(0, parseInt(customCounts.count4, 10) || 0);
    const c3 = Math.max(0, parseInt(customCounts.count3, 10) || 0);
    const c2 = Math.max(0, parseInt(customCounts.count2, 10) || 0);
    for (let i = 0; i < c4; i++) list.push(4);
    for (let i = 0; i < c3; i++) list.push(3);
    for (let i = 0; i < c2; i++) list.push(2);
    shipLengths = list.length > 0 ? list : [4, 3];
  } else {
    shipLengths = getShipLengths(options.shipsPerPlayer || 2, shipConfigMode);
  }
  const shipsPerPlayer = shipLengths.length;
  const turnOrderMode = options.turnOrderMode || 'random';
  const turnDuration = options.turnDuration || 60; // 60s mỗi lượt

  const zones = allocatePlayerZones(playerCount, gridCols, gridRows);
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
      crossfireRemaining: 1,   // 1 lượt bắn tên lửa chữ thập (+)
      isEliminated: false,
      deviceToken: null,
    });
  }

  // Khởi tạo danh sách các ô may mắn ngẫu nhiên (tỷ lệ 20% tổng số ô trên hải đồ)
  const allGridKeys = [];
  COLS.forEach(c => ROWS.forEach(r => allGridKeys.push(coordToKey(c, r))));
  for (let i = allGridKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allGridKeys[i], allGridKeys[j]] = [allGridKeys[j], allGridKeys[i]];
  }
  const luckyCellCount = Math.round(allGridKeys.length * 0.20);
  const luckyCells = allGridKeys.slice(0, luckyCellCount);

  return {
    phase: 'LOBBY', // 'LOBBY' -> 'PLACEMENT' -> 'BATTLE' -> 'FINISHED'
    grid: {
      cols: [...COLS],
      rows: [...ROWS],
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      totalCells: TOTAL_CELLS,
    },
    config: {
      gridCols: GRID_WIDTH,
      gridRows: GRID_HEIGHT,
      playerCount,
      shipsPerPlayer,
      shipConfigMode,
      shipLengths,
      customShipCounts: customCounts,
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
    luckyCells,
    winner: null,
    lastShotResult: null,
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

  const occupiedByOthers = new Set();
  // 1. Ghi nhận các đội đã khóa trước đó (nếu có)
  gameState.teams.forEach(team => {
    if (team.isFleetLocked && team.fleet && team.fleet.length > 0) {
      team.fleet.forEach(s => s.cells && s.cells.forEach(k => occupiedByOthers.add(k)));
    }
  });

  // 2. Sinh hạm đội cố định cho Bot (loại trừ các ô đã bị chiếm)
  gameState.teams.forEach(team => {
    if (team.isBot) {
      team.fleet = generateRandomFleetOpenOcean(gameState.config.shipLengths, occupiedByOthers);
      team.fleet.forEach(s => s.cells && s.cells.forEach(k => occupiedByOthers.add(k)));
      team.isFleetLocked = true;
      team.isReady = true;
    }
  });

  // 3. Tự động sinh hạm đội ban đầu cho các đội người chơi (nếu chưa có, loại trừ tất cả ô đã bị chiếm)
  gameState.teams.forEach(team => {
    if (!team.isBot && (!team.fleet || team.fleet.length === 0)) {
      team.fleet = generateRandomFleetOpenOcean(gameState.config.shipLengths, occupiedByOthers);
      team.fleet.forEach(s => s.cells && s.cells.forEach(k => occupiedByOthers.add(k)));
      team.isFleetLocked = false;
      team.isReady = false;
    }
  });

  return gameState;
}

/**
 * Khởi động giai đoạn chiến đấu (BATTLE)
 */
function startBattlePhase(gameState, manualOrder = null) {
  if (gameState.phase !== 'PLACEMENT' && gameState.phase !== 'LOBBY') return gameState;

  // Thuật toán kiểm tra và bảo đảm tuyệt đối không trùng lặp ô giữa các hạm đội
  const masterOccupiedCells = new Set();

  // 1. Ưu tiên giữ nguyên vị trí của các đội đã Khóa (isFleetLocked) nếu không có xung đột
  gameState.teams.forEach(team => {
    if (team.isFleetLocked && team.fleet && team.fleet.length > 0) {
      let hasConflict = false;
      for (const ship of team.fleet) {
        if (!ship.cells) continue;
        for (const cellKey of ship.cells) {
          if (masterOccupiedCells.has(cellKey)) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) break;
      }

      if (!hasConflict) {
        team.fleet.forEach(s => s.cells && s.cells.forEach(k => masterOccupiedCells.add(k)));
      } else {
        // Có xung đột: Tự động xếp lại đảm bảo không trùng với các đội đã khóa trước
        team.fleet = generateRandomFleetOpenOcean(gameState.config.shipLengths, masterOccupiedCells);
        team.fleet.forEach(s => s.cells && s.cells.forEach(k => masterOccupiedCells.add(k)));
      }
      team.isFleetLocked = true;
      team.isReady = true;
    }
  });

  // 2. Với các đội chưa khóa hoặc chưa có hạm đội, tự động xếp ngẫu nhiên trên các ô còn trống
  gameState.teams.forEach(team => {
    if (!team.isFleetLocked || !team.fleet || team.fleet.length === 0) {
      team.fleet = generateRandomFleetOpenOcean(gameState.config.shipLengths, masterOccupiedCells);
      team.fleet.forEach(s => s.cells && s.cells.forEach(k => masterOccupiedCells.add(k)));
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

  // Kiểm tra ngay nếu đội đầu tiên đã bị loại
  const firstTeam = gameState.teams.find(t => t.id === gameState.currentTurnTeamId);
  if (firstTeam && (firstTeam.isEliminated || firstTeam.shipsRemaining === 0)) {
    advanceTurn(gameState);
  }

  return gameState;
}

/**
 * Chuyển sang lượt tiếp theo (bỏ qua những đội đã bị loại hoặc hết tàu)
 */
function advanceTurn(gameState) {
  if (gameState.phase !== 'BATTLE') return null;

  const livingTeams = gameState.teams.filter(t => !t.isEliminated && (t.shipsRemaining === undefined || t.shipsRemaining > 0));
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

      // Cập nhật tất cả các ô của chiến hạm này thành 'SUNK' để toàn bộ người chơi thấy LỬA ĐEN / TRO TÀN
      ship.cells.forEach(k => {
        if (gameState.shotsMap[k]) {
          gameState.shotsMap[k].result = 'SUNK';
          gameState.shotsMap[k].sunkShip = ship.name;
        }
      });

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

  const isLucky = gameState.luckyCells
    ? gameState.luckyCells.includes(targetKey)
    : Math.random() < 0.20;

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
    easterEgg: isLucky,
    isLuckyCell: isLucky,
    easterEggType: isLucky ? 'BONUS_TURN' : null,
    easterEggMessage: isLucky ? `🎁 Ô MAY MẮN! Đội ${shooterTeam.customName || shooterTeam.name} bắn trúng ô ngẫu nhiên may mắn [${targetKey}] - Nhận thêm +1 lượt bắn!` : null,
    timestamp: Date.now(),
  };

  gameState.shotsHistory.push(shotRecord);
  gameState.shotsMap[targetKey] = {
    result,
    shooterTeamId,
    targetKey,
    sunkShip: sunkShip ? sunkShip.name : null,
    easterEgg: isLucky,
    isLuckyCell: isLucky,
    timestamp: Date.now(),
  };

  // Đồng bộ lại tất cả ô của tàu chìm trong shotsMap
  if (result === 'SUNK' && sunkShip && Array.isArray(sunkShip.cells)) {
    sunkShip.cells.forEach(k => {
      if (gameState.shotsMap[k]) {
        gameState.shotsMap[k].result = 'SUNK';
        gameState.shotsMap[k].sunkShip = sunkShip.name;
      }
    });
  }

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

  const hasBonusTurn = shotRes.shotRecord.easterEgg === true;
  gameState.lastShotResult = shotRes.shotRecord;

  const livingTeams = gameState.teams.filter(t => !t.isEliminated);
  if (livingTeams.length <= 1) {
    gameState.winner = livingTeams.length === 1 ? livingTeams[0] : null;
    gameState.phase = 'FINISHED';
  } else if (hasBonusTurn) {
    // Không chuyển lượt: Đội bắn được giữ lượt và đặt lại đồng hồ 60s
    gameState.turnTimeRemaining = gameState.config.turnDuration || 60;
    gameState.turnStartTime = Date.now();
  } else {
    advanceTurn(gameState);
  }

  return {
    success: true,
    shotRecord: shotRes.shotRecord,
    hasBonusTurn,
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

  const hasLuckyShot = crossfireShots.some(s => s.easterEgg);
  if (hasLuckyShot) {
    crossfireRecord.easterEgg = true;
    crossfireRecord.isLuckyCell = true;
    crossfireRecord.easterEggMessage = `🎁 Ô MAY MẮN! Tên lửa Chữ Thập bắn trúng ô ngẫu nhiên may mắn - Nhận thêm +1 lượt bắn!`;
  }

  const livingTeams = gameState.teams.filter(t => !t.isEliminated);
  if (livingTeams.length <= 1) {
    gameState.winner = livingTeams.length === 1 ? livingTeams[0] : null;
    gameState.phase = 'FINISHED';
  } else if (hasLuckyShot) {
    gameState.turnTimeRemaining = gameState.config.turnDuration || 60;
    gameState.turnStartTime = Date.now();
  } else {
    advanceTurn(gameState);
  }

  return {
    success: true,
    crossfireRecord,
    hasBonusTurn: hasLuckyShot,
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
      deviceToken: currentTeam.deviceToken || null,
      zone: currentTeam.zone,
      fleet: currentTeam.fleet,
      shipsRemaining: currentTeam.shipsRemaining,
      score: currentTeam.score,
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
      isReady: t.isReady,
      isFleetLocked: t.isFleetLocked,
      deviceToken: t.deviceToken || null,
      shipsRemaining: t.shipsRemaining,
      score: t.score,
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
  ALL_LETTERS,
  setGridDimensions,
  get COLS() { return COLS; },
  get ROWS() { return ROWS; },
  get GRID_WIDTH() { return GRID_WIDTH; },
  get GRID_HEIGHT() { return GRID_HEIGHT; },
  get TOTAL_CELLS() { return TOTAL_CELLS; },
  DEFAULT_TEAMS,
  coordToKey,
  parseKey,
  isValidCoord,
  getShipLengths,
  allocatePlayerZones,
  getShipPartClass,
  generateRandomFleetOpenOcean,
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
