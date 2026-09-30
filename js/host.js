// public/js/host.js
// Logic điều khiển trung tâm MC Host thuần Tiếng Việt 100%, tích hợp Bot AI kiểm thử
// Hỗ trợ đồng thời: Máy chủ Socket.IO cục bộ & Chế độ Đám Mây GitHub Pages + Firebase RTDB
// Bản đồ 20x20 (400 ô), Đếm ngược 60s, Kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+)

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

let socket = null;
let currentRoomId = 'PHONG-01';
let currentHostState = null;
let soundManager = null;
let showSecretShips = false;
let botTurnTimer = null;
let turnTickerInterval = null;

let tempPlayerCount = 4;
let tempShipsPerPlayer = 2;

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
});

// Khởi tạo GameEngine trực tiếp trong trình duyệt (Chạy mượt trên GitHub Pages / Firebase)
function initStandaloneEngine() {
  if (window.GameEngine) {
    currentHostState = window.GameEngine.createInitialGameState({
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
    currentHostState = window.GameEngine.startPlacementPhase(currentHostState);
    soundManager.playSonar();
    addLogItem('🗺️ Giai đoạn Dàn Trận: Các hạm đội hãy bố trí chiến hạm vào hải phận!', 'hit');
    commitLocalState();
  } else if (actionType === 'host:start_battle') {
    currentHostState = window.GameEngine.startBattlePhase(currentHostState);
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
    currentHostState = window.GameEngine.undoLastShot(currentHostState);
    addLogItem('⏪ Chỉ huy trưởng đã hoàn tác lượt bắn vừa rồi.', 'miss');
    commitLocalState();
  } else if (actionType === 'host:reset') {
    currentHostState = window.GameEngine.createInitialGameState({
      playerCount: currentHostState.config.playerCount,
      shipsPerPlayer: currentHostState.config.shipsPerPlayer,
    });
    addLogItem('🔄 Phòng đấu đã được đặt lại về Sảnh Chờ.', 'miss');
    commitLocalState();
  } else if (actionType === 'host:update_config') {
    currentHostState = window.GameEngine.createInitialGameState({
      playerCount: payload.playerCount,
      shipsPerPlayer: payload.shipsPerPlayer,
    });
    addLogItem(`⚙️ Đã cập nhật cấu hình: ${payload.playerCount} Đội, ${payload.shipsPerPlayer} tàu/đội`, 'hit');
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
    } else if (action.type === 'RADAR') {
      socket.emit('player:radar', { roomId: currentRoomId, teamId: action.teamId, centerKey: action.centerKey });
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
  } else if (action.type === 'RADAR') {
    processLocalRadar(action.teamId, action.centerKey);
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
      team.fleet = window.GameEngine.generateRandomFleetInZone(team.zone, currentHostState.config.shipLengths);
      team.isFleetLocked = true;
      team.isReady = true;
      addLogItem(`⚓ [${team.name}] đã bố trí đội hình chiến hạm tự động!`, 'hit');
      commitLocalState();
    }
  } else if (action.type === 'LOCK_FLEET') {
    const team = currentHostState.teams.find(t => t.id === action.teamId);
    if (team && currentHostState.phase === 'PLACEMENT') {
      const valid = window.GameEngine.validateCustomFleet(action.fleet, team.zone, currentHostState.config.shipLengths);
      if (valid.valid) {
        team.fleet = action.fleet;
        team.isFleetLocked = true;
        team.isReady = true;
        addLogItem(`⚓ [${team.name}] đã hoàn tất bố trí chiến hạm!`, 'hit');
        commitLocalState();
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

function processLocalRadar(shooterTeamId, centerKey) {
  if (currentHostState.phase !== 'BATTLE' || currentHostState.phase === 'GAME_OVER') return;
  const res = window.GameEngine.processRadarScan(currentHostState, shooterTeamId, centerKey);
  if (res.success) {
    handleRadarAnimation(res.radarRecord);
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId) {
      window.firebaseSync.hostPublishShotEffect(currentRoomId, res.radarRecord);
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

function handleRadarAnimation(radar) {
  soundManager.playSonar();
  radar.scannedCells.forEach(key => {
    const cell = document.getElementById(`cell-${key}`);
    if (cell) cell.classList.add('radar-sweep');
  });

  setTimeout(() => {
    radar.scannedCells.forEach(key => {
      const cell = document.getElementById(`cell-${key}`);
      if (cell) cell.classList.remove('radar-sweep');
    });

    const shooterStr = `<b style="color: ${radar.shooterColor}">${radar.shooterName}</b>`;
    if (radar.hasEnemyShip) {
      soundManager.playAlarm();
      addLogItem(`📡 ${shooterStr} quét Radar vùng <b>[${radar.centerKey}] (3x3)</b> ➔ ⚠️ PHÁT HIỆN ${radar.detectedCount} tọa độ có tàu địch!`, 'hit');
    } else {
      addLogItem(`📡 ${shooterStr} quét Radar vùng <b>[${radar.centerKey}] (3x3)</b> ➔ 🌊 Vùng biển an toàn, không có bóng dáng tàu địch!`, 'miss');
    }
  }, 1200);
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

function initGrid() {
  const container = document.getElementById('oceanMapGrid');
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
}

function renderHostState(state) {
  if (!state) return;
  currentHostState = state;

  updatePhaseAndControls(state);
  renderTeamsRoster(state);
  renderOceanMap(state);
  updateStats(state);
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

  const readyCount = state.teams.filter(t => t.isReady).length;
  const lockedCount = state.teams.filter(t => t.isFleetLocked).length;
  const totalCount = state.teams.length;

  document.getElementById('playerCountLabel').textContent = `${totalCount} Đội`;

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
  container.innerHTML = '';

  state.teams.forEach(team => {
    const isCurrentTurn = state.phase === 'BATTLE' && state.currentTurnTeamId === team.id;
    const card = document.createElement('div');
    card.className = `team-roster-card ${isCurrentTurn ? 'active-turn' : ''} ${team.isEliminated ? 'eliminated' : ''}`;
    card.style.borderLeftColor = team.colorHex;

    let statusBadge = '';
    if (team.isEliminated) {
      statusBadge = '<span class="status-badge status-offline">ĐÃ BỊ CHÌM</span>';
    } else if (team.isBot) {
      statusBadge = '<span class="status-badge status-bot">BOT TỰ ĐỘNG</span>';
    } else if (team.isConnected) {
      statusBadge = '<span class="status-badge status-ready">ONLINE</span>';
    } else {
      statusBadge = '<span class="status-badge status-offline">CHỜ VÀO</span>';
    }

    let readyStatus = '';
    if (state.phase === 'LOBBY') {
      readyStatus = team.isReady ? '✓ Sẵn sàng' : 'Chưa sẵn sàng';
    } else if (state.phase === 'PLACEMENT') {
      readyStatus = team.isFleetLocked ? '🔒 Đã bố trí' : '⏳ Đang dàn trận';
    } else {
      readyStatus = `❤️ Còn ${team.shipsRemaining} tàu`;
    }

    const radarRemaining = team.radarScansRemaining ?? 2;
    const crossRemaining = team.crossfireRemaining ?? 1;

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.3rem;">${team.icon}</span>
          <div>
            <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.95rem;">${team.name}</div>
            <div style="font-size: 0.75rem; color: #64748b;">Hải phận: ${team.zone ? team.zone.name : '--'}</div>
          </div>
        </div>
        <div>${statusBadge}</div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 0.8rem;">
        <span style="color: #475569;">${team.isBot ? team.botName : (team.playerName || 'Trống')}</span>
        <span style="font-weight: 700; color: #0284c7;">${readyStatus}</span>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 6px; font-size: 0.72rem; color: #64748b; border-top: 1px dashed #e2e8f0; padding-top: 4px;">
        <span>📡 Radar: <b>${radarRemaining}/2</b></span>
        <span>•</span>
        <span>🚀 Chữ thập: <b>${crossRemaining}/1</b></span>
        <span>•</span>
        <span>⭐ Điểm: <b>${team.score || 0}</b></span>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderOceanMap(state) {
  document.querySelectorAll('.ocean-cell').forEach(cell => {
    cell.className = 'ocean-cell';
    cell.innerHTML = '';
  });

  // Tô màu hải phận
  if (state.teams) {
    state.teams.forEach(team => {
      if (team.zone && team.zone.cells) {
        team.zone.cells.forEach(key => {
          const cell = document.getElementById(`cell-${key}`);
          if (cell) {
            cell.style.background = `${team.colorHex}0c`;
          }
        });
      }
    });
  }

  // Hiển thị vị trí tàu ẩn nếu MC bật
  if (showSecretShips && state.teams) {
    state.teams.forEach(team => {
      if (team.fleet) {
        team.fleet.forEach(ship => {
          ship.cells.forEach(key => {
            const cell = document.getElementById(`cell-${key}`);
            if (cell && !cell.classList.contains('shot-hit') && !cell.classList.contains('shot-sunk')) {
              cell.classList.add('has-ship');
              cell.style.borderColor = team.colorHex;
            }
          });
        });
      }
    });
  }

  // Hiển thị lịch sử các phát bắn
  if (state.shotsMap) {
    for (const key in state.shotsMap) {
      const shot = state.shotsMap[key];
      const cell = document.getElementById(`cell-${key}`);
      if (!cell) continue;

      cell.classList.remove('has-ship');

      if (shot.result === 'MISS') {
        cell.classList.add('shot-miss');
      } else if (shot.result === 'HIT') {
        cell.classList.add('shot-hit');
      } else if (shot.result === 'SUNK') {
        cell.classList.add('shot-sunk');
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
  }, 700);
}

function addLogItem(text, type = 'normal') {
  const container = document.getElementById('combatLogContainer');
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
  // Thêm 1 bot
  document.getElementById('btnAddBot').addEventListener('click', () => {
    dispatchHostAction('host:add_bot');
  });

  // Lấp đầy bằng bot
  document.getElementById('btnFillBots').addEventListener('click', () => {
    dispatchHostAction('host:fill_bots');
  });

  // Bắt đầu dàn trận
  document.getElementById('btnStartPlacement').addEventListener('click', () => {
    dispatchHostAction('host:start_placement');
  });

  // Bắt đầu chiến đấu
  document.getElementById('btnStartBattle').addEventListener('click', () => {
    dispatchHostAction('host:start_battle');
  });

  // Chuyển lượt thủ công
  document.getElementById('btnManualTurn').addEventListener('click', () => {
    if (!currentHostState) return;
    const living = currentHostState.teams.filter(t => !t.isEliminated);
    if (living.length > 0) {
      const currentIdx = living.findIndex(t => t.id === currentHostState.currentTurnTeamId);
      const nextTeam = living[(currentIdx + 1) % living.length];
      dispatchHostAction('host:manual_turn', { targetTeamId: nextTeam.id });
    }
  });

  // Hoàn tác
  document.getElementById('btnUndo').addEventListener('click', () => {
    dispatchHostAction('host:undo');
  });

  // Đặt lại
  document.getElementById('btnResetGame').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn đặt lại ván đấu mới không?')) {
      dispatchHostAction('host:reset');
    }
  });

  // MC Nhập Tọa Độ Nhanh
  const inputHostCoord = document.getElementById('inputHostCoord');
  const btnHostFireCoord = document.getElementById('btnHostFireCoord');
  const btnHostRadarCoord = document.getElementById('btnHostRadarCoord');
  const btnHostCrossfireCoord = document.getElementById('btnHostCrossfireCoord');

  if (btnHostFireCoord) {
    btnHostFireCoord.addEventListener('click', () => {
      const val = inputHostCoord.value.trim().toUpperCase();
      if (!val) { alert('Vui lòng nhập tọa độ! (VD: B14)'); return; }
      if (!currentHostState || currentHostState.phase !== 'BATTLE') return;
      processLocalShot(currentHostState.currentTurnTeamId, val);
      inputHostCoord.value = '';
    });
  }

  if (btnHostRadarCoord) {
    btnHostRadarCoord.addEventListener('click', () => {
      const val = inputHostCoord.value.trim().toUpperCase();
      if (!val) { alert('Vui lòng nhập tọa độ tâm quét! (VD: B14)'); return; }
      if (!currentHostState || currentHostState.phase !== 'BATTLE') return;
      processLocalRadar(currentHostState.currentTurnTeamId, val);
      inputHostCoord.value = '';
    });
  }

  if (btnHostCrossfireCoord) {
    btnHostCrossfireCoord.addEventListener('click', () => {
      const val = inputHostCoord.value.trim().toUpperCase();
      if (!val) { alert('Vui lòng nhập tọa độ tâm bắn chữ thập! (VD: B14)'); return; }
      if (!currentHostState || currentHostState.phase !== 'BATTLE') return;
      processLocalCrossfire(currentHostState.currentTurnTeamId, val);
      inputHostCoord.value = '';
    });
  }

  // Xem vị trí tàu ẩn toggle
  document.getElementById('chkShowSecretShips').addEventListener('change', (e) => {
    showSecretShips = e.target.checked;
    if (currentHostState) renderOceanMap(currentHostState);
  });

  // Bật/Tắt âm thanh
  document.getElementById('btnSoundToggle').addEventListener('click', () => {
    const isEnabled = soundManager.isEnabled();
    soundManager.setEnabled(!isEnabled);
    document.getElementById('btnSoundToggle').textContent = !isEnabled ? '🔊 Âm Thanh' : '🔇 Đã Tắt Âm';
  });

  // Modal QR
  document.getElementById('btnOpenQR').addEventListener('click', openQRModal);
  document.getElementById('qrMiniThumb').addEventListener('click', openQRModal);
  document.getElementById('btnCloseQR').addEventListener('click', closeQRModal);
  document.getElementById('modalQR').addEventListener('click', (e) => {
    if (e.target.id === 'modalQR') closeQRModal();
  });

  document.getElementById('btnCopyUrl').addEventListener('click', () => {
    const input = document.getElementById('qrCopyUrlInput');
    input.select();
    navigator.clipboard.writeText(input.value);
    alert('Đã sao chép đường link tham gia!');
  });

  // Modal Cấu hình
  document.getElementById('btnOpenConfig').addEventListener('click', openConfigModal);
  document.getElementById('btnCloseConfig').addEventListener('click', closeConfigModal);
  document.getElementById('modalConfig').addEventListener('click', (e) => {
    if (e.target.id === 'modalConfig') closeConfigModal();
  });

  document.querySelectorAll('#teamSelectGrid .config-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#teamSelectGrid .config-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tempPlayerCount = parseInt(btn.dataset.count);
      const desc = document.getElementById('configZoneDesc');
      if (tempPlayerCount === 2) desc.textContent = '2 Hải phận riêng biệt (10x20 ô = 200 ô mỗi vùng)';
      else if (tempPlayerCount === 4) desc.textContent = '4 Hải phận góc chiến trường (10x10 ô = 100 ô)';
      else if (tempPlayerCount === 6) desc.textContent = '6 Hải phận tiêu chuẩn chiến hạm (~7 cột x 10 hàng = 70 ô)';
      else if (tempPlayerCount === 8) desc.textContent = '8 Hải phận chiến hạm (5 cột x 10 hàng = 50 ô)';
    });
  });

  document.querySelectorAll('#shipsSelectGrid .config-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#shipsSelectGrid .config-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tempShipsPerPlayer = parseInt(btn.dataset.ships);
    });
  });

  document.getElementById('btnSaveConfig').addEventListener('click', () => {
    dispatchHostAction('host:update_config', {
      playerCount: tempPlayerCount,
      shipsPerPlayer: tempShipsPerPlayer,
    });
    closeConfigModal();
  });

  // Modal Firebase
  document.getElementById('btnOpenFirebaseModal').addEventListener('click', openFirebaseModal);
  document.getElementById('btnCloseFirebase').addEventListener('click', closeFirebaseModal);
  document.getElementById('modalFirebase').addEventListener('click', (e) => {
    if (e.target.id === 'modalFirebase') closeFirebaseModal();
  });

  document.getElementById('btnSaveFirebase').addEventListener('click', () => {
    const dbUrl = document.getElementById('inputFirebaseDbUrl').value.trim();
    const apiKey = document.getElementById('inputFirebaseApiKey').value.trim();
    const projectId = document.getElementById('inputFirebaseProjectId').value.trim();

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

async function loadNetworkAndQR() {
  let joinUrl = `${window.location.origin}${window.location.pathname.replace('host.html', 'join.html')}?room=${currentRoomId || 'PHONG-01'}`;

  try {
    const res = await fetch(`/api/network-info?room=${currentRoomId || ''}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.joinUrl) {
        joinUrl = data.joinUrl;
      }
    }
  } catch (err) {}

  const miniUrlEl = document.getElementById('qrMiniUrl');
  const copyInputEl = document.getElementById('qrCopyUrlInput');
  if (miniUrlEl) miniUrlEl.textContent = joinUrl;
  if (copyInputEl) copyInputEl.value = joinUrl;

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(joinUrl)}`;
  const thumbEl = document.getElementById('qrMiniThumb');
  const bigEl = document.getElementById('qrBigImage');
  if (thumbEl) thumbEl.src = qrImageUrl;
  if (bigEl) bigEl.src = qrImageUrl;
}

function openQRModal() {
  document.getElementById('modalQR').classList.add('active');
}

function closeQRModal() {
  document.getElementById('modalQR').classList.remove('active');
}

function openConfigModal() {
  if (currentHostState && currentHostState.phase !== 'LOBBY') {
    alert('Chỉ có thể điều chỉnh cấu hình khi đang ở Sảnh Chờ!');
    return;
  }
  document.getElementById('modalConfig').classList.add('active');
}

function closeConfigModal() {
  document.getElementById('modalConfig').classList.remove('active');
}
