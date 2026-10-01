// public/js/host.js
// Logic điều khiển trung tâm MC Host thuần Tiếng Việt 100%, tích hợp Bot AI kiểm thử
// Hỗ trợ đồng thời: Máy chủ Socket.IO cục bộ & Chế độ Đám Mây GitHub Pages + Firebase RTDB
// Bản đồ 20x20 (400 ô), Đếm ngược 60s, Kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+)

(() => {
const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
let COLS = ALL_LETTERS.slice(0, 20);
let ROWS = Array.from({ length: 20 }, (_, i) => i + 1);

let socket = null;
let currentRoomId = 'PHONG-01';
let currentHostState = null;
let soundManager = null;
let showSecretShips = false;
let botTurnTimer = null;
let turnTickerInterval = null;

let tempPlayerCount = 4;
let tempShipsPerPlayer = 2;
let tempGridCols = 20;
let tempGridRows = 20;

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  const urlParams = new URLSearchParams(window.location.search);
  currentRoomId = urlParams.get('room') || 'PHONG-01';
  document.getElementById('roomCodeText').textContent = currentRoomId;

  initGrid();
  initEventListeners();
  initStandaloneEngine();
  initSocket();
  loadNetworkAndQR();
  startTurnTicker();

  window.addEventListener('resize', fitOceanGridToScreen);
  if (window.ResizeObserver) {
    const wrapper = document.querySelector('.ocean-map-wrapper');
    if (wrapper) {
      new ResizeObserver(() => fitOceanGridToScreen()).observe(wrapper);
    }
  }
});

// Khởi tạo GameEngine trực tiếp trong trình duyệt (Chạy mượt trên GitHub Pages / Firebase)
function initStandaloneEngine() {
  if (window.GameEngine) {
    currentHostState = window.GameEngine.createInitialGameState({
      gridCols: tempGridCols,
      gridRows: tempGridRows,
      playerCount: tempPlayerCount,
      shipsPerPlayer: tempShipsPerPlayer,
    });
    renderHostState(currentHostState);
  }

  // Kết nối Firebase Realtime Database
  if (window.firebaseSync && window.firebaseSync.init()) {
    window.firebaseSync.hostListenActions(currentRoomId, handleIncomingFirebaseAction);
    if (currentHostState) {
      window.firebaseSync.hostPublishState(currentRoomId, currentHostState);
    }
    addLogItem('🔥 Đã kích hoạt đồng bộ đám mây Firebase Realtime Database!', 'hit');
  }
}

function initSocket() {
  try {
    socket = io({ timeout: 2500, reconnectionAttempts: 3 });

    socket.emit('host:register', { roomId: currentRoomId });

    socket.on('host:registered', (data) => {
      currentRoomId = data.roomId;
      document.getElementById('roomCodeText').textContent = currentRoomId;
      currentHostState = data.state;
      renderHostState(data.state);

      if (window.firebaseSync && window.firebaseSync.init()) {
        window.firebaseSync.hostListenActions(currentRoomId, handleIncomingFirebaseAction);
        window.firebaseSync.hostPublishState(currentRoomId, data.state);
      }
      addLogItem('🔌 Đã kết nối với máy chủ nội bộ Socket.IO!', 'hit');
    });

    socket.on('host:state_update', (state) => {
      currentHostState = state;
      renderHostState(state);
      if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
        window.firebaseSync.hostPublishState(currentRoomId, state);
      }
    });

    socket.on('battle:shot_fired', (shotRecord) => {
      handleShotAnimation(shotRecord);
      if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
        window.firebaseSync.hostPublishShotEffect(currentRoomId, shotRecord);
      }
    });

    socket.on('battle:shot_undone', () => {
      addLogItem('⏪ Chỉ huy trưởng đã hoàn tác lượt bắn vừa rồi.', 'miss');
    });

    socket.on('phase:changed', ({ phase }) => {
      if (phase === 'PLACEMENT') {
        soundManager.playSonar();
        addLogItem('🗺️ Giai đoạn Dàn Trận: Các hạm đội đang bí mật triển khai vị trí...', 'hit');
      } else if (phase === 'BATTLE') {
        soundManager.playAlarm();
        addLogItem('⚔️ BÁO ĐỘNG ĐỎ: CUỘC CHIẾN CHÍNH THỨC BẮT ĐẦU!', 'sunk');
      } else if (phase === 'LOBBY') {
        addLogItem('🔄 Phòng đấu đã được đặt lại về Sảnh Chờ.', 'miss');
      }
    });
  } catch (err) {
    console.log('Chạy ở chế độ Standalone Web (GitHub Pages / Firebase)');
  }
}

function dispatchHostAction(actionType, payload = {}) {
  if (socket && socket.connected) {
    socket.emit(actionType, { roomId: currentRoomId, ...payload });
    return;
  }
  handleLocalHostAction(actionType, payload);
}

function handleLocalHostAction(actionType, payload) {
  if (!currentHostState || !window.GameEngine) return;

  if (actionType === 'host:add_bot') {
    const emptyTeam = currentHostState.teams.find(t => !t.isConnected && !t.isBot);
    if (emptyTeam) {
      emptyTeam.isBot = true;
      emptyTeam.botName = `Bot Chiến Hạm ${emptyTeam.id}`;
      if (currentHostState.phase === 'PLACEMENT') {
        emptyTeam.fleet = window.GameEngine.generateRandomFleetInZone(emptyTeam.zone, currentHostState.config.shipLengths);
        emptyTeam.isFleetLocked = true;
        emptyTeam.isReady = true;
      }
      addLogItem(`🤖 Đã thêm Bot vào đội [${emptyTeam.name}]`, 'hit');
      commitLocalState();
    }
  } else if (actionType === 'host:fill_bots') {
    currentHostState.teams.forEach(t => {
      if (!t.isConnected && !t.isBot) {
        t.isBot = true;
        t.botName = `Bot Chiến Hạm ${t.id}`;
        if (currentHostState.phase === 'PLACEMENT') {
          t.fleet = window.GameEngine.generateRandomFleetInZone(t.zone, currentHostState.config.shipLengths);
          t.isFleetLocked = true;
          t.isReady = true;
        }
      }
    });
    addLogItem('🤖 Đã lấp đầy tất cả các đội trống bằng Bot!', 'hit');
    commitLocalState();
  } else if (actionType === 'host:start_placement') {
    const res = window.GameEngine.startPlacementPhase(currentHostState);
    if (res && typeof res === 'object') currentHostState = res;
    soundManager.playSonar();
    addLogItem('🗺️ Giai đoạn Dàn Trận: Các hạm đội hãy bố trí chiến hạm vào hải phận!', 'hit');
    commitLocalState();
  } else if (actionType === 'host:start_battle') {
    const res = window.GameEngine.startBattlePhase(currentHostState);
    if (res && typeof res === 'object') currentHostState = res;
    soundManager.playAlarm();
    addLogItem('⚔️ BÁO ĐỘNG ĐỎ: CUỘC CHIẾN CHÍNH THỨC BẮT ĐẦU!', 'sunk');
    commitLocalState();
    checkBotTurn();
  } else if (actionType === 'host:manual_turn') {
    currentHostState.currentTurnTeamId = payload.targetTeamId;
    currentHostState.turnStartTime = Date.now();
    currentHostState.turnTimeRemaining = 60;
    commitLocalState();
    checkBotTurn();
  } else if (actionType === 'host:undo') {
    const res = window.GameEngine.undoLastShot(currentHostState);
    if (res && typeof res === 'object') currentHostState = res;
    addLogItem('⏪ Chỉ huy trưởng đã hoàn tác lượt bắn vừa rồi.', 'miss');
    commitLocalState();
  } else if (actionType === 'host:reset') {
    currentHostState = window.GameEngine.createInitialGameState({
      gridCols: (currentHostState.config && currentHostState.config.gridCols) || tempGridCols,
      gridRows: (currentHostState.config && currentHostState.config.gridRows) || tempGridRows,
      playerCount: currentHostState.config.playerCount,
      shipsPerPlayer: currentHostState.config.shipsPerPlayer,
      shipConfigMode: currentHostState.config.shipConfigMode,
      turnOrderMode: currentHostState.config.turnOrderMode,
    });
    addLogItem('🔄 Phòng đấu đã được đặt lại về Sảnh Chờ.', 'miss');
    commitLocalState();
  } else if (actionType === 'host:update_config') {
    tempGridCols = payload.gridCols || tempGridCols;
    tempGridRows = payload.gridRows || tempGridRows;
    currentHostState = window.GameEngine.createInitialGameState({
      gridCols: tempGridCols,
      gridRows: tempGridRows,
      playerCount: payload.playerCount || tempPlayerCount,
      shipsPerPlayer: payload.shipsPerPlayer || tempShipsPerPlayer,
      shipConfigMode: payload.shipConfigMode || 'mix34',
      turnOrderMode: payload.turnOrderMode || 'random',
    });
    addLogItem(`⚙️ Cập nhật cấu hình: Hải đồ ${tempGridCols}×${tempGridRows} (${tempGridCols * tempGridRows} ô), ${currentHostState.config.playerCount} Đội, ${currentHostState.config.shipsPerPlayer} tàu/đội`, 'hit');
    commitLocalState();
  }
}

function commitLocalState() {
  renderHostState(currentHostState);
  if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
    window.firebaseSync.hostPublishState(currentRoomId, currentHostState);
  }
}

function handleIncomingFirebaseAction(action) {
  if (!action || !action.type || !currentRoomId) return;

  if (socket && socket.connected) {
    if (action.type === 'FIRE') {
      socket.emit('player:fire', { roomId: currentRoomId, teamId: action.teamId, targetKey: action.targetKey });
    } else if (action.type === 'CROSSFIRE') {
      socket.emit('player:crossfire', { roomId: currentRoomId, teamId: action.teamId, centerKey: action.centerKey });
    } else if (action.type === 'JOIN') {
      socket.emit('player:join', { roomId: currentRoomId, teamId: action.teamId, playerName: action.playerName, deviceToken: action.deviceToken });
    } else if (action.type === 'READY') {
      socket.emit('player:ready', { roomId: currentRoomId, teamId: action.teamId });
    } else if (action.type === 'AUTO_PLACE') {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: action.teamId });
    } else if (action.type === 'LOCK_FLEET') {
      socket.emit('player:lock_fleet', { roomId: currentRoomId, teamId: action.teamId, fleet: action.fleet });
    }
    return;
  }

  // Chế độ Standalone trình duyệt
  if (!currentHostState || !window.GameEngine) return;

  if (action.type === 'FIRE') {
    processLocalShot(action.teamId, action.targetKey);
  } else if (action.type === 'CROSSFIRE') {
    processLocalCrossfire(action.teamId, action.centerKey);
  } else if (action.type === 'JOIN') {
    const team = currentHostState.teams.find(t => t.id === action.teamId);
    if (team) {
      team.isConnected = true;
      team.playerName = action.playerName || team.name;
      team.isBot = false;
      addLogItem(`👤 <b>${team.playerName}</b> đã gia nhập [${team.name}]!`, 'hit');
      commitLocalState();
    }
  } else if (action.type === 'READY') {
    const team = currentHostState.teams.find(t => t.id === action.teamId);
    if (team) {
      team.isReady = !team.isReady;
      commitLocalState();
    }
  } else if (action.type === 'AUTO_PLACE') {
    const team = currentHostState.teams.find(t => t.id === action.teamId);
    if (team && currentHostState.phase === 'PLACEMENT') {
      const enemyCells = new Set();
      currentHostState.teams.forEach(other => {
        if (other.id !== team.id && other.fleet) {
          other.fleet.forEach(s => s.cells && s.cells.forEach(k => enemyCells.add(k)));
        }
      });
      team.fleet = window.GameEngine.generateRandomFleetOpenOcean(currentHostState.config.shipLengths, enemyCells);
      team.isFleetLocked = true;
      team.isReady = true;
      addLogItem(`⚓ [${team.name}] đã bố trí đội hình chiến hạm tự động!`, 'hit');
      commitLocalState();
    }
  } else if (action.type === 'LOCK_FLEET') {
    const team = currentHostState.teams.find(t => t.id === action.teamId);
    if (team && currentHostState.phase === 'PLACEMENT') {
      const enemyCells = new Set();
      currentHostState.teams.forEach(other => {
        if (other.id !== team.id && other.fleet) {
          other.fleet.forEach(s => s.cells && s.cells.forEach(k => enemyCells.add(k)));
        }
      });
      const valid = window.GameEngine.validateCustomFleet(action.fleet, currentHostState.config.shipLengths, enemyCells);
      if (valid.valid) {
        team.fleet = action.fleet;
        team.isFleetLocked = true;
        team.isReady = true;
        addLogItem(`⚓ [${team.name}] đã hoàn tất bố trí chiến hạm!`, 'hit');
        commitLocalState();
      } else {
        console.warn('LOCK_FLEET invalid:', valid.error);
      }
    }
  }
}

function processLocalShot(shooterTeamId, targetKey) {
  if (currentHostState.phase !== 'BATTLE' || currentHostState.phase === 'GAME_OVER') return;
  const shooterTeam = currentHostState.teams.find(t => t.id === shooterTeamId);
  if (!shooterTeam || shooterTeam.isEliminated) return;
  if (currentHostState.currentTurnTeamId !== shooterTeam.id) return;

  const result = window.GameEngine.processShot(currentHostState, shooterTeamId, targetKey);
  if (result.success) {
    handleShotAnimation(result.shotRecord);
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
      window.firebaseSync.hostPublishShotEffect(currentRoomId, result.shotRecord);
    }
    commitLocalState();
    checkBotTurn();
  }
}

function processLocalCrossfire(shooterTeamId, centerKey) {
  if (currentHostState.phase !== 'BATTLE' || currentHostState.phase === 'GAME_OVER') return;
  const res = window.GameEngine.processCrossfire(currentHostState, shooterTeamId, centerKey);
  if (res.success) {
    handleCrossfireAnimation(res.crossfireRecord);
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
      window.firebaseSync.hostPublishShotEffect(currentRoomId, res.crossfireRecord);
    }
    commitLocalState();
    checkBotTurn();
  }
}

function handleCrossfireAnimation(record) {
  soundManager.playMissile();
  record.targetKeys.forEach(key => {
    const cell = document.getElementById(`cell-${key}`);
    if (cell) cell.classList.add('crossfire-target');
  });

  setTimeout(() => {
    record.targetKeys.forEach(key => {
      const cell = document.getElementById(`cell-${key}`);
      if (cell) cell.classList.remove('crossfire-target');
    });

    record.shots.forEach(shot => handleShotAnimation(shot));
    const shooterStr = `<b style="color: ${record.shooterColor}">${record.shooterName}</b>`;
    addLogItem(`🚀 ${shooterStr} phóng TÊN LỬA CHỮ THẬP (+) vào tâm <b>[${record.centerKey}]</b> công phá đồng loạt 5 ô!`, 'sunk');
  }, 900);
}

function checkBotTurn() {
  if (botTurnTimer) clearTimeout(botTurnTimer);
  if (!currentHostState || currentHostState.phase !== 'BATTLE' || currentHostState.phase === 'GAME_OVER') return;

  const currentTeam = currentHostState.teams.find(t => t.id === currentHostState.currentTurnTeamId);
  if (currentTeam && currentTeam.isBot && !currentTeam.isEliminated) {
    botTurnTimer = setTimeout(() => {
      if (currentHostState.phase !== 'BATTLE' || currentHostState.currentTurnTeamId !== currentTeam.id) return;
      const targetKey = window.GameEngine.calculateBotTarget(currentHostState, currentTeam.id);
      if (targetKey) {
        processLocalShot(currentTeam.id, targetKey);
      }
    }, 1600);
  }
}

// Bộ đếm thời gian 60s cho mỗi lượt chơi
function startTurnTicker() {
  if (turnTickerInterval) clearInterval(turnTickerInterval);
  turnTickerInterval = setInterval(() => {
    if (!currentHostState || currentHostState.phase !== 'BATTLE') {
      const timerWrapper = document.getElementById('turnTimerWrapper');
      if (timerWrapper) timerWrapper.style.display = 'none';
      return;
    }

    const timerWrapper = document.getElementById('turnTimerWrapper');
    const timerBadge = document.getElementById('turnTimerBadge');
    const timerText = document.getElementById('turnTimerText');
    if (timerWrapper) timerWrapper.style.display = 'flex';

    const turnStart = currentHostState.turnStartTime || Date.now();
    const elapsed = Math.floor((Date.now() - turnStart) / 1000);
    const remaining = Math.max(0, 60 - elapsed);

    if (timerText) timerText.textContent = `${remaining}s`;
    if (timerBadge) {
      if (remaining <= 10) {
        timerBadge.classList.add('urgent');
      } else {
        timerBadge.classList.remove('urgent');
      }
    }

    // Khi hết 60s
    if (remaining === 0) {
      addLogItem(`⏰ Đã hết 60s thời gian suy nghĩ! Pháo tự động khai hỏa!`, 'miss');
      if (window.GameEngine) {
        const timeoutRes = window.GameEngine.handleTurnTimeout(currentHostState);
        if (timeoutRes && timeoutRes.shotRecord) {
          handleShotAnimation(timeoutRes.shotRecord);
          if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
            window.firebaseSync.hostPublishShotEffect(currentRoomId, timeoutRes.shotRecord);
          }
        }
        commitLocalState();
        checkBotTurn();
      }
    }
  }, 1000);
}

function fitOceanGridToScreen() {
  const wrapper = document.querySelector('.ocean-map-wrapper');
  const grid = document.getElementById('oceanMapGrid');
  if (!wrapper || !grid) return;

  const numCols = COLS.length;
  const numRows = ROWS.length;
  if (!numCols || !numRows) return;

  const rect = wrapper.getBoundingClientRect();
  const pad = 6;
  const availW = Math.max(100, rect.width - pad);
  const availH = Math.max(100, rect.height - pad);

  // Kích thước header: cột số hàng bên trái & hàng chữ cột bên trên
  const headerColW = Math.max(16, Math.min(24, Math.floor(availW / (numCols + 1))));
  const headerRowH = Math.max(14, Math.min(22, Math.floor(availH / (numRows + 1))));
  const gap = 2;

  // Diện tích khả dụng dành cho các ô hải đồ
  const remainingW = availW - headerColW - (numCols * gap);
  const remainingH = availH - headerRowH - (numRows * gap);

  const cellW = remainingW / numCols;
  const cellH = remainingH / numRows;

  // Ô vuông hoàn hảo fit khít cả chiều ngang và chiều dọc
  let cellSize = Math.floor(Math.min(cellW, cellH));
  cellSize = Math.max(8, cellSize);

  grid.style.gridTemplateColumns = `${headerColW}px repeat(${numCols}, ${cellSize}px)`;
  grid.style.gridTemplateRows = `${headerRowH}px repeat(${numRows}, ${cellSize}px)`;
  grid.style.width = `${headerColW + numCols * cellSize + numCols * gap}px`;
  grid.style.height = `${headerRowH + numRows * cellSize + numRows * gap}px`;

  const fontSize = Math.max(7, Math.min(13, Math.floor(cellSize * 0.42)));
  grid.style.setProperty('--cell-size', `${cellSize}px`);
  grid.style.setProperty('--cell-font-size', `${fontSize}px`);

  const corner = grid.querySelector('.ocean-header-corner');
  if (corner) {
    corner.style.width = `${headerColW}px`;
    corner.style.height = `${headerRowH}px`;
  }

  grid.querySelectorAll('.ocean-col-header').forEach(el => {
    el.style.width = `${cellSize}px`;
    el.style.height = `${headerRowH}px`;
    el.style.fontSize = `${Math.max(7, Math.min(12, Math.floor(cellSize * 0.45)))}px`;
  });

  grid.querySelectorAll('.ocean-row-header').forEach(el => {
    el.style.width = `${headerColW}px`;
    el.style.height = `${cellSize}px`;
    el.style.fontSize = `${Math.max(7, Math.min(12, Math.floor(cellSize * 0.45)))}px`;
  });
}

function initGrid() {
  const container = document.getElementById('oceanMapGrid');
  if (!container) return;
  container.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'ocean-header-corner';
  container.appendChild(corner);

  for (let c = 0; c < COLS.length; c++) {
    const colHeader = document.createElement('div');
    colHeader.className = 'ocean-col-header';
    colHeader.textContent = COLS[c];
    container.appendChild(colHeader);
  }

  for (let r = 0; r < ROWS.length; r++) {
    const rowNum = ROWS[r];
    const rowHeader = document.createElement('div');
    rowHeader.className = 'ocean-row-header';
    rowHeader.textContent = rowNum;
    container.appendChild(rowHeader);

    for (let c = 0; c < COLS.length; c++) {
      const colLetter = COLS[c];
      const key = `${colLetter}${rowNum}`;

      const cell = document.createElement('div');
      cell.className = 'ocean-cell';
      cell.id = `cell-${key}`;
      cell.dataset.key = key;
      cell.dataset.col = colLetter;
      cell.dataset.row = rowNum;
      cell.title = `Tọa độ: ${colLetter}-${rowNum}`;

      // Cho phép MC bấm bắn thay mặt đội đang có lượt
      cell.addEventListener('click', () => {
        if (!currentHostState || currentHostState.phase !== 'BATTLE') return;
        const currentTeam = currentHostState.teams.find(t => t.id === currentHostState.currentTurnTeamId);
        if (!currentTeam || currentTeam.isEliminated) return;

        if (currentHostState.shotsMap && currentHostState.shotsMap[key]) {
          return;
        }

        if (confirm(`MC xác nhận khai hỏa vào ô [${key}] cho Đội ${currentTeam.name}?`)) {
          if (socket && socket.connected) {
            socket.emit('player:fire', { roomId: currentRoomId, teamId: currentTeam.id, targetKey: key });
          } else {
            processLocalShot(currentTeam.id, key);
          }
        }
      });

      container.appendChild(cell);
    }
  }

  fitOceanGridToScreen();
}

function renderHostState(state) {
  if (!state) return;
  currentHostState = state;

  // Đồng bộ kích thước lưới hải đồ nếu có thay đổi từ state / host
  if (state.grid && state.grid.cols && state.grid.rows) {
    if (state.grid.cols.length !== COLS.length || state.grid.rows.length !== ROWS.length) {
      COLS = [...state.grid.cols];
      ROWS = [...state.grid.rows];
      tempGridCols = COLS.length;
      tempGridRows = ROWS.length;
      initGrid();
    }
  } else if (state.config && state.config.gridCols && state.config.gridRows) {
    if (state.config.gridCols !== COLS.length || state.config.gridRows !== ROWS.length) {
      COLS = ALL_LETTERS.slice(0, state.config.gridCols);
      ROWS = Array.from({ length: state.config.gridRows }, (_, i) => i + 1);
      tempGridCols = COLS.length;
      tempGridRows = ROWS.length;
      initGrid();
    }
  }

  // Cập nhật tiêu đề hải đồ
  const titleEl = document.getElementById('oceanMapTitleText');
  if (titleEl) {
    const total = COLS.length * ROWS.length;
    const lastCol = COLS[COLS.length - 1];
    const lastRow = ROWS[ROWS.length - 1];
    titleEl.textContent = `🗺️ ĐẠI HẢI ĐỒ ${total} Ô (A-${lastCol} × 1-${lastRow})`;
  }

  updatePhaseAndControls(state);
  renderTeamsRoster(state);
  renderOceanMap(state);
  updateStats(state);
  fitOceanGridToScreen();
}

function updatePhaseAndControls(state) {
  const phaseBadge = document.getElementById('phaseBadge');
  const btnStartPlacement = document.getElementById('btnStartPlacement');
  const btnStartBattle = document.getElementById('btnStartBattle');
  const btnManualTurn = document.getElementById('btnManualTurn');
  const btnUndo = document.getElementById('btnUndo');
  const statusTurnText = document.getElementById('statusTurnText');
  const statusProgressText = document.getElementById('statusProgressText');
  const quickFireBar = document.getElementById('hostQuickFireBar');

  const totalCount = state.teams ? state.teams.length : 0;
  const readyCount = state.teams ? state.teams.filter(t => t.isReady).length : 0;
  const lockedCount = state.teams ? state.teams.filter(t => t.isFleetLocked).length : 0;
  const pLabel = document.getElementById('playerCountLabel');
  if (pLabel) pLabel.textContent = `${totalCount} Đội`;

  if (state.phase === 'LOBBY') {
    phaseBadge.textContent = 'SẢNH CHỜ';
    phaseBadge.style.background = '#e0f2fe';
    phaseBadge.style.color = '#0284c7';

    statusProgressText.textContent = `${readyCount}/${totalCount} Đội Sẵn Sàng`;
    statusTurnText.textContent = 'Đang chờ người chơi hoặc thêm máy vào phòng';

    btnStartPlacement.style.display = 'inline-flex';
    btnStartBattle.style.display = 'none';
    btnManualTurn.style.display = 'none';
    btnUndo.style.display = 'none';
    if (quickFireBar) quickFireBar.style.display = 'none';
  } else if (state.phase === 'PLACEMENT') {
    phaseBadge.textContent = 'DÀN TRẬN';
    phaseBadge.style.background = '#fef3c7';
    phaseBadge.style.color = '#d97706';

    statusProgressText.textContent = `${lockedCount}/${totalCount} Đội Đã Khóa Tàu`;
    statusTurnText.textContent = 'Các đội đang dàn trận bí mật';

    btnStartPlacement.style.display = 'none';
    btnStartBattle.style.display = 'inline-flex';
    btnManualTurn.style.display = 'none';
    btnUndo.style.display = 'none';
    if (quickFireBar) quickFireBar.style.display = 'none';
  } else if (state.phase === 'BATTLE') {
    phaseBadge.textContent = 'CHIẾN ĐẤU';
    phaseBadge.style.background = '#fee2e2';
    phaseBadge.style.color = '#dc2626';

    const currentTeam = state.teams.find(t => t.id === state.currentTurnTeamId);
    if (currentTeam) {
      statusTurnText.innerHTML = `LƯỢT: <span style="color: ${currentTeam.colorHex};">${currentTeam.name}</span> (Lượt #${state.turnNumber})`;
    }

    const livingCount = state.teams.filter(t => !t.isEliminated).length;
    statusProgressText.textContent = `${livingCount}/${totalCount} Hạm Đội Còn Sống`;

    btnStartPlacement.style.display = 'none';
    btnStartBattle.style.display = 'none';
    btnManualTurn.style.display = 'inline-flex';
    btnUndo.style.display = 'inline-flex';
    if (quickFireBar) quickFireBar.style.display = 'flex';
  } else if (state.phase === 'GAME_OVER' || state.phase === 'FINISHED') {
    phaseBadge.textContent = 'KẾT THÚC';
    phaseBadge.style.background = '#dcfce7';
    phaseBadge.style.color = '#15803d';

    if (state.winner) {
      statusTurnText.innerHTML = `🏆 CHIẾN THẮNG: <span style="color: ${state.winner.colorHex};">${state.winner.name}</span>!`;
    }
    statusProgressText.textContent = 'Trận đại chiến đã kết thúc';

    btnStartPlacement.style.display = 'none';
    btnStartBattle.style.display = 'none';
    btnManualTurn.style.display = 'none';
    btnUndo.style.display = 'inline-flex';
    if (quickFireBar) quickFireBar.style.display = 'none';
  }
}

function renderTeamsRoster(state) {
  const container = document.getElementById('teamsRosterList');
  if (!container) return;
  container.innerHTML = '';

  state.teams.forEach(team => {
    const isCurrentTurn = state.phase === 'BATTLE' && state.currentTurnTeamId === team.id;
    const card = document.createElement('div');
    card.className = `team-roster-card ${isCurrentTurn ? 'active-turn' : ''} ${team.isEliminated ? 'eliminated' : ''}`;
    if (isCurrentTurn) {
      card.style.borderColor = team.colorHex;
      card.style.background = `${team.colorHex}15`;
      card.style.boxShadow = `0 0 12px ${team.colorHex}66`;
    }

    let statusText = '';
    if (team.isEliminated) {
      statusText = '<span style="color: #dc2626; font-weight: 800; font-size: 0.8rem;">☠️ ĐÃ CHÌM</span>';
    } else if (state.phase === 'LOBBY') {
      statusText = `<span style="font-weight: 700; color: ${team.isReady ? '#16a34a' : '#64748b'}; font-size: 0.75rem;">${team.isReady ? '✓ Sẵn sàng' : 'Chưa vào'}</span>`;
    } else if (state.phase === 'PLACEMENT') {
      statusText = `<span style="font-weight: 700; color: ${team.isFleetLocked ? '#16a34a' : '#d97706'}; font-size: 0.75rem;">${team.isFleetLocked ? '🔒 Đã dàn trận' : '⏳ Đang xếp'}</span>`;
    } else {
      statusText = `<span style="font-weight: 800; color: #15803d; font-size: 0.82rem;">❤️ ${team.shipsRemaining} tàu</span>`;
    }

    const crossRemaining = team.crossfireRemaining ?? 1;

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 1.25rem;">${team.icon}</span>
        <div>
          <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.85rem; line-height: 1.2;">${team.name}</div>
          <div style="font-size: 0.7rem; color: #64748b;">${team.isBot ? '🤖 Bot AI' : (team.playerName || 'Trống')}</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div>${statusText}</div>
        <div style="font-size: 0.65rem; color: #ea580c; margin-top: 1px; font-weight: bold;">
          🚀 Chữ Thập: ${crossRemaining}/1
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderOceanMap(state) {
  document.querySelectorAll('.ocean-cell').forEach(cell => {
    cell.className = 'ocean-cell';
    cell.innerHTML = '';
    cell.style.borderColor = '';
    cell.style.background = '';
  });

  // Hiển thị vị trí tàu chiến liền khối (nếu tàu đã chìm HOẶC MC bật xem tàu ẩn)
  if (state.teams) {
    state.teams.forEach(team => {
      if (team.fleet) {
        team.fleet.forEach(ship => {
          const isShipSunk = ship.isSunk;
          if (showSecretShips || isShipSunk) {
            ship.cells.forEach(key => {
              const cell = document.getElementById(`cell-${key}`);
              if (!cell) return;
              const partClass = window.GameEngine.getShipPartClass(ship, key);
              cell.classList.add('has-ship');
              if (partClass) cell.classList.add(partClass);
              cell.style.borderColor = team.colorHex;

              if (isShipSunk) {
                cell.classList.add('shot-sunk');
              } else if (ship.hits && ship.hits.includes(key)) {
                cell.classList.add('shot-hit');
              }
            });
          }
        });
      }
    });
  }

  // Hiển thị các phát bắn trượt và trúng khác
  if (state.shotsMap) {
    for (const key in state.shotsMap) {
      const shot = state.shotsMap[key];
      const cell = document.getElementById(`cell-${key}`);
      if (!cell) continue;

      if (shot.result === 'MISS') {
        cell.className = 'ocean-cell shot-miss';
      } else if (shot.result === 'HIT' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-hit';
      } else if (shot.result === 'SUNK' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-sunk';
      }

      if (shot.easterEgg || shot.isLuckyCell) {
        cell.innerHTML = '<span style="font-size: 0.85em; z-index: 2;">🎁</span>';
        cell.style.boxShadow = 'inset 0 0 6px #f59e0b';
      }
    }
  }
}

function handleShotAnimation(shot) {
  const cell = document.getElementById(`cell-${shot.targetKey}`);
  if (!cell) return;

  soundManager.playMissile();

  cell.classList.add('targeted');
  setTimeout(() => {
    cell.classList.remove('targeted');

    if (shot.result === 'HIT' || shot.result === 'SUNK') {
      soundManager.playHit();
      if (shot.result === 'SUNK') {
        setTimeout(() => soundManager.playSunk(), 250);
      }
    } else {
      soundManager.playMiss();
    }

    const shooterStr = `<b style="color: ${shot.shooterColor}">${shot.shooterName}</b>`;
    if (shot.result === 'HIT') {
      addLogItem(`${shooterStr} khai hỏa vào <b>[${shot.targetKey}]</b> ➔ 💥 BẮN TRÚNG TÀU đối phương!`, 'hit');
    } else if (shot.result === 'SUNK') {
      addLogItem(`${shooterStr} khai hỏa vào <b>[${shot.targetKey}]</b> ➔ ☠️ BẮN CHÌM ${shot.sunkShip ? shot.sunkShip.name : 'chiến hạm'} của ${shot.hitTeamName}!`, 'sunk');
      if (shot.eliminatedTeam) {
        addLogItem(`🚨 ĐỘI ${shot.eliminatedTeam.name} ĐÃ BỊ HỦY DIỆT HOÀN TOÀN!`, 'sunk');
      }
    } else {
      addLogItem(`${shooterStr} khai hỏa vào <b>[${shot.targetKey}]</b> ➔ 🌊 Bắn trượt xuống biển!`, 'miss');
    }

    // 🎁 Kích hoạt hiệu ứng Easter Egg nếu trúng 10% may mắn
    if (shot.easterEgg) {
      soundManager.playAlarm();
      const eggBanner = document.getElementById('hostEasterEggBanner');
      if (eggBanner) {
        eggBanner.textContent = `🎁 EASTER EGG! Đội ${shot.shooterName} nhặt được Tiếp Tế Đạn Dược - Nhận thêm 1 lượt bắn!`;
        eggBanner.style.display = 'block';
        setTimeout(() => {
          eggBanner.style.display = 'none';
        }, 3500);
      }
      addLogItem(`🎁 <b>EASTER EGG!</b> ${shooterStr} đào được hòm tiếp tế đạn dược ➔ <b>NHẬN THÊM +1 LƯỢT BẮN!</b>`, 'hit');
    }
  }, 700);
}

function addLogItem(text, type = 'normal') {
  const container = document.getElementById('combatLogContainer');
  if (!container) return;
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  item.innerHTML = text;
  container.prepend(item);
}

function updateStats(state) {
  let missCount = 0;
  let hitCount = 0;
  let sunkCount = 0;

  if (state.shotsMap) {
    for (const k in state.shotsMap) {
      const s = state.shotsMap[k];
      if (s.result === 'MISS') missCount++;
      if (s.result === 'HIT') hitCount++;
      if (s.result === 'SUNK') sunkCount++;
    }
  }

  document.getElementById('statMissCount').textContent = missCount;
  document.getElementById('statHitCount').textContent = hitCount;
  document.getElementById('statSunkCount').textContent = sunkCount;
  document.getElementById('statTotalShots').textContent = state.shotsHistory ? state.shotsHistory.length : 0;
}

function initEventListeners() {
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };

  // Thêm 1 bot
  on('btnAddBot', () => {
    dispatchHostAction('host:add_bot');
  });

  // Lấp đầy bằng bot
  on('btnFillBots', () => {
    dispatchHostAction('host:fill_bots');
  });

  // Bắt đầu dàn trận
  on('btnStartPlacement', () => {
    dispatchHostAction('host:start_placement');
  });

  // Bắt đầu chiến đấu
  on('btnStartBattle', () => {
    dispatchHostAction('host:start_battle');
  });

  // Chuyển lượt thủ công
  on('btnManualTurn', () => {
    if (!currentHostState) return;
    const living = currentHostState.teams.filter(t => !t.isEliminated);
    if (living.length > 0) {
      const currentIdx = living.findIndex(t => t.id === currentHostState.currentTurnTeamId);
      const nextTeam = living[(currentIdx + 1) % living.length];
      dispatchHostAction('host:manual_turn', { targetTeamId: nextTeam.id });
    }
  });

  // Hoàn tác
  on('btnUndo', () => {
    dispatchHostAction('host:undo');
  });

  // Đặt lại
  on('btnResetGame', () => {
    if (confirm('Bạn có chắc muốn đặt lại ván đấu mới không?')) {
      dispatchHostAction('host:reset');
    }
  });

  // MC Nhập Tọa Độ Nhanh
  const inputHostCoord = document.getElementById('inputHostCoord');
  const btnHostFireCoord = document.getElementById('btnHostFireCoord');
  const btnHostCrossfireCoord = document.getElementById('btnHostCrossfireCoord');

  if (btnHostFireCoord) {
    btnHostFireCoord.addEventListener('click', () => {
      const val = inputHostCoord ? inputHostCoord.value.trim().toUpperCase() : '';
      if (!val) { alert('Vui lòng nhập tọa độ! (VD: B14)'); return; }
      if (!currentHostState || currentHostState.phase !== 'BATTLE') return;
      processLocalShot(currentHostState.currentTurnTeamId, val);
      if (inputHostCoord) inputHostCoord.value = '';
    });
  }

  if (btnHostCrossfireCoord) {
    btnHostCrossfireCoord.addEventListener('click', () => {
      const val = inputHostCoord ? inputHostCoord.value.trim().toUpperCase() : '';
      if (!val) { alert('Vui lòng nhập tọa độ tâm bắn chữ thập! (VD: B14)'); return; }
      if (!currentHostState || currentHostState.phase !== 'BATTLE') return;
      processLocalCrossfire(currentHostState.currentTurnTeamId, val);
      if (inputHostCoord) inputHostCoord.value = '';
    });
  }

  // Xem vị trí tàu ẩn toggle
  const chkSecret = document.getElementById('chkShowSecretShips');
  if (chkSecret) {
    chkSecret.addEventListener('change', (e) => {
      showSecretShips = e.target.checked;
      if (currentHostState) renderOceanMap(currentHostState);
    });
  }

  // Bật/Tắt âm thanh
  on('btnSoundToggle', () => {
    const isEnabled = soundManager.isEnabled();
    soundManager.setEnabled(!isEnabled);
    const btn = document.getElementById('btnSoundToggle');
    if (btn) btn.textContent = !isEnabled ? '🔊 Âm Thanh' : '🔇 Đã Tắt Âm';
  });

  // Modal QR
  on('btnOpenQR', openQRModal);
  on('qrMiniThumb', openQRModal);
  on('btnCloseQR', closeQRModal);
  const modalQR = document.getElementById('modalQR');
  if (modalQR) {
    modalQR.addEventListener('click', (e) => {
      if (e.target.id === 'modalQR') closeQRModal();
    });
  }

  on('btnCopyUrl', () => {
    const input = document.getElementById('qrCopyUrlInput');
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Đã sao chép đường link tham gia!');
    }
  });

  // Modal Cấu hình
  on('btnOpenConfig', openConfigModal);
  on('btnCloseConfig', closeConfigModal);
  const modalConfig = document.getElementById('modalConfig');
  if (modalConfig) {
    modalConfig.addEventListener('click', (e) => {
      if (e.target.id === 'modalConfig') closeConfigModal();
    });
  }

  // Nút đổi kích thước nhanh trên thanh tiêu đề
  on('btnQuickGridSetup', openConfigModal);

  // Chọn diện tích hải đồ (Presets)
  document.querySelectorAll('.cfg-grid-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      tempGridCols = parseInt(btn.dataset.cols, 10);
      tempGridRows = parseInt(btn.dataset.rows, 10);
      const colsInput = document.getElementById('cfgGridColsInput');
      const rowsInput = document.getElementById('cfgGridRowsInput');
      if (colsInput) colsInput.value = tempGridCols;
      if (rowsInput) rowsInput.value = tempGridRows;
      updateGridConfigBadge();
    });
  });

  // Nhập số lượng ô 2 trục bằng tay
  const colsInput = document.getElementById('cfgGridColsInput');
  if (colsInput) {
    colsInput.addEventListener('input', () => {
      let val = parseInt(colsInput.value, 10);
      if (!isNaN(val) && val >= 8 && val <= 26) {
        tempGridCols = val;
        updateGridConfigBadge();
      }
    });
  }

  const rowsInput = document.getElementById('cfgGridRowsInput');
  if (rowsInput) {
    rowsInput.addEventListener('input', () => {
      let val = parseInt(rowsInput.value, 10);
      if (!isNaN(val) && val >= 8 && val <= 26) {
        tempGridRows = val;
        updateGridConfigBadge();
      }
    });
  }

  // Chọn số lượng đội (2 -> 8)
  document.querySelectorAll('.cfg-player-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cfg-player-btn').forEach(b => {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-outline');
      });
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary', 'active');
      tempPlayerCount = parseInt(btn.dataset.val, 10);
    });
  });

  // Chọn số lượng tàu (1 -> 5)
  document.querySelectorAll('.cfg-ship-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cfg-ship-btn').forEach(b => {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-outline');
      });
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary', 'active');
      tempShipsPerPlayer = parseInt(btn.dataset.val, 10);
    });
  });

  on('btnSaveConfig', () => {
    const shipMode = document.getElementById('cfgShipConfigMode') ? document.getElementById('cfgShipConfigMode').value : 'mix34';
    const turnOrder = document.getElementById('cfgTurnOrderMode') ? document.getElementById('cfgTurnOrderMode').value : 'random';
    const cInput = document.getElementById('cfgGridColsInput');
    const rInput = document.getElementById('cfgGridRowsInput');
    if (cInput) {
      tempGridCols = Math.min(26, Math.max(8, parseInt(cInput.value, 10) || 20));
    }
    if (rInput) {
      tempGridRows = Math.min(26, Math.max(8, parseInt(rInput.value, 10) || 20));
    }

    dispatchHostAction('host:update_config', {
      gridCols: tempGridCols,
      gridRows: tempGridRows,
      playerCount: tempPlayerCount,
      shipsPerPlayer: tempShipsPerPlayer,
      shipConfigMode: shipMode,
      turnOrderMode: turnOrder,
    });
    closeConfigModal();
  });

  // Modal Firebase
  on('btnOpenFirebaseModal', openFirebaseModal);
  on('btnCloseFirebase', closeFirebaseModal);
  const modalFirebase = document.getElementById('modalFirebase');
  if (modalFirebase) {
    modalFirebase.addEventListener('click', (e) => {
      if (e.target.id === 'modalFirebase') closeFirebaseModal();
    });
  }

  on('btnSaveFirebase', () => {
    const dbUrl = document.getElementById('inputFirebaseDbUrl') ? document.getElementById('inputFirebaseDbUrl').value.trim() : '';
    const apiKey = document.getElementById('inputFirebaseApiKey') ? document.getElementById('inputFirebaseApiKey').value.trim() : '';
    const projectId = document.getElementById('inputFirebaseProjectId') ? document.getElementById('inputFirebaseProjectId').value.trim() : '';

    if (!dbUrl) {
      alert('Vui lòng nhập Database URL của Firebase!');
      return;
    }

    const cfg = {
      databaseURL: dbUrl,
      apiKey: apiKey || '',
      projectId: projectId || '',
    };

    saveFirebaseConfig(cfg);
    const ok = window.firebaseSync.init();
    if (ok) {
      if (currentRoomId) {
        window.firebaseSync.hostListenActions(currentRoomId, handleIncomingFirebaseAction);
        if (currentHostState) {
          window.firebaseSync.hostPublishState(currentRoomId, currentHostState);
        }
      }
      alert('⚡ Đã kết nối thành công với Google Firebase Realtime Database!');
      addLogItem('🔥 Đã kết nối Firebase Realtime Database!', 'hit');
      closeFirebaseModal();
    } else {
      alert('Không thể kết nối Firebase với thông tin đã nhập. Vui lòng kiểm tra lại URL.');
    }
  });
}

function openFirebaseModal() {
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) {
    document.getElementById('inputFirebaseDbUrl').value = window.FIREBASE_CONFIG.databaseURL;
    document.getElementById('inputFirebaseApiKey').value = window.FIREBASE_CONFIG.apiKey || '';
    document.getElementById('inputFirebaseProjectId').value = window.FIREBASE_CONFIG.projectId || '';
  }
  document.getElementById('modalFirebase').classList.add('active');
}

function closeFirebaseModal() {
  document.getElementById('modalFirebase').classList.remove('active');
}

function loadNetworkAndQR() {
  let joinUrl = `${window.location.origin}${window.location.pathname.replace('host.html', 'join.html')}?room=${currentRoomId || 'PHONG-01'}`;

  // Kiểm tra nếu pathname chưa có join.html
  if (!joinUrl.includes('join.html')) {
    joinUrl = `${window.location.origin}/join.html?room=${currentRoomId || 'PHONG-01'}`;
  }

  applyQRToUI(joinUrl);

  // Thử lấy joinUrl từ API local nếu chạy bằng node server
  fetch(`/api/network-info?room=${currentRoomId || ''}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.joinUrl) {
        applyQRToUI(data.joinUrl);
      }
    })
    .catch(() => {});
}

function applyQRToUI(url) {
  const miniUrlEl = document.getElementById('qrMiniUrl');
  const copyInputEl = document.getElementById('qrCopyUrlInput');
  if (miniUrlEl) miniUrlEl.textContent = url;
  if (copyInputEl) copyInputEl.value = url;

  const thumbEl = document.getElementById('qrMiniThumb');
  const bigEl = document.getElementById('qrBigImage');

  // Ưu tiên 1: Tạo trực tiếp bằng thư viện QRCode (offline, 100% không bị chặn)
  if (window.QRCode && window.QRCode.toDataURL) {
    window.QRCode.toDataURL(url, { width: 320, margin: 1 }, (err, dataUri) => {
      if (!err && dataUri) {
        if (thumbEl) thumbEl.src = dataUri;
        if (bigEl) bigEl.src = dataUri;
      } else {
        fallbackQRImage(url, thumbEl, bigEl);
      }
    });
  } else {
    fallbackQRImage(url, thumbEl, bigEl);
  }
}

function fallbackQRImage(url, thumbEl, bigEl) {
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
  if (thumbEl) thumbEl.src = qrApiUrl;
  if (bigEl) bigEl.src = qrApiUrl;
}

function openQRModal() {
  loadNetworkAndQR();
  const m = document.getElementById('modalQR');
  if (m) m.classList.add('active');
}

function closeQRModal() {
  const m = document.getElementById('modalQR');
  if (m) m.classList.remove('active');
}

function updateGridConfigBadge() {
  const badge = document.getElementById('cfgTotalCellsBadge');
  if (badge) {
    badge.textContent = `${tempGridCols * tempGridRows} Ô (${tempGridCols} × ${tempGridRows})`;
  }
  document.querySelectorAll('.cfg-grid-preset').forEach(btn => {
    const c = parseInt(btn.dataset.cols, 10);
    const r = parseInt(btn.dataset.rows, 10);
    if (c === tempGridCols && r === tempGridRows) {
      btn.classList.add('btn-primary', 'active');
      btn.classList.remove('btn-outline');
    } else {
      btn.classList.remove('btn-primary', 'active');
      btn.classList.add('btn-outline');
    }
  });
}

function openConfigModal() {
  if (currentHostState && currentHostState.phase !== 'LOBBY') {
    alert('Chỉ có thể điều chỉnh cấu hình khi đang ở Sảnh Chờ! Nếu muốn đổi diện tích hải đồ, vui lòng bấm nút "🔄 Đặt Lại" để về Sảnh Chờ trước.');
    return;
  }
  const colsInput = document.getElementById('cfgGridColsInput');
  const rowsInput = document.getElementById('cfgGridRowsInput');
  if (colsInput) colsInput.value = tempGridCols;
  if (rowsInput) rowsInput.value = tempGridRows;
  updateGridConfigBadge();

  document.getElementById('modalConfig').classList.add('active');
}

function closeConfigModal() {
  document.getElementById('modalConfig').classList.remove('active');
}
})();
