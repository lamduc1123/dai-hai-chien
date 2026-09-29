// public/js/demo.js - Bộ điều khiển Bản Demo Chơi Thử Solo (1 Người vs 5 Bot AI)

const socket = io();

let currentRoomId = null;
let currentHostToken = null;
let myTeamId = 1; // Mặc định người chơi là Đội 1
let myDeviceToken = 'demo_user_token_' + Math.random().toString(36).substr(2, 6);
let gameState = null;
let screenMapRenderer = null;
let playerPrepRenderer = null;
let playerBattleRenderer = null;
let currentTargetTeamId = null;
let selectedCellKey = null;
let botDelayMs = 1200; // 1.2s mặc định
let wasMyTurn = false;

// DOM Elements - Demo Top Bar
const demoRoomCode = document.getElementById('demoRoomCode');
const demoGlobalTurnText = document.getElementById('demoGlobalTurnText');
const btnDemoQuickStart = document.getElementById('btnDemoQuickStart');
const btnDemoBotSpeed = document.getElementById('btnDemoBotSpeed');
const btnDemoSimulateTop3 = document.getElementById('btnDemoSimulateTop3');
const btnDemoReset = document.getElementById('btnDemoReset');
const btnDemoSound = document.getElementById('btnDemoSound');

// DOM Elements - Screen View
const screenMapContainer = document.getElementById('screenMapContainer');
const shotCinematicOverlay = document.getElementById('shotCinematicOverlay');
const shotCinematicTarget = document.getElementById('shotCinematicTarget');
const shotCinematicCell = document.getElementById('shotCinematicCell');
const shotCinematicResult = document.getElementById('shotCinematicResult');
const victoryOverlay = document.getElementById('victoryOverlay');
const podiumContainer = document.getElementById('podiumContainer');
const rankingsTableBody = document.getElementById('rankingsTableBody');
const btnRestartFromVictory = document.getElementById('btnRestartFromVictory');
const btnCloseVictory = document.getElementById('btnCloseVictory');

// DOM Elements - Phone View
const playerTeamDot = document.getElementById('playerTeamDot');
const playerTeamName = document.getElementById('playerTeamName');
const playerScoreText = document.getElementById('playerScoreText');
const playerHpText = document.getElementById('playerHpText');
const playerMysteryZoneText = document.getElementById('playerMysteryZoneText');
const playerTurnBanner = document.getElementById('playerTurnBanner');
const playerPrepView = document.getElementById('playerPrepView');
const playerPrepCountdown = document.getElementById('playerPrepCountdown');
const playerPrepBoardContainer = document.getElementById('playerPrepBoardContainer');
const btnPlayerRandomFleet = document.getElementById('btnPlayerRandomFleet');
const btnPlayerConfirmFleet = document.getElementById('btnPlayerConfirmFleet');
const playerBattleView = document.getElementById('playerBattleView');
const playerEnemyTabs = document.getElementById('playerEnemyTabs');
const playerTargetAimText = document.getElementById('playerTargetAimText');
const playerEnemyBoardContainer = document.getElementById('playerEnemyBoardContainer');
const playerSelectedChip = document.getElementById('playerSelectedChip');
const playerChipCell = document.getElementById('playerChipCell');
const playerChipTarget = document.getElementById('playerChipTarget');
const btnPlayerFire = document.getElementById('btnPlayerFire');
const btnPhoneStartPrep = document.getElementById('btnPhoneStartPrep');
const playerLobbyActionWrap = document.getElementById('playerLobbyActionWrap');
const btnDemoToggleSecretShips = document.getElementById('btnDemoToggleSecretShips');

// DOM Elements - Manual Fleet Placer (Demo Phone)
const demoPrepShipSelector = document.getElementById('demoPrepShipSelector');
const demoActiveShipIcon = document.getElementById('demoActiveShipIcon');
const demoActiveShipName = document.getElementById('demoActiveShipName');
const demoActiveShipStatus = document.getElementById('demoActiveShipStatus');
const btnDemoRotateShip = document.getElementById('btnDemoRotateShip');
const demoPrepOrientationText = document.getElementById('demoPrepOrientationText');
const btnDemoClearBoard = document.getElementById('btnDemoClearBoard');
const demoPrepHintText = document.getElementById('demoPrepHintText');

let demoManualPlacer = null;
let demoShowSecretShips = false;
let lastHostState = null;

// Toast
const mobileResultToast = document.getElementById('mobileResultToast');
const toastIcon = document.getElementById('toastIcon');
const toastTitle = document.getElementById('toastTitle');
const toastSubtitle = document.getElementById('toastSubtitle');

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Khởi tạo Renderer Màn hình lớn (MultiZoneRenderer: 6 vùng 15x15)
  screenMapRenderer = new MultiZoneRenderer(screenMapContainer, {
    showSecretShips: false,
    onCellClick: (targetTeamId, cellKey) => {
      // Cho phép bấm trực tiếp trên màn hình lớn nếu muốn ngắm bắn đội đó
      if (gameState && gameState.status === 'PLAYING') {
        if (targetTeamId !== myTeamId) {
          if (currentTargetTeamId === targetTeamId && selectedCellKey === cellKey) {
            fireSelectedCell();
            return;
          }
          currentTargetTeamId = targetTeamId;
          onCellSelected(cellKey);
          renderEnemyTabs();
          renderEnemyBoard();
        }
      }
    },
  });

  // 2. Khởi tạo Renderer Dàn trận trên điện thoại (SingleZoneRenderer 15x15)
  playerPrepRenderer = new SingleZoneRenderer(playerPrepBoardContainer, {
    isInteractive: true,
  });

  // 3. Khởi tạo Renderer Ngắm bắn đối thủ trên điện thoại
  playerBattleRenderer = new SingleZoneRenderer(playerEnemyBoardContainer, {
    isInteractive: true,
    onCellClick: (cellKey) => {
      onCellSelected(cellKey);
    },
  });

  // 4. Gắn sự kiện ngay lập tức để nút luôn sẵn sàng
  bindEvents();

  // 5. Khởi tạo phòng chơi thử nghiệm mới (Hỗ trợ nhận tham số ?count=N từ trang chủ)
  const urlParams = new URLSearchParams(window.location.search);
  const countParam = parseInt(urlParams.get('count'));
  if (countParam >= 2 && countParam <= 6) {
    currentDemoPlayerCount = countParam;
  }
  await initDemoRoom(currentDemoPlayerCount);
});

let currentDemoPlayerCount = 6;

// Khởi tạo phòng đấu thử nghiệm riêng cho người dùng
async function initDemoRoom(playerCount = currentDemoPlayerCount) {
  currentDemoPlayerCount = playerCount;
  try {
    const res = await fetch(`/api/create-room?playerCount=${playerCount}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerCount }),
    });
    const data = await res.json();
    if (!data.success) throw new Error('Không thể tạo phòng test');

    currentRoomId = data.roomId;
    currentHostToken = data.hostToken;
    demoRoomCode.textContent = currentRoomId;

    // Cập nhật URL trình duyệt
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', `/demo?count=${currentDemoPlayerCount}`);
    }

    // Cập nhật tiêu đề badge
    const badgeEl = document.querySelector('.demo-badge');
    if (badgeEl) {
      badgeEl.textContent = `CHƠI THỬ SOLO (1 NGƯỜI vs ${currentDemoPlayerCount - 1} BOT)`;
    }

    // Cập nhật nút active
    document.querySelectorAll('#demoPlayerCountGroup .demo-count-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.count) === currentDemoPlayerCount);
    });

    // Đăng ký quyền Host & Màn hình lớn
    socket.emit('host:register', { roomId: currentRoomId, hostToken: currentHostToken });
    socket.emit('screen:register', { roomId: currentRoomId });

    // Đăng ký Đội 1 là Đội của bạn
    socket.emit('player:join', {
      roomId: currentRoomId,
      teamId: myTeamId,
      representative: 'Bạn (Chỉ huy trưởng)',
      customTeamName: 'Hạm Đội Của Bạn',
      deviceToken: myDeviceToken,
    });

    // Tự động điền Bot AI cho các đội còn lại ngay lập tức
    setTimeout(() => {
      socket.emit('host:fill_bots', { roomId: currentRoomId });
      socket.emit('player:ready', { roomId: currentRoomId, teamId: myTeamId, isReady: true });
    }, 250);

    // Đặt lại nút dàn trận trên điện thoại
    demoManualPlacer = null;
    btnPlayerConfirmFleet.disabled = false;
    btnPlayerRandomFleet.disabled = false;
    if (btnDemoClearBoard) btnDemoClearBoard.disabled = false;
    if (btnDemoRotateShip) btnDemoRotateShip.disabled = false;
    btnPlayerConfirmFleet.textContent = '✓ Xác Nhận Đội Hình';

  } catch (err) {
    alert('Lỗi tạo phòng test: ' + err.message);
  }
}

function bindEvents() {
  // 0. Bộ chọn số lượng người chơi Demo (2 đến 6 người)
  document.querySelectorAll('#demoPlayerCountGroup .demo-count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const count = Number(btn.dataset.count);
      if (!count || count === currentDemoPlayerCount) return;
      initDemoRoom(count);
    });
  });

  // 1. Nút Bắt đầu dàn trận (2 phút) / Bỏ qua dàn trận (Bắn ngay)
  btnDemoQuickStart.addEventListener('click', () => {
    if (!currentRoomId || !gameState) return;
    if (gameState.status === 'LOBBY') {
      // Bắt đầu giai đoạn Dàn Trận 2 Phút
      socket.emit('host:start_game', { roomId: currentRoomId });
    } else if (gameState.status === 'PREPARATION') {
      // Đang dàn trận -> MC bấm bỏ qua 2 phút để vào bắn ngay
      socket.emit('host:skip_prep', { roomId: currentRoomId });
    }
  });

  // 1.1. Nút Bắt đầu dàn trận ngay trên màn hình điện thoại
  if (btnPhoneStartPrep) {
    btnPhoneStartPrep.addEventListener('click', () => {
      if (!currentRoomId) return;
      socket.emit('host:start_game', { roomId: currentRoomId });
    });
  }

  // 1.2. Nút Bật/Tắt xem trước vị trí tàu của tất cả các đội (Chế độ MC trên Màn hình lớn)
  if (btnDemoToggleSecretShips) {
    btnDemoToggleSecretShips.addEventListener('click', () => {
      demoShowSecretShips = !demoShowSecretShips;
      screenMapRenderer.options.showSecretShips = demoShowSecretShips;
      btnDemoToggleSecretShips.textContent = demoShowSecretShips ? '🙈 Ẩn Vị Trí Tàu' : '👁️ Xem Vị Trí Tàu (Chế độ MC)';
      btnDemoToggleSecretShips.style.background = demoShowSecretShips ? 'rgba(56, 189, 248, 0.25)' : 'transparent';
      btnDemoToggleSecretShips.style.borderColor = demoShowSecretShips ? '#38bdf8' : '#475569';

      if (lastHostState) {
        screenMapRenderer.updateState(lastHostState);
      } else if (gameState) {
        screenMapRenderer.updateState(gameState);
      }
    });
  }

  // 2. Nút Chuyển đổi tốc độ Bot
  btnDemoBotSpeed.addEventListener('click', () => {
    if (botDelayMs === 1200) {
      botDelayMs = 350;
      btnDemoBotSpeed.textContent = '⚡ SIÊU TỐC: 0.35S';
      btnDemoBotSpeed.className = 'demo-btn demo-btn-amber';
    } else {
      botDelayMs = 1200;
      btnDemoBotSpeed.textContent = '⚡ TỐC ĐỘ: 1.2S';
      btnDemoBotSpeed.className = 'demo-btn demo-btn-blue';
    }
    socket.emit('host:set_bot_speed', { roomId: currentRoomId, delayMs: botDelayMs });
  });

  // 3. Nút Thử nghiệm Bục Vinh Danh Top 3 & Quán Quân
  btnDemoSimulateTop3.addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('host:simulate_top3', { roomId: currentRoomId });
  });

  // 4. Tạo ván mới
  btnDemoReset.addEventListener('click', () => {
    if (confirm(`Tạo một trận đấu thử nghiệm mới tinh với ${currentDemoPlayerCount - 1} Bot AI?`)) {
      initDemoRoom(currentDemoPlayerCount);
    }
  });

  // 5. Bật tắt âm thanh
  btnDemoSound.addEventListener('click', () => {
    const isEn = soundManager.isEnabled();
    soundManager.setEnabled(!isEn);
    btnDemoSound.textContent = !isEn ? '🔊' : '🔇';
  });

  // 6. Đổi đội hình ngẫu nhiên trên điện thoại
  btnPlayerRandomFleet.addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('player:randomize_fleet', { roomId: currentRoomId, teamId: myTeamId });
  });

  // 6.1. Chọn tàu để xếp bằng tay trên điện thoại
  if (demoPrepShipSelector) {
    demoPrepShipSelector.querySelectorAll('.prep-ship-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const shipType = btn.dataset.type;
        if (demoManualPlacer && shipType) {
          demoManualPlacer.selectShip(shipType);
        }
      });
    });
  }

  // 6.2. Nút xoay hướng tàu (Ngang / Dọc)
  if (btnDemoRotateShip) {
    btnDemoRotateShip.addEventListener('click', () => {
      if (demoManualPlacer) {
        demoManualPlacer.toggleOrientation();
      }
    });
  }

  // 6.3. Nút xóa toàn bộ bàn cờ để tự đặt từ đầu
  if (btnDemoClearBoard) {
    btnDemoClearBoard.addEventListener('click', () => {
      if (demoManualPlacer) {
        demoManualPlacer.clearAll();
      }
    });
  }

  // 7. Xác nhận đội hình trên điện thoại
  btnPlayerConfirmFleet.addEventListener('click', () => {
    if (!currentRoomId) return;
    const customFleet = demoManualPlacer ? demoManualPlacer.getFleet() : null;
    socket.emit('player:confirm_fleet', { roomId: currentRoomId, teamId: myTeamId, fleet: customFleet });
    btnPlayerConfirmFleet.disabled = true;
    btnPlayerRandomFleet.disabled = true;
    if (btnDemoClearBoard) btnDemoClearBoard.disabled = true;
    if (btnDemoRotateShip) btnDemoRotateShip.disabled = true;
    btnPlayerConfirmFleet.textContent = '✓ Đã Khóa Đội Hình';

    // Trong Demo Solo: Tự động chuyển ngay vào trận chiến bắn tên lửa sau 0.4s (không cần chờ hết 2 phút)!
    setTimeout(() => {
      if (gameState && gameState.status === 'PREPARATION') {
        socket.emit('host:skip_prep', { roomId: currentRoomId });
      }
    }, 400);
  });

  // 8. Bấm Khai Hỏa trên điện thoại
  btnPlayerFire.addEventListener('click', () => {
    fireSelectedCell();
  });

  // 9. Đóng/Mở Victory Modal
  if (btnCloseVictory) {
    btnCloseVictory.addEventListener('click', () => {
      victoryOverlay.classList.remove('show');
    });
  }

  if (btnRestartFromVictory) {
    btnRestartFromVictory.addEventListener('click', () => {
      victoryOverlay.classList.remove('show');
      initDemoRoom();
    });
  }
}

// Tìm ô ngẫu nhiên chưa bị bắn của đội mục tiêu
function getAutoTargetCell(targetTeamId) {
  const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  const shots = (gameState && gameState.shots) ? gameState.shots : {};
  const unshot = [];
  for (const r of ROWS) {
    for (let c = 1; c <= 15; c++) {
      const k = `${r}${c}`;
      if (!shots[`${targetTeamId}_${k}`]) {
        unshot.push(k);
      }
    }
  }
  return unshot.length > 0 ? unshot[Math.floor(Math.random() * unshot.length)] : 'H8';
}

// Khai hỏa vào ô đang chọn (hoặc tự động chọn ô để bắn ngay nếu người chơi bấm nút)
function fireSelectedCell() {
  if (!currentRoomId) return;

  // Nếu chưa có đối thủ mục tiêu, tự động chọn đối thủ đầu tiên còn sống
  if (!currentTargetTeamId && gameState && gameState.teams) {
    const firstAlive = gameState.teams.find(t => t.id !== myTeamId && !t.isEliminated);
    if (firstAlive) currentTargetTeamId = firstAlive.id;
  }

  // Nếu người chơi chưa chọn ô trên bàn cờ, tự động tìm 1 ô trống hợp lệ và ngắm bắn ngay!
  if (!selectedCellKey) {
    if (currentTargetTeamId) {
      const autoCell = getAutoTargetCell(currentTargetTeamId);
      onCellSelected(autoCell);
    } else {
      return;
    }
  }

  if (!currentTargetTeamId || !selectedCellKey) return;

  // Trong Demo Solo: Nếu còn ở LOBBY hoặc PREPARATION, tự động bắt đầu tác chiến ngay
  if (gameState && (gameState.status === 'LOBBY' || gameState.status === 'PREPARATION')) {
    socket.emit('host:skip_prep', { roomId: currentRoomId });
  }

  // Trong Demo Solo: Nếu đang là lượt Bot, tự động chuyển lượt sang người chơi ngay lập tức để bắn luôn
  if (gameState && gameState.currentTurnTeamId !== myTeamId) {
    socket.emit('host:change_turn', { roomId: currentRoomId, newTeamId: myTeamId });
  }

  soundManager.playMissileLaunch();
  if (navigator.vibrate) navigator.vibrate(50);

  socket.emit('player:fire', {
    roomId: currentRoomId,
    teamId: myTeamId,
    targetTeamId: currentTargetTeamId,
    targetCellKey: selectedCellKey,
  });

  btnPlayerFire.disabled = true;
  btnPlayerFire.textContent = `ĐANG PHÓNG VÀO Ô ${selectedCellKey}... 🚀`;
}

// Khi người chơi chọn 1 ô trên bảng đối thủ
function onCellSelected(cellKey) {
  // Nếu bấm lại vào chính ô đang chọn -> Khai hỏa ngay lập tức! (Chạm 2 lần để bắn)
  if (selectedCellKey === cellKey && currentTargetTeamId) {
    fireSelectedCell();
    return;
  }

  selectedCellKey = cellKey;
  playerChipCell.textContent = cellKey;

  const targetTeam = gameState && gameState.teams ? gameState.teams.find(t => t.id === currentTargetTeamId) : null;
  const targetLabel = targetTeam ? (targetTeam.mysteryZoneName || targetTeam.name) : `Vùng ?`;
  playerChipTarget.textContent = targetLabel;
  playerSelectedChip.style.display = 'flex';

  playerTargetAimText.innerHTML = `🎯 Đang nhắm: <strong style="color: #fbbf24;">${targetLabel}</strong> - Ô <strong style="color: #38bdf8; font-size: 1rem;">${cellKey}</strong> (Chạm lần nữa hoặc bấm nút dưới để BẮN!)`;

  btnPlayerFire.disabled = false;
  btnPlayerFire.textContent = `🚀 BẮN Ô ${cellKey} (${targetLabel})`;

  // ĐỒNG BỘ HIỂN THỊ TÂM NGẮM TRÊN CẢ 2 BẢNG (MÀN HÌNH LỚN BÊN TRÁI + BẢNG ĐIỀU KHIỂN BÊN PHẢI)
  if (screenMapRenderer && currentTargetTeamId) {
    screenMapRenderer.setSelectedCell(currentTargetTeamId, cellKey);
  }
  if (playerBattleRenderer) {
    playerBattleRenderer.setSelectedCell(cellKey);
  }
}

// Cập nhật các tab đối thủ trên điện thoại
function renderEnemyTabs() {
  if (!gameState || !gameState.teams) return;
  playerEnemyTabs.innerHTML = '';

  const enemies = gameState.teams.filter(t => t.id !== myTeamId);

  // Nếu chưa chọn mục tiêu hoặc mục tiêu đã bị loại, tự động chọn đối thủ đầu tiên còn sống
  if (!currentTargetTeamId || !enemies.some(e => e.id === currentTargetTeamId && !e.isEliminated)) {
    const firstAlive = enemies.find(e => !e.isEliminated);
    currentTargetTeamId = firstAlive ? firstAlive.id : (enemies[0] ? enemies[0].id : null);
  }

  enemies.forEach(enemy => {
    const isSelected = enemy.id === currentTargetTeamId;
    const btn = document.createElement('button');
    btn.className = `enemy-tab-pill ${isSelected ? 'active' : ''} ${enemy.isEliminated ? 'eliminated' : ''}`;
    
    const remShips = enemy.remainingShipsCount !== undefined ? enemy.remainingShipsCount : 6;
    const displayName = enemy.name || enemy.mysteryZoneName || `Vùng ${enemy.id}`;

    btn.innerHTML = `
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${enemy.colorHex}; margin-right:4px;"></span>
      <span>${displayName}</span>
      <span style="font-size:0.65rem; opacity:0.8;">(${enemy.isEliminated ? '☠️' : remShips + ' tàu'})</span>
    `;

    if (!enemy.isEliminated) {
      btn.addEventListener('click', () => {
        currentTargetTeamId = enemy.id;
        selectedCellKey = null;
        playerSelectedChip.style.display = 'none';
        playerTargetAimText.textContent = `Chọn 1 ô trên bảng của ${displayName} để ngắm bắn`;
        btnPlayerFire.disabled = true;
        btnPlayerFire.textContent = 'CHỌN Ô ĐỂ KHAI HỎA';

        if (screenMapRenderer) screenMapRenderer.clearSelection();
        if (playerBattleRenderer) playerBattleRenderer.clearSelection();

        renderEnemyTabs();
        renderEnemyBoard();
      });
    }

    playerEnemyTabs.appendChild(btn);
  });
}

// Render bảng 15x15 của đối thủ đang được nhắm
function renderEnemyBoard() {
  if (!playerBattleRenderer || !currentTargetTeamId || !gameState) return;
  const targetTeam = gameState.teams.find(t => t.id === currentTargetTeamId);
  const sunkShips = targetTeam ? targetTeam.sunkShips : [];
  playerBattleRenderer.renderEnemyZone(currentTargetTeamId, gameState.shots || {}, sunkShips);
}

// Khởi tạo bộ xếp tàu thủ công cho chế độ Demo
function initDemoManualPlacer(initialFleet) {
  if (!playerPrepRenderer) return;

  demoManualPlacer = new ManualFleetPlacer({
    renderer: playerPrepRenderer,
    initialFleet: initialFleet,
    onToast: (msg, icon) => showToast(msg, '', icon),
    onFleetChange: (changeData) => {
      updateDemoManualPlacerUI(changeData);
      if (changeData.isValid && currentRoomId && myTeamId) {
        socket.emit('player:update_fleet', {
          roomId: currentRoomId,
          teamId: myTeamId,
          fleet: changeData.fleet,
        });
      }
    },
  });

  updateDemoManualPlacerUI({
    fleet: demoManualPlacer.getFleet(),
    isValid: demoManualPlacer.isValid(),
    placedCount: demoManualPlacer.getPlacedCount(),
    totalCells: demoManualPlacer.getTotalCells(),
    activeShip: demoManualPlacer.getActiveShip(),
    orientation: demoManualPlacer.orientation,
  });
}

// Cập nhật giao diện thanh chọn tàu & hướng xoay cho Demo
function updateDemoManualPlacerUI({ fleet, isValid, placedCount, totalCells, activeShip, orientation }) {
  // 1. Cập nhật các nút chọn 6 tàu
  if (demoPrepShipSelector) {
    demoPrepShipSelector.querySelectorAll('.prep-ship-btn').forEach(btn => {
      const type = btn.dataset.type;
      const isCurrent = activeShip && activeShip.type === type;
      btn.classList.toggle('active', isCurrent);

      const shipObj = fleet.find(s => s.type === type);
      const isPlaced = shipObj && Array.isArray(shipObj.cells) && shipObj.cells.length === shipObj.size;
      btn.classList.toggle('unplaced', !isPlaced);
    });
  }

  // 2. Cập nhật thông tin tàu đang chọn
  if (activeShip) {
    if (demoActiveShipIcon) demoActiveShipIcon.textContent = activeShip.icon || '🚢';
    if (demoActiveShipName) demoActiveShipName.textContent = activeShip.name;
    const isPlaced = Array.isArray(activeShip.cells) && activeShip.cells.length === activeShip.size;
    if (demoActiveShipStatus) {
      if (isPlaced) {
        demoActiveShipStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">✓ Đã đặt (${activeShip.size} ô)</span>`;
      } else {
        demoActiveShipStatus.innerHTML = `<span style="color: #f59e0b; font-weight: 700;">⚠️ Chưa đặt (${activeShip.size} ô)</span>`;
      }
    }
  }

  // 3. Cập nhật text hướng xoay
  if (demoPrepOrientationText) {
    demoPrepOrientationText.textContent = orientation === 'HORIZONTAL' ? 'Ngang (↔)' : 'Dọc (↕)';
  }

  // 4. Cập nhật nút Xác nhận đội hình và Dòng gợi ý
  if (btnPlayerConfirmFleet && !btnPlayerConfirmFleet.disabled) {
    if (isValid) {
      btnPlayerConfirmFleet.disabled = false;
      btnPlayerConfirmFleet.className = 'btn btn-success';
      btnPlayerConfirmFleet.textContent = '✓ Xác Nhận Đội Hình';
      if (demoPrepHintText) {
        demoPrepHintText.textContent = '✨ Đội hình hợp lệ (21/21 ô)! Bấm Xác Nhận hoặc chạm tàu để dời.';
        demoPrepHintText.style.color = '#34d399';
      }
    } else {
      btnPlayerConfirmFleet.disabled = true;
      btnPlayerConfirmFleet.className = 'btn btn-outline';
      btnPlayerConfirmFleet.textContent = `⚠️ Đặt Đủ 6 Tàu (${placedCount}/6 - ${totalCells}/21 ô)`;
      if (demoPrepHintText) {
        demoPrepHintText.textContent = `👉 Chạm ô trên bàn cờ để đặt ${activeShip ? activeShip.name : 'tàu'} (${totalCells}/21 ô)!`;
        demoPrepHintText.style.color = '#f59e0b';
      }
    }
  }
}

// Cập nhật giao diện toàn diện cả 2 bên (Màn hình lớn + Điện thoại)
function updateUI(state) {
  gameState = state;

  // 1. CẬP NHẬT MÀN HÌNH LỚN BÊN TRÁI
  if (screenMapRenderer) {
    screenMapRenderer.updateState(gameState);
  }

  // 2. CẬP NHẬT THÔNG TIN ĐỘI CỦA BẠN
  const myTeam = state.myTeam || state.teams.find(t => t.id === myTeamId);
  if (myTeam) {
    playerTeamName.textContent = myTeam.name || 'Hạm Đội Của Bạn';
    playerTeamDot.style.background = myTeam.colorHex || '#38bdf8';
    playerScoreText.textContent = `${myTeam.score || 0}đ`;

    const remCells = 21 - (myTeam.damagedShipCells || 0);
    playerHpText.textContent = `${Math.max(0, remCells)}/21 ô`;

    if (myTeam.mysteryZoneName) {
      playerMysteryZoneText.textContent = `${myTeam.mysteryZoneName} (Bí mật)`;
    } else {
      playerMysteryZoneText.textContent = 'Chưa phân vùng';
    }

    // Nếu đang dàn trận hoặc đã có hạm đội -> Khởi tạo hoặc cập nhật ManualPlacer
    if (myTeam.fleet && playerPrepRenderer) {
      if (!demoManualPlacer) {
        initDemoManualPlacer(myTeam.fleet);
      }
    }
  }

  // 3. ĐIỀU PHỐI GIAO DIỆN THEO TRẠNG THÁI
  const currentCount = state.teams ? state.teams.length : currentDemoPlayerCount;
  document.querySelectorAll('#demoPlayerCountGroup .demo-count-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.count) === currentCount);
  });

  if (state.status === 'LOBBY') {
    const botCount = currentCount - 1;
    demoGlobalTurnText.textContent = `👥 Phòng chờ: ${botCount} Bot AI đã tham gia sẵn sàng`;
    playerTurnBanner.className = 'mobile-turn-alert waiting';
    playerTurnBanner.innerHTML = '👉 Bấm <strong>"BẮT ĐẦU DÀN TRẬN"</strong> để sắp xếp 6 tàu (21 ô) trong 2 phút!';
    if (playerLobbyActionWrap) playerLobbyActionWrap.style.display = 'block';
    playerPrepView.style.display = 'none';
    playerBattleView.style.display = 'none';
    btnDemoQuickStart.style.display = 'flex';
    btnDemoQuickStart.className = 'demo-btn demo-btn-green';
    btnDemoQuickStart.textContent = '🛠️ BẮT ĐẦU DÀN TRẬN (2 PHÚT)';

  } else if (state.status === 'PREPARATION') {
    const sec = state.prepSecondsRemaining !== undefined ? state.prepSecondsRemaining : 120;
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    demoGlobalTurnText.textContent = `⏳ Dàn trận bí mật 2 phút (${timeStr})`;
    playerPrepCountdown.textContent = timeStr;
    if (playerLobbyActionWrap) playerLobbyActionWrap.style.display = 'none';
    playerPrepView.style.display = 'flex';
    playerBattleView.style.display = 'none';

    playerTurnBanner.className = 'mobile-turn-alert active-turn';
    playerTurnBanner.innerHTML = '⚓ <strong>ĐOẠN ĐẶT TÀU (2 PHÚT):</strong> Bấm <strong>"Đổi Đội Hình"</strong> để sắp xếp 6 tàu hoặc <strong>"Xác Nhận"</strong>!';

    btnDemoQuickStart.style.display = 'flex';
    btnDemoQuickStart.className = 'demo-btn demo-btn-amber';
    btnDemoQuickStart.textContent = '⚡ BỎ QUA 2 PHÚT (VÀO BẮN NGAY)';

  } else if (state.status === 'PLAYING') {
    if (playerLobbyActionWrap) playerLobbyActionWrap.style.display = 'none';
    playerPrepView.style.display = 'none';
    playerBattleView.style.display = 'flex';
    btnDemoQuickStart.style.display = 'none';

    const isMyTurn = state.currentTurnTeamId === myTeamId;
    const activeTeam = state.teams.find(t => t.id === state.currentTurnTeamId);
    const activeName = activeTeam ? (activeTeam.mysteryZoneName || activeTeam.name) : 'Đối thủ';

    demoGlobalTurnText.innerHTML = `LƯỢT BẮN: <strong style="color: ${activeTeam ? activeTeam.colorHex : '#fff'};">${activeName.toUpperCase()}</strong>`;

    if (myTeam && myTeam.isEliminated) {
      playerTurnBanner.className = 'mobile-turn-alert waiting';
      playerTurnBanner.innerHTML = '☠️ <strong style="color: #ef4444;">HẠM ĐỘI ĐÃ BỊ LOẠI</strong> - Đang theo dõi trận đấu';
      btnPlayerFire.disabled = true;
      btnPlayerFire.textContent = 'HẠM ĐỘI ĐÃ BỊ LOẠI';
    } else if (isMyTurn) {
      playerTurnBanner.className = 'mobile-turn-alert active-turn';
      playerTurnBanner.innerHTML = '🎯 <strong>ĐẾN LƯỢT BẠN TẤN CÔNG!</strong>';

      if (!wasMyTurn) {
        soundManager.playSonar();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        wasMyTurn = true;
      }

      const targetTeam = state.teams.find(t => t.id === currentTargetTeamId);
      const targetLabel = targetTeam ? (targetTeam.mysteryZoneName || targetTeam.name) : 'Đối thủ';

      if (selectedCellKey) {
        btnPlayerFire.disabled = false;
        btnPlayerFire.className = 'btn btn-danger btn-large';
        btnPlayerFire.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.8)';
        btnPlayerFire.textContent = `🚀 BẮN Ô ${selectedCellKey} (${targetLabel})`;
      } else {
        btnPlayerFire.disabled = false;
        btnPlayerFire.className = 'btn btn-danger btn-large';
        btnPlayerFire.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.5)';
        btnPlayerFire.textContent = `🚀 BẮN NGAY (HOẶC CHẠM Ô ĐỂ CHỌN)`;
      }
    } else {
      playerTurnBanner.className = 'mobile-turn-alert waiting';
      playerTurnBanner.innerHTML = `⏳ Đang chờ <strong style="color: ${activeTeam ? activeTeam.colorHex : '#fff'};">${activeName}</strong> khai hỏa... <button id="btnDemoTakeTurn" style="margin-left: 6px; padding: 2px 8px; border-radius: 4px; background: #0284c7; color: #fff; font-size: 0.72rem; font-weight: 800; border: none; cursor: pointer;">⚡ Lấy Lượt Ngay</button>`;
      wasMyTurn = false;

      const takeTurnBtn = document.getElementById('btnDemoTakeTurn');
      if (takeTurnBtn) {
        takeTurnBtn.onclick = () => {
          socket.emit('host:change_turn', { roomId: currentRoomId, newTeamId: myTeamId });
        };
      }

      const targetTeam = state.teams.find(t => t.id === currentTargetTeamId);
      const targetLabel = targetTeam ? (targetTeam.mysteryZoneName || targetTeam.name) : 'Đối thủ';

      if (selectedCellKey) {
        btnPlayerFire.disabled = false;
        btnPlayerFire.className = 'btn btn-danger btn-large';
        btnPlayerFire.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.8)';
        btnPlayerFire.textContent = `⚡ BẮN Ô ${selectedCellKey} (${targetLabel})`;
      } else {
        btnPlayerFire.disabled = false;
        btnPlayerFire.className = 'btn btn-danger btn-large';
        btnPlayerFire.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.5)';
        btnPlayerFire.textContent = `⚡ BẮN NGAY (GIÀNH LƯỢT)`;
      }
    }

    renderEnemyTabs();
    renderEnemyBoard();

  } else if (state.status === 'FINISHED') {
    demoGlobalTurnText.textContent = '🏆 TRẬN ĐẤU ĐÃ KẾT THÚC!';
    playerTurnBanner.className = 'mobile-turn-alert active-turn';
    playerTurnBanner.innerHTML = '👑 <strong>TRẬN CHIẾN KHÉP LẠI! XEM BẢNG VINH DANH!</strong>';
    btnPlayerFire.disabled = true;
    btnPlayerFire.textContent = 'TRẬN ĐẤU KẾT THÚC';

    renderRankings(state.rankings);
    victoryOverlay.classList.add('show');
    soundManager.playVictory();
  }
}

// Hiệu ứng khai hỏa điện ảnh trên màn hình lớn
function showCinematicShot(shot) {
  const targetLabel = shot.targetMysteryZoneName || shot.targetTeamName;
  shotCinematicTarget.textContent = `MỤC TIÊU: ${targetLabel.toUpperCase()}`;
  shotCinematicCell.textContent = shot.cellKey;

  shotCinematicResult.className = `shot-cinematic-result ${shot.isEliminated ? 'ELIMINATED' : shot.isSunk ? 'SUNK' : shot.isHit ? 'HIT' : 'MISS'}`;

  if (shot.isEliminated) {
    shotCinematicResult.textContent = `HẠ TÀU CUỐI CÙNG & LOẠI ĐỘI! ☠️ (+${shot.pointsEarned}đ)`;
    soundManager.playExplosion();
    setTimeout(() => soundManager.playAlarm(), 400);
  } else if (shot.isSunk) {
    shotCinematicResult.textContent = `BẮN HẠ ${shot.hitShipName.toUpperCase()}! 💥 (+${shot.pointsEarned}đ)`;
    soundManager.playExplosion();
    setTimeout(() => soundManager.playAlarm(), 300);
  } else if (shot.isHit) {
    shotCinematicResult.textContent = `BẮN TRÚNG MỤC TIÊU! 🔥 (+${shot.pointsEarned}đ)`;
    soundManager.playExplosion();
  } else {
    shotCinematicResult.textContent = `BẮN TRƯỢT VÀO VÙNG NƯỚC! 🌊`;
    soundManager.playSplash();
  }

  // Chỉ hiển thị bảng pop-up điện ảnh lớn khi người chơi bắn, bị bắn trúng, hoặc có tàu chìm / loại đội
  const isRelevant = shot.firingTeamId === myTeamId || (shot.targetTeamId === myTeamId && shot.isHit) || shot.isSunk || shot.isEliminated;
  if (isRelevant) {
    shotCinematicOverlay.classList.add('show');
    setTimeout(() => {
      shotCinematicOverlay.classList.remove('show');
    }, 1800);
  }

  // Toast trên điện thoại nếu bạn là người bắn hoặc bị bắn
  if (shot.firingTeamId === myTeamId) {
    selectedCellKey = null;
    playerSelectedChip.style.display = 'none';
    if (shot.isEliminated) {
      showToast('TIÊU DIỆT HẠM ĐỘI!', `Bắn chìm tàu cuối của ${targetLabel}!`, '☠️');
    } else if (shot.isSunk) {
      showToast('BẮN HẠ TÀU!', `Đã bắn chìm ${shot.hitShipName}!`, '💥');
    } else if (shot.isHit) {
      showToast('BẮN TRÚNG!', `Trúng ô ${shot.cellKey}! (+${shot.pointsEarned}đ)`, '🎯');
    } else {
      showToast('BẮN TRƯỢT!', `Đạn rơi xuống biển tại ô ${shot.cellKey}`, '🌊');
    }
  } else if (shot.targetTeamId === myTeamId && shot.isHit) {
    showToast('CẢNH BÁO BỊ BẮN!', `${shot.firingMysteryZoneName || shot.firingTeamName} bắn trúng ô ${shot.cellKey} của bạn!`, '🚨');
    soundManager.playAlarm();
  }
}

// Render bục Olympic Top 3
function renderRankings(rankings) {
  if (!rankings || !rankings.length) return;

  const top1 = rankings.find(r => r.rank === 1);
  const top2 = rankings.find(r => r.rank === 2);
  const top3 = rankings.find(r => r.rank === 3);

  let podiumHtml = '';

  if (top2) {
    const name2 = top2.realName && top2.mysteryZoneName && top2.realName !== top2.mysteryZoneName
      ? `${top2.realName} (${top2.mysteryZoneName})`
      : top2.name;
    podiumHtml += `
      <div class="podium-step rank-2">
        <div class="podium-card">
          <div class="podium-medal">🥈</div>
          <div class="podium-title">Á QUÂN</div>
          <div class="podium-team-name" style="color: ${top2.colorHex};">${name2}</div>
          <div class="podium-score">${top2.score}đ</div>
          <span class="podium-status-tag" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1;">${top2.survivalStatus}</span>
        </div>
        <div class="podium-base"><span class="podium-rank-num">2</span></div>
      </div>
    `;
  }

  if (top1) {
    const name1 = top1.realName && top1.mysteryZoneName && top1.realName !== top1.mysteryZoneName
      ? `${top1.realName} (${top1.mysteryZoneName})`
      : top1.name;
    podiumHtml += `
      <div class="podium-step rank-1">
        <div class="podium-card">
          <div class="podium-medal">👑 🥇</div>
          <div class="podium-title">QUÁN QUÂN</div>
          <div class="podium-team-name" style="color: ${top1.colorHex}; font-size: 1.35rem;">${name1}</div>
          <div class="podium-score" style="color: #fbbf24; font-size: 1.25rem;">${top1.score}đ</div>
          <span class="podium-status-tag" style="background: rgba(245, 158, 11, 0.25); color: #fbbf24; font-weight: 800;">🏆 SỐNG SÓT CUỐI CÙNG</span>
        </div>
        <div class="podium-base"><span class="podium-rank-num">1</span></div>
      </div>
    `;
  }

  if (top3) {
    const name3 = top3.realName && top3.mysteryZoneName && top3.realName !== top3.mysteryZoneName
      ? `${top3.realName} (${top3.mysteryZoneName})`
      : top3.name;
    podiumHtml += `
      <div class="podium-step rank-3">
        <div class="podium-card">
          <div class="podium-medal">🥉</div>
          <div class="podium-title">QUÝ QUÂN</div>
          <div class="podium-team-name" style="color: ${top3.colorHex};">${name3}</div>
          <div class="podium-score">${top3.score}đ</div>
          <span class="podium-status-tag" style="background: rgba(217, 119, 6, 0.2); color: #f59e0b;">${top3.survivalStatus}</span>
        </div>
        <div class="podium-base"><span class="podium-rank-num">3</span></div>
      </div>
    `;
  }

  podiumContainer.innerHTML = podiumHtml;

  if (rankingsTableBody) {
    rankingsTableBody.innerHTML = rankings.map(r => {
      const displayName = r.realName && r.mysteryZoneName && r.realName !== r.mysteryZoneName
        ? `${r.realName} <span style="font-size:0.8rem; color:#94a3b8; font-weight:normal;">(${r.mysteryZoneName})</span>`
        : r.name;
      return `
        <tr class="${r.rank === 1 ? 'rank-1-row' : r.rank === 2 ? 'rank-2-row' : r.rank === 3 ? 'rank-3-row' : ''}">
          <td style="font-weight: 800;">${r.medal} ${r.rank}</td>
          <td style="font-weight: 700;">${r.rankTitle}</td>
          <td style="text-align: left; font-weight: 800; color: ${r.colorHex};">${displayName}</td>
          <td>${r.isEliminated ? '☠️ Đã bị tiêu diệt' : '🛡️ Còn sống'}</td>
          <td>${r.remainingShips}/6 tàu</td>
          <td>${r.hpPercent}%</td>
          <td style="font-weight: 900; color: #38bdf8;">${r.score}đ</td>
        </tr>
      `;
    }).join('');
  }
}

function showToast(title, subtitle, icon) {
  toastTitle.textContent = title;
  toastSubtitle.textContent = subtitle;
  toastIcon.textContent = icon || '🎯';
  mobileResultToast.classList.add('show');
  setTimeout(() => mobileResultToast.classList.remove('show'), 2000);
}

// -------------------------------------------------------------
// SOCKET.IO EVENTS
// -------------------------------------------------------------

socket.on('game:state_update', (state) => {
  updateUI(state);
});

socket.on('host:state_update', (hostState) => {
  lastHostState = hostState;
  if (demoShowSecretShips && screenMapRenderer) {
    screenMapRenderer.options.showSecretShips = true;
    screenMapRenderer.updateState(hostState);
  }
});

socket.on('shot:executed', ({ shot }) => {
  showCinematicShot(shot);
  if (screenMapRenderer && screenMapRenderer.highlightShot) {
    screenMapRenderer.highlightShot(shot.targetTeamId, shot.cellKey, shot.isHit);
  }

  // CHỈ XÓA TÂM NGẮM VÀ Ô CHỌN KHI PHÁT BẮN LÀ CỦA CHÍNH BẠN (KHÔNG XÓA KHI BOT BẮN)
  if (shot.firingTeamId === myTeamId) {
    if (screenMapRenderer) {
      screenMapRenderer.clearSelection();
    }
    if (playerBattleRenderer) {
      playerBattleRenderer.clearSelection();
    }
    selectedCellKey = null;
    if (btnPlayerFire) {
      btnPlayerFire.disabled = false;
      btnPlayerFire.className = 'btn btn-outline btn-large';
      btnPlayerFire.style.boxShadow = 'none';
      btnPlayerFire.textContent = '👉 CHỌN 1 Ô TRÊN BẢNG ĐỂ BẮN';
    }
  }
});

socket.on('prep:tick', ({ secondsLeft }) => {
  if (gameState) gameState.prepSecondsRemaining = secondsLeft;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  playerPrepCountdown.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
});

socket.on('player:fleet_updated', ({ fleet }) => {
  if (demoManualPlacer) {
    demoManualPlacer.setFleet(fleet);
  } else if (playerPrepRenderer) {
    initDemoManualPlacer(fleet);
  }
  soundManager.playSonar();
});

socket.on('player:fleet_confirmed', () => {
  btnPlayerConfirmFleet.disabled = true;
  btnPlayerRandomFleet.disabled = true;
  if (btnDemoClearBoard) btnDemoClearBoard.disabled = true;
  if (btnDemoRotateShip) btnDemoRotateShip.disabled = true;
  btnPlayerConfirmFleet.textContent = '✓ Đã Khóa Đội Hình';
});

socket.on('error:message', ({ message }) => {
  showToast('THÔNG BÁO', message, '⚠️');
  if (btnPlayerFire) btnPlayerFire.disabled = false;
});
