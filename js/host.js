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
      emptyTeam.isConnected = true;
      emptyTeam.isReady = true;
      emptyTeam.botName = `Bot Hạm Đội ${emptyTeam.id}`;
      emptyTeam.name = emptyTeam.botName;
      if (currentHostState.phase === 'PLACEMENT') {
        emptyTeam.fleet = window.GameEngine.generateRandomFleetInZone(emptyTeam.zone, currentHostState.config.shipLengths);
        emptyTeam.isFleetLocked = true;
      }
      addLogItem(`🤖 Đã thêm Bot vào vị trí [${emptyTeam.name}]`, 'hit');
      commitLocalState();
    }
  } else if (actionType === 'host:fill_bots') {
    currentHostState.teams.forEach(t => {
      if (!t.isConnected && !t.isBot) {
        t.isBot = true;
        t.isConnected = true;
        t.isReady = true;
        t.botName = `Bot Hạm Đội ${t.id}`;
        t.name = t.botName;
        if (currentHostState.phase === 'PLACEMENT') {
          t.fleet = window.GameEngine.generateRandomFleetInZone(t.zone, currentHostState.config.shipLengths);
          t.isFleetLocked = true;
        }
      }
    });
    addLogItem('🤖 Đã lấp đầy tất cả các ô trống bằng Bot!', 'hit');
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
    soundManager.startBgm();
    const btnBgm = document.getElementById('btnBgmToggle');
    if (btnBgm) {
      btnBgm.textContent = '🔊 Nhạc Bật';
      btnBgm.style.background = '#0284c7';
      btnBgm.style.color = '#ffffff';
    }
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
      shipConfigMode: payload.shipConfigMode || 'custom',
      customShipCounts: payload.customShipCounts,
      customShipLengths: payload.customShipLengths,
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
  const targetTeamId = action.teamId !== undefined && action.teamId !== null ? parseInt(action.teamId, 10) : null;
  action.teamId = targetTeamId;

  if (socket && socket.connected) {
    if (action.type === 'FIRE') {
      socket.emit('player:fire', { roomId: currentRoomId, teamId: targetTeamId, targetKey: action.targetKey });
    } else if (action.type === 'CROSSFIRE') {
      socket.emit('player:crossfire', { roomId: currentRoomId, teamId: targetTeamId, centerKey: action.centerKey });
    } else if (action.type === 'JOIN') {
      socket.emit('player:join', { roomId: currentRoomId, teamId: targetTeamId, playerName: action.playerName, deviceToken: action.deviceToken });
    } else if (action.type === 'READY') {
      socket.emit('player:ready', { roomId: currentRoomId, teamId: targetTeamId, isReady: action.isReady });
    } else if (action.type === 'AUTO_PLACE') {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: targetTeamId });
    } else if (action.type === 'LOCK_FLEET') {
      socket.emit('player:lock_fleet', { roomId: currentRoomId, teamId: targetTeamId, fleet: action.fleet, isFleetLocked: action.isFleetLocked, isReady: action.isReady });
    } else if (action.type === 'LEAVE') {
      socket.emit('player:leave', { roomId: currentRoomId, teamId: targetTeamId, deviceToken: action.deviceToken });
    }
    return;
  }

  // Chế độ Standalone trình duyệt
  if (!currentHostState || !window.GameEngine) return;

  if (action.type === 'FIRE') {
    processLocalShot(targetTeamId, action.targetKey);
  } else if (action.type === 'CROSSFIRE') {
    processLocalCrossfire(targetTeamId, action.centerKey);
  } else if (action.type === 'LEAVE') {
    let team = null;
    if (action.deviceToken) {
      team = currentHostState.teams.find(t => t.deviceToken === action.deviceToken);
    }
    if (!team && targetTeamId) {
      team = currentHostState.teams.find(t => parseInt(t.id, 10) === targetTeamId);
    }
    if (team) {
      const oldName = team.name;
      team.isConnected = false;
      team.deviceToken = null;
      team.isReady = false;
      team.customName = '';
      const defaultMeta = window.GameEngine && window.GameEngine.DEFAULT_TEAMS ? window.GameEngine.DEFAULT_TEAMS[team.id - 1] : null;
      team.name = defaultMeta ? defaultMeta.name : `Chiến Hạm #${team.id}`;
      addLogItem(`👋 Chiến hạm <b>${oldName}</b> đã rời [Vị Trí #${team.id}]. Ô này hiện đang trống!`, 'miss');
      commitLocalState();
    }
  } else if (action.type === 'JOIN' || action.type === 'RECONNECT') {
    let team = null;
    // 1. Kiểm tra xem thiết bị này đã từng nhận slot nào chưa
    if (action.deviceToken) {
      team = currentHostState.teams.find(t => t.deviceToken === action.deviceToken);
    }
    // 2. Nếu chưa, hoặc đang re-join vào đúng targetTeamId
    if (targetTeamId) {
      const candidate = currentHostState.teams.find(t => parseInt(t.id, 10) === targetTeamId);
      if (candidate && (!candidate.deviceToken || candidate.deviceToken === action.deviceToken || action.isRejoin || !candidate.isConnected)) {
        team = candidate;
      }
    }
    // 3. Nếu vẫn chưa, tự động lấy ô trống đầu tiên (chưa kết nối và không phải bot)
    if (!team && !action.isRejoin) {
      team = currentHostState.teams.find(t => !t.isConnected && !t.isBot);
    }

    if (team) {
      team.isConnected = true;
      team.deviceToken = action.deviceToken || team.deviceToken || null;
      if (action.playerName && action.playerName.trim()) {
        team.customName = action.playerName.trim().substring(0, 20);
        team.name = team.customName;
      } else if (!team.name || team.name.startsWith('Ô Trống')) {
        team.customName = `Chiến Hạm #${team.id}`;
        team.name = team.customName;
      }
      team.isBot = false;
      if (currentHostState.phase === 'LOBBY') {
        team.isReady = true;
      }
      soundManager.playSonar();
      addLogItem(`🚢 Chiến hạm <b>${team.name}</b> đã vào [Vị Trí #${team.id}] sẵn sàng!`, 'hit');
      commitLocalState();
    } else {
      addLogItem(`⚠️ Người chơi [${action.playerName || 'Ẩn danh'}] không thể tham gia: Phòng đã đủ ${currentHostState.teams.length} đội!`, 'miss');
    }
  } else if (action.type === 'READY') {
    let team = null;
    if (action.deviceToken) {
      team = currentHostState.teams.find(t => t.deviceToken === action.deviceToken);
    }
    if (!team && targetTeamId) {
      team = currentHostState.teams.find(t => parseInt(t.id, 10) === targetTeamId);
    }
    if (team) {
      if (action.isReady !== undefined) {
        team.isReady = !!action.isReady;
      } else {
        team.isReady = !team.isReady;
      }
      if (currentHostState.phase === 'PLACEMENT') {
        team.isFleetLocked = team.isReady;
      }
      addLogItem(`⚓ [${team.name}] ${team.isReady ? 'đã SẴN SÀNG!' : 'hủy sẵn sàng'}`, team.isReady ? 'hit' : 'miss');
      commitLocalState();
    }
  } else if (action.type === 'AUTO_PLACE') {
    let team = null;
    if (action.deviceToken) {
      team = currentHostState.teams.find(t => t.deviceToken === action.deviceToken);
    }
    if (!team && targetTeamId) {
      team = currentHostState.teams.find(t => parseInt(t.id, 10) === targetTeamId);
    }
    if (team && currentHostState.phase === 'PLACEMENT') {
      if (action.fleet && Array.isArray(action.fleet) && action.fleet.length > 0) {
        team.fleet = action.fleet;
      } else {
        const enemyCells = new Set();
        currentHostState.teams.forEach(other => {
          if (other.id !== team.id && other.fleet) {
            other.fleet.forEach(s => s.cells && s.cells.forEach(k => enemyCells.add(k)));
          }
        });
        team.fleet = window.GameEngine.generateRandomFleetOpenOcean(currentHostState.config.shipLengths, enemyCells);
      }
      team.isFleetLocked = false;
      team.isReady = true;
      addLogItem(`⚓ [${team.name}] đã bố trí đội hình chiến hạm!`, 'hit');
      commitLocalState();
    }
  } else if (action.type === 'UPDATE_FLEET') {
    let team = null;
    if (action.deviceToken) {
      team = currentHostState.teams.find(t => t.deviceToken === action.deviceToken);
    }
    if (!team && targetTeamId) {
      team = currentHostState.teams.find(t => parseInt(t.id, 10) === targetTeamId);
    }
    if (team && currentHostState.phase === 'PLACEMENT') {
      if (action.fleet && Array.isArray(action.fleet) && action.fleet.length > 0) {
        team.fleet = action.fleet;
        commitLocalState();
      }
    }
  } else if (action.type === 'LOCK_FLEET') {
    let team = null;
    if (targetTeamId) {
      team = currentHostState.teams.find(t => parseInt(t.id, 10) === targetTeamId);
    }
    if (!team && action.deviceToken) {
      team = currentHostState.teams.find(t => t.deviceToken === action.deviceToken);
    }
    if (team) {
      team.isConnected = true;
      if (action.deviceToken) team.deviceToken = action.deviceToken;

      const isLocked = action.isFleetLocked !== undefined ? !!action.isFleetLocked : true;
      const isReady = action.isReady !== undefined ? !!action.isReady : isLocked;

      if (isLocked) {
        const enemyCells = new Set();
        currentHostState.teams.forEach(other => {
          if (other.id !== team.id && other.isFleetLocked && other.fleet && other.fleet.length > 0) {
            other.fleet.forEach(s => s.cells && s.cells.forEach(k => enemyCells.add(k)));
          }
        });

        if (action.fleet && Array.isArray(action.fleet) && action.fleet.length > 0) {
          const validation = window.GameEngine.validateCustomFleet(action.fleet, currentHostState.config.shipLengths, enemyCells);
          if (validation.valid) {
            team.fleet = action.fleet;
          } else {
            team.fleet = window.GameEngine.generateRandomFleetOpenOcean(currentHostState.config.shipLengths, enemyCells);
          }
        } else if (!team.fleet || team.fleet.length === 0) {
          team.fleet = window.GameEngine.generateRandomFleetOpenOcean(currentHostState.config.shipLengths, enemyCells);
        }
        team.isFleetLocked = true;
        team.isReady = true;
        addLogItem(`🔒 Chiến hạm <b>${team.name}</b> [Đội ${team.id}] ĐÃ KHÓA ĐỘI HÌNH & SẴN SÀNG!`, 'hit');
        soundManager.playSonar();
      } else {
        team.isFleetLocked = false;
        team.isReady = false;
        addLogItem(`🔓 [${team.name}] đã mở khóa để xếp lại đội hình!`, 'miss');
      }
      commitLocalState();
    }
  }
}

function processLocalShot(shooterTeamId, targetKey) {
  if (currentHostState.phase !== 'BATTLE' || currentHostState.phase === 'GAME_OVER') return;
  const numShooterId = parseInt(shooterTeamId, 10);
  const shooterTeam = currentHostState.teams.find(t => parseInt(t.id, 10) === numShooterId);
  if (!shooterTeam || shooterTeam.isEliminated) return;
  if (parseInt(currentHostState.currentTurnTeamId, 10) !== shooterTeam.id) return;

  const result = window.GameEngine.processShot(currentHostState, shooterTeam.id, targetKey);
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
  const numShooterId = parseInt(shooterTeamId, 10);
  const shooterTeam = currentHostState.teams.find(t => parseInt(t.id, 10) === numShooterId);
  if (!shooterTeam || shooterTeam.isEliminated) return;
  if (parseInt(currentHostState.currentTurnTeamId, 10) !== shooterTeam.id) return;

  const res = window.GameEngine.processCrossfire(currentHostState, shooterTeam.id, centerKey);
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

    // Nếu đội hiện tại đã bị tiêu diệt sạch tàu -> Chuyển ngay lập tức sang đội kế tiếp không cần chờ 60s
    const currentTeam = currentHostState.teams.find(t => t.id === currentHostState.currentTurnTeamId);
    if (currentTeam && (currentTeam.isEliminated || currentTeam.shipsRemaining === 0)) {
      if (window.GameEngine) {
        window.GameEngine.advanceTurn(currentHostState);
        commitLocalState();
        checkBotTurn();
      }
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
  renderQRModalTeamsTable(state);
  renderOceanMap(state);
  updateStats(state);
  fitOceanGridToScreen();
}

function renderQRModalTeamsTable(state) {
  const container = document.getElementById('qrModalTeamsTable');
  if (!container || !state || !state.teams) return;

  const connectedCountEl = document.getElementById('qrModalConnectedCount');
  const totalSlotsEl = document.getElementById('qrModalTotalSlots');
  const readyTeams = state.teams.filter(t => (t.isConnected || t.isBot) && t.isReady);
  const totalTeams = state.teams.length;

  if (connectedCountEl) connectedCountEl.textContent = readyTeams.length;
  if (totalSlotsEl) totalSlotsEl.textContent = totalTeams;

  container.innerHTML = '';
  state.teams.forEach(t => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.padding = '6px 10px';
    row.style.borderRadius = '6px';
    row.style.border = '1px solid #cbd5e1';
    row.style.background = '#ffffff';

    let badgeHtml = '';
    if (t.isBot) {
      badgeHtml = '<span style="background: #e2e8f0; color: #475569; font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">🤖 BOT AI</span>';
    } else if (t.isConnected) {
      if (state.phase === 'PLACEMENT') {
        if (t.isFleetLocked) {
          badgeHtml = '<span style="background: #dcfce7; color: #15803d; font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #86efac;">🟢 ĐÃ SẴN SÀNG</span>';
        } else {
          badgeHtml = '<span style="background: #fef3c7; color: #b45309; font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #fde68a;">⏳ ĐANG XẾP TÀU</span>';
        }
      } else if (t.isReady) {
        badgeHtml = '<span style="background: #dcfce7; color: #15803d; font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #86efac;">🟢 ĐÃ SẴN SÀNG</span>';
      } else {
        badgeHtml = '<span style="background: #fef3c7; color: #b45309; font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #fde68a;">🟡 ĐANG CHỌN TÊN</span>';
      }
    } else {
      badgeHtml = '<span style="background: #f1f5f9; color: #94a3b8; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px;">⚪ Ô TRỐNG</span>';
    }

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 1.1rem;">${t.icon || '⚓'}</span>
        <div>
          <div style="font-weight: 800; font-size: 0.82rem; color: ${t.colorHex || '#0f172a'}; line-height: 1.2;">
            Vị Trí #${t.id}: ${t.name || ('Chiến Hạm #' + t.id)}
          </div>
          <div style="font-size: 0.68rem; color: #64748b;">
            ${t.isConnected ? (t.deviceToken ? '📱 Thiết bị đã kết nối' : 'Đã vào slot') : 'Chưa có người chơi'}
          </div>
        </div>
      </div>
      <div>${badgeHtml}</div>
    `;

    container.appendChild(row);
  });
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
  const connectedCount = state.teams ? state.teams.filter(t => t.isConnected || t.isBot).length : 0;
  const readyCount = state.teams ? state.teams.filter(t => (t.isConnected || t.isBot) && t.isReady).length : 0;
  const lockedCount = state.teams ? state.teams.filter(t => t.isFleetLocked).length : 0;
  const pLabel = document.getElementById('playerCountLabel');
  if (pLabel) pLabel.textContent = `${totalCount} Đội`;

  if (state.phase === 'LOBBY') {
    phaseBadge.textContent = 'SẢNH CHỜ';
    phaseBadge.style.background = '#e0f2fe';
    phaseBadge.style.color = '#0284c7';

    statusProgressText.textContent = `${connectedCount}/${totalCount} Đội Đã Vào (${readyCount} Sẵn Sàng)`;
    statusTurnText.textContent = connectedCount === 0 ? 'Đang chờ người chơi quét mã QR để nhận ô trống' : `Đã có ${connectedCount}/${totalCount} chiến hạm sẵn sàng`;

    btnStartPlacement.style.display = 'inline-flex';
    btnStartBattle.style.display = 'none';
    btnManualTurn.style.display = 'none';
    btnUndo.style.display = 'none';
    if (quickFireBar) quickFireBar.style.display = 'none';
  } else if (state.phase === 'PLACEMENT') {
    phaseBadge.textContent = 'DÀN TRẬN';
    phaseBadge.style.background = '#fef3c7';
    phaseBadge.style.color = '#d97706';

    const activeCount = Math.max(1, connectedCount);
    const allReady = lockedCount >= activeCount && activeCount > 0;

    if (allReady) {
      statusProgressText.innerHTML = `<span style="color: #16a34a; font-weight: 900;">🟢 ${lockedCount}/${totalCount} ĐỘI ĐÃ SẴN SÀNG!</span>`;
      statusTurnText.innerHTML = `🎉 <b style="color: #15803d; font-size: 0.95rem;">TẤT CẢ ${lockedCount} ĐỘI ĐÃ KHÓA TÀU! MC BẤM BẮT ĐẦU ĐỂ VÀO GAME!</b>`;
      btnStartBattle.innerHTML = `⚔️ TẤT CẢ ĐÃ SẴN SÀNG: BẮT ĐẦU CHIẾN ĐẤU NGAY!`;
      btnStartBattle.className = 'btn btn-success';
      btnStartBattle.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btnStartBattle.style.boxShadow = '0 0 16px rgba(16, 185, 129, 0.8)';
      btnStartBattle.style.animation = 'pulse 1.2s infinite';
    } else {
      statusProgressText.innerHTML = `<span>⏳ <b>${lockedCount}/${activeCount} Đội Đã Khóa Tàu</b></span>`;
      statusTurnText.innerHTML = `Đang chờ các đội hoàn tất dàn trận... (${activeCount - lockedCount} đội đang xếp tàu)`;
      btnStartBattle.innerHTML = `⚔️ BƯỚC 2: BẮT ĐẦU CHIẾN ĐẤU (${lockedCount}/${activeCount} Sẵn Sàng)`;
      btnStartBattle.className = 'btn btn-primary';
      btnStartBattle.style.background = '';
      btnStartBattle.style.boxShadow = '';
      btnStartBattle.style.animation = '';
    }

    btnStartPlacement.style.display = 'none';
    btnStartBattle.style.display = 'inline-flex';
    btnManualTurn.style.display = 'none';
    btnUndo.style.display = 'none';
    if (quickFireBar) quickFireBar.style.display = 'none';
  } else if (state.phase === 'BATTLE') {
    btnStartBattle.style.animation = '';
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
    btnStartBattle.style.animation = '';
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
    const isEmptySlot = state.phase === 'LOBBY' && !team.isConnected && !team.isBot;

    if (isEmptySlot) {
      card.className = 'team-roster-card empty-slot';
      card.style.border = '2px dashed #94a3b8';
      card.style.background = '#f8fafc';
      card.style.opacity = '0.9';
      card.style.padding = '8px 10px';
      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.25rem; opacity: 0.4;">⚪</span>
          <div>
            <div style="font-weight: 800; color: #64748b; font-size: 0.85rem; line-height: 1.2;">
              [ Ô Trống #${team.id} ]
            </div>
            <div style="font-size: 0.72rem; color: #94a3b8;">
              Chờ quét QR & đặt tên...
            </div>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-weight: 600; color: #64748b; font-size: 0.72rem; background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">
            Đang trống
          </span>
        </div>
      `;
      container.appendChild(card);
      return;
    }

    card.className = `team-roster-card ${isCurrentTurn ? 'active-turn' : ''} ${team.isEliminated ? 'eliminated' : ''}`;
    if (isCurrentTurn) {
      card.style.borderColor = team.colorHex;
      card.style.background = `${team.colorHex}15`;
      card.style.boxShadow = `0 0 12px ${team.colorHex}66`;
    } else {
      card.style.borderColor = team.colorHex;
      card.style.borderWidth = '2px';
      card.style.borderStyle = 'solid';
    }

    let statusText = '';
    if (team.isEliminated) {
      statusText = '<span style="color: #dc2626; font-weight: 800; font-size: 0.8rem;">☠️ ĐÃ CHÌM</span>';
    } else if (state.phase === 'LOBBY') {
      if (team.isReady) {
        statusText = `<span style="font-weight: 800; color: #15803d; background: #dcfce7; padding: 2px 8px; border-radius: 4px; border: 1.5px solid #86efac; font-size: 0.76rem;">🟢 ĐÃ SẴN SÀNG</span>`;
        card.style.borderColor = '#10b981';
        card.style.background = '#f0fdf4';
      } else {
        statusText = `<span style="font-weight: 700; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 4px; border: 1px solid #fde68a; font-size: 0.75rem;">🟡 Đang Chọn Tên</span>`;
      }
    } else if (state.phase === 'PLACEMENT') {
      if (team.isFleetLocked) {
        statusText = `<span style="font-weight: 800; color: #15803d; background: #dcfce7; padding: 2px 8px; border-radius: 4px; border: 1.5px solid #86efac; font-size: 0.76rem;">🟢 ĐÃ SẴN SÀNG</span>`;
        card.style.borderColor = '#10b981';
        card.style.background = '#f0fdf4';
        card.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.35)';
      } else {
        statusText = `<span style="font-weight: 800; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 4px; border: 1px solid #fde68a; font-size: 0.75rem;">⏳ Đang Xếp...</span>`;
      }
    } else {
      statusText = `<span style="font-weight: 800; color: #15803d; font-size: 0.82rem;">❤️ ${team.shipsRemaining} tàu</span>`;
    }

    const crossRemaining = team.crossfireRemaining ?? 1;

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 1.25rem;">${team.icon}</span>
        <div>
          <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.85rem; line-height: 1.2;" title="${state.phase === 'LOBBY' ? 'Bấm đúp để đổi tên chiến hạm' : ''}">
            ${team.name} ${team.isBot ? '<span style="font-size: 0.65rem; color: #64748b; font-weight: normal;">(🤖 AI)</span>' : ''}
          </div>
        </div>
      </div>
      <div style="text-align: right;">
        <div>${statusText}</div>
        <div style="font-size: 0.65rem; color: #ea580c; margin-top: 1px; font-weight: bold;">
          🚀 Chữ Thập: ${crossRemaining}/1
        </div>
      </div>
    `;

    if (state.phase === 'LOBBY') {
      card.style.cursor = 'pointer';
      card.addEventListener('dblclick', () => {
        const newName = prompt(`Nhập tên chiến hạm mới cho Đội ${team.id}:`, team.name);
        if (newName && newName.trim()) {
          team.customName = newName.trim().substring(0, 20);
          team.name = team.customName;
          commitLocalState();
        }
      });
    }

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
              if (partClass) partClass.split(' ').filter(Boolean).forEach(cls => cell.classList.add(cls));
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
  on('btnQRAddBot', () => {
    dispatchHostAction('host:add_bot');
  });

  // Lấp đầy bằng bot
  on('btnFillBots', () => {
    dispatchHostAction('host:fill_bots');
  });
  on('btnQRFillBots', () => {
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

  // Bật/Tắt hiệu ứng âm thanh SFX
  on('btnSoundToggle', () => {
    const isEnabled = soundManager.isEnabled();
    soundManager.setEnabled(!isEnabled);
    const btn = document.getElementById('btnSoundToggle');
    if (btn) btn.textContent = !isEnabled ? '🔊 SFX' : '🔇 Tắt';
  });

  // Bật/Tắt Nhạc Nền Hào Hùng BGM
  on('btnBgmToggle', () => {
    const isPlaying = soundManager.toggleBgm();
    const btn = document.getElementById('btnBgmToggle');
    if (btn) {
      btn.textContent = isPlaying ? '🔊 Nhạc Bật' : '🎵 Nhạc Nền';
      btn.style.background = isPlaying ? '#0284c7' : '';
      btn.style.color = isPlaying ? '#ffffff' : '#0284c7';
    }
  });

  const sliderBgm = document.getElementById('sliderBgmVolume');
  if (sliderBgm) {
    sliderBgm.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10) / 100;
      soundManager.setBgmVolume(vol);
    });
  }

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

  // Steppers cấu hình tàu tùy chỉnh
  const bindStepper = (btnId, inputId, delta) => {
    on(btnId, () => {
      const input = document.getElementById(inputId);
      if (!input) return;
      let val = Math.max(0, Math.min(6, (parseInt(input.value, 10) || 0) + delta));
      input.value = val;
      updateCustomShipSummary();
    });
  };
  bindStepper('btnDecSize4', 'cfgCountSize4', -1);
  bindStepper('btnIncSize4', 'cfgCountSize4', 1);
  bindStepper('btnDecSize3', 'cfgCountSize3', -1);
  bindStepper('btnIncSize3', 'cfgCountSize3', 1);
  bindStepper('btnDecSize2', 'cfgCountSize2', -1);
  bindStepper('btnIncSize2', 'cfgCountSize2', 1);

  ['cfgCountSize4', 'cfgCountSize3', 'cfgCountSize2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateCustomShipSummary);
      el.addEventListener('change', updateCustomShipSummary);
    }
  });

  on('btnSaveConfig', () => {
    const c4El = document.getElementById('cfgCountSize4');
    const c3El = document.getElementById('cfgCountSize3');
    const c2El = document.getElementById('cfgCountSize2');
    let c4 = Math.max(0, parseInt(c4El ? c4El.value : 1, 10) || 0);
    let c3 = Math.max(0, parseInt(c3El ? c3El.value : 1, 10) || 0);
    let c2 = Math.max(0, parseInt(c2El ? c2El.value : 0, 10) || 0);

    if (c4 + c3 + c2 === 0) {
      alert('Vui lòng chọn ít nhất 1 chiến hạm!');
      return;
    }

    const shipLengths = [];
    for (let i = 0; i < c4; i++) shipLengths.push(4);
    for (let i = 0; i < c3; i++) shipLengths.push(3);
    for (let i = 0; i < c2; i++) shipLengths.push(2);

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
      shipsPerPlayer: shipLengths.length,
      shipConfigMode: 'custom',
      customShipCounts: { count4: c4, count3: c3, count2: c2 },
      customShipLengths: shipLengths,
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
  if (currentHostState) {
    renderQRModalTeamsTable(currentHostState);
  }
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

function updateCustomShipSummary() {
  const i4 = document.getElementById('cfgCountSize4');
  const i3 = document.getElementById('cfgCountSize3');
  const i2 = document.getElementById('cfgCountSize2');
  const c4 = Math.max(0, parseInt(i4 ? i4.value : 0, 10) || 0);
  const c3 = Math.max(0, parseInt(i3 ? i3.value : 0, 10) || 0);
  const c2 = Math.max(0, parseInt(i2 ? i2.value : 0, 10) || 0);
  const totalShips = c4 + c3 + c2;
  const totalCells = c4 * 4 + c3 * 3 + c2 * 2;

  const badge = document.getElementById('cfgTotalShipsBadge');
  if (badge) badge.textContent = `${totalShips} Tàu (${totalCells} ô)`;

  const summary = document.getElementById('cfgShipSummaryText');
  if (summary) {
    if (totalShips === 0) {
      summary.innerHTML = '<span style="color: #dc2626; font-weight: 800;">⚠️ Vui lòng chọn ít nhất 1 chiến hạm!</span>';
    } else {
      const parts = [];
      if (c4 > 0) parts.push(`${c4} Tàu sân bay (4 ô)`);
      if (c3 > 0) parts.push(`${c3} Tuần dương hạm (3 ô)`);
      if (c2 > 0) parts.push(`${c2} Tàu tuần tra (2 ô)`);
      summary.textContent = `⚓ Mỗi đội có: ${parts.join(' • ')} = Tổng ${totalCells} ô tác chiến`;
    }
  }
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

  const cfg = (currentHostState && currentHostState.config) || {};
  let c4 = 1, c3 = 1, c2 = 0;
  if (cfg.customShipCounts) {
    c4 = cfg.customShipCounts.count4 ?? 1;
    c3 = cfg.customShipCounts.count3 ?? 1;
    c2 = cfg.customShipCounts.count2 ?? 0;
  } else if (cfg.shipLengths && Array.isArray(cfg.shipLengths)) {
    c4 = cfg.shipLengths.filter(l => l === 4).length;
    c3 = cfg.shipLengths.filter(l => l === 3).length;
    c2 = cfg.shipLengths.filter(l => l === 2).length;
  }
  const i4 = document.getElementById('cfgCountSize4');
  const i3 = document.getElementById('cfgCountSize3');
  const i2 = document.getElementById('cfgCountSize2');
  if (i4) i4.value = c4;
  if (i3) i3.value = c3;
  if (i2) i2.value = c2;
  updateCustomShipSummary();

  document.getElementById('modalConfig').classList.add('active');
}

function closeConfigModal() {
  document.getElementById('modalConfig').classList.remove('active');
}
})();
