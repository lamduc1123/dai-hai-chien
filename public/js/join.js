// public/js/join.js
// Logic giao diện điện thoại người chơi: Hải đồ 20x20 (400 ô), Đếm ngược 60s, Kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+)
// Hỗ trợ chọn ô bằng chạm trực tiếp hoặc nhập tọa độ nhanh (VD: B14)

(() => {
const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
let COLS = ALL_LETTERS.slice(0, 20);
let ROWS = Array.from({ length: 20 }, (_, i) => i + 1);

let socket = null;
let currentRoomId = 'PHONG-01';
let myTeamId = null;
let myDeviceToken = localStorage.getItem('dai_hai_chien_token') || null;
let myPlayerState = null;
let soundManager = null;
let turnTickerInterval = null;

let selectedSlotId = null;
let selectedTargetKey = null;
let currentWeaponMode = 'NORMAL'; // 'NORMAL', 'RADAR', 'CROSSFIRE'
let currentZoomLevel = 1.0;

const DEFAULT_TEAMS_FALLBACK = [
  { id: 1, name: 'Hải Ưng', colorHex: '#2563eb', icon: '🦅', isConnected: false },
  { id: 2, name: 'Thủy Quái', colorHex: '#dc2626', icon: '🐙', isConnected: false },
  { id: 3, name: 'Cá Mập Trắng', colorHex: '#059669', icon: '🦈', isConnected: false },
  { id: 4, name: 'Hạm Đội Vàng', colorHex: '#d97706', icon: '👑', isConnected: false },
  { id: 5, name: 'Sấm Sét Biển', colorHex: '#7c3aed', icon: '⚡', isConnected: false },
  { id: 6, name: 'Bão Biển', colorHex: '#ea580c', icon: '🌊', isConnected: false },
  { id: 7, name: 'Sát Thủ Biển Sâu', colorHex: '#0891b2', icon: '🔱', isConnected: false },
  { id: 8, name: 'Sao Biển', colorHex: '#e11d48', icon: '⭐', isConnected: false },
];

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  const urlParams = new URLSearchParams(window.location.search);
  currentRoomId = urlParams.get('room') || 'PHONG-01';

  renderTeamSlots(DEFAULT_TEAMS_FALLBACK);
  initSocket();
  initEventListeners();
  startMobileTurnTicker();

  if (window.firebaseSync && window.firebaseSync.init() && currentRoomId) {
    window.firebaseSync.clientSubscribeState(currentRoomId, (roomState) => {
      if (roomState) {
        const pState = buildPlayerStateFromRoomState(roomState, myTeamId);
        updatePlayerUI(pState);
      }
    });

    window.firebaseSync.clientSubscribeShotEffect(currentRoomId, (effect) => {
      if (!effect) return;

      if (effect.easterEgg) {
        soundManager.playAlarm();
        const eeMobile = document.getElementById('mobileEasterEggBanner');
        if (eeMobile) {
          if (effect.shooterTeamId === myTeamId) {
            eeMobile.innerHTML = `🎁 <b>BẮN TRÚNG Ô MAY MẮN (EASTER EGG)!</b><br>Đội của bạn được thưởng thêm +1 LƯỢT BẮN TIẾP TỤC! 🎯`;
          } else {
            eeMobile.innerHTML = `🎁 <b>${effect.shooterName || 'ĐỐI THỦ'}</b> bắn trúng ô May Mắn và được thêm 1 lượt!`;
          }
          eeMobile.style.display = 'block';
          setTimeout(() => { eeMobile.style.display = 'none'; }, 4500);
        }
      }

      if (effect.actionType === 'CROSSFIRE') {
        soundManager.playMissile();
        if (effect.shooterTeamId === myTeamId) {
          soundManager.playHit();
        }
        return;
      }

      // Phát bắn thường
      if (effect.shooterTeamId === myTeamId) {
        soundManager.playMissile();
      }
      if (effect.result === 'HIT' || effect.result === 'SUNK') {
        soundManager.playHit();
        if (navigator.vibrate) navigator.vibrate([100, 50, 200]);
      } else {
        soundManager.playMiss();
      }
    });
  }
});

function initSocket() {
  try {
    socket = io({ timeout: 2500, reconnectionAttempts: 3 });

    if (currentRoomId) {
      socket.emit('player:get_lobby_info', { roomId: currentRoomId });
    }

    socket.on('player:joined', (data) => {
      myTeamId = data.teamId;
      myDeviceToken = data.deviceToken;
      localStorage.setItem('dai_hai_chien_token', myDeviceToken);

      document.getElementById('btnJoinTeam').style.display = 'none';
      document.getElementById('waitingRoomState').style.display = 'block';

      updatePlayerUI(data.state);
    });

    socket.on('player:state_update', (state) => {
      updatePlayerUI(state);
    });

    socket.on('player:join_error', (data) => {
      alert(data.error || 'Không thể tham gia đội');
    });

    socket.on('player:fire_error', (data) => {
      alert(data.error || 'Lỗi khai hỏa');
    });
  } catch (err) {
    console.log('Chế độ Standalone Mobile');
  }
}

function updatePlayerUI(state) {
  if (!state) return;
  myPlayerState = state;

  // Cập nhật kích thước hải đồ động nếu có
  if (state.grid && state.grid.cols && state.grid.rows) {
    if (state.grid.cols.length !== COLS.length || state.grid.rows.length !== ROWS.length) {
      COLS = [...state.grid.cols];
      ROWS = [...state.grid.rows];
      const pGrid = document.getElementById('placementGrid');
      const bGrid = document.getElementById('battleOceanGrid');
      if (pGrid) buildGridInContainer(pGrid, handlePlacementCellClick);
      if (bGrid) buildGridInContainer(bGrid, handleBattleCellClick);
    }
  }

  const myTeam = state.myTeam;
  if (myTeam) {
    // Header
    document.getElementById('headerTeamTitle').textContent = myTeam.name;
    document.getElementById('headerTeamTitle').style.color = myTeam.colorHex;
    document.getElementById('headerSubTitle').textContent = `Chiến Hạm #${myTeam.id}`;

    const badge = document.getElementById('teamBadgeHeader');
    badge.style.display = 'inline-flex';
    badge.textContent = `${myTeam.icon} ĐỘI ${myTeam.id}`;
    badge.style.background = `${myTeam.colorHex}22`;
    badge.style.color = myTeam.colorHex;

    // Cập nhật số lượng kỹ năng
    const badgeCrossfire = document.getElementById('badgeCrossfireCount');
    if (badgeCrossfire) badgeCrossfire.textContent = `Còn ${myTeam.crossfireRemaining ?? 1}/1`;

    // Sẵn sàng button
    const btnReady = document.getElementById('btnToggleReady');
    if (btnReady) {
      if (myTeam.isReady) {
        btnReady.textContent = '✓ ĐÃ SẴN SÀNG';
        btnReady.className = 'btn btn-outline';
      } else {
        btnReady.textContent = '✓ BẤM SẴN SÀNG';
        btnReady.className = 'btn btn-success';
      }
    }
  }

  // Điều phối View theo Phase & Tình trạng chọn đội
  const viewLobby = document.getElementById('viewLobby');
  const viewPlacement = document.getElementById('viewPlacement');
  const viewBattle = document.getElementById('viewBattle');
  const viewFinished = document.getElementById('viewFinished');

  // NẾU NGƯỜI CHƠI CHƯA CHỌN ĐỘI -> LUÔN HIỂN THỊ MÀN HÌNH CHỌN ĐỘI ĐẦU TIÊN
  if (!myTeamId || !myTeam) {
    viewLobby.style.display = 'block';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';
    renderTeamSlots(state.teamsOverview || DEFAULT_TEAMS_FALLBACK);
    return;
  }

  // ĐÃ CÓ ĐỘI -> HIỂN THỊ THEO GIAI ĐOẠN TRẬN ĐẤU
  if (state.phase === 'LOBBY') {
    viewLobby.style.display = 'block';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';
    document.getElementById('btnJoinTeam').style.display = 'none';
    document.getElementById('waitingRoomState').style.display = 'block';
  } else if (state.phase === 'PLACEMENT') {
    viewLobby.style.display = 'none';
    viewPlacement.style.display = 'block';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';

    renderPlacementView(state);
  } else if (state.phase === 'BATTLE') {
    viewLobby.style.display = 'none';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'flex';
    viewFinished.style.display = 'none';

    renderBattleView(state);
  } else if (state.phase === 'FINISHED' || state.phase === 'GAME_OVER') {
    viewLobby.style.display = 'none';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'block';

    if (state.winner) {
      const isWinnerMe = myTeam && state.winner.id === myTeam.id;
      document.getElementById('winnerAnnounceText').innerHTML = isWinnerMe
        ? '🎉 XIN CHÚC MỪNG! HẠM ĐỘI CỦA BẠN ĐÃ CHIẾN THẮNG QUÁN QUÂN!'
        : `🏆 HẠM ĐỘI SINH TỒN CUỐI CÙNG: <b>${state.winner.name}</b>`;
    }
  }
}

function renderTeamSlots(teams) {
  const container = document.getElementById('teamSlotsContainer');
  if (!container) return;

  container.innerHTML = '';
  teams.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `slot-btn ${selectedSlotId === t.id ? 'selected' : ''}`;
    
    // Nếu là bot hoặc chưa có ai kết nối thì có thể chọn
    const canSelect = !t.isConnected || (myTeamId && myTeamId === t.id) || t.isBot;
    if (!canSelect) {
      btn.classList.add('taken');
      btn.disabled = true;
    }

    let statusLabel = '🟢 Vị trí trống (Bấm chọn)';
    if (t.isConnected && (!myTeamId || myTeamId !== t.id)) {
      statusLabel = '👤 Đã có chỉ huy khác';
    } else if (t.isBot) {
      statusLabel = '🤖 Máy tự động (Bấm nhận đội)';
    } else if (myTeamId === t.id) {
      statusLabel = '⭐ Đội của bạn';
    }

    btn.innerHTML = `
      <span style="font-size: 1.3rem;">${t.icon}</span>
      <div style="flex: 1; text-align: left;">
        <div style="font-weight: 800; color: ${t.colorHex}; font-size: 0.95rem;">${t.name}</div>
        <div style="font-size: 0.75rem; color: #64748b;">${statusLabel}</div>
      </div>
      <div>
        ${selectedSlotId === t.id ? '<span style="color: var(--navy-primary); font-weight: bold;">✓ ĐÃ CHỌN</span>' : ''}
      </div>
    `;

    if (canSelect) {
      btn.addEventListener('click', () => {
        selectedSlotId = t.id;
        renderTeamSlots(teams);
      });
    }

    container.appendChild(btn);
  });
}

function renderPlacementView(state) {
  const myTeam = state.myTeam;
  if (!myTeam) return;

  const hint = document.getElementById('placementZoneHint');
  if (hint) {
    hint.textContent = '🗺️ Đại dương 400 ô mở tự do: Bấm "🎲 Xếp Tự Động" để đổi vị trí chiến thuật hoặc chạm ô để xếp lại.';
  }

  // Tự động sinh hạm đội ban đầu nếu chưa có tàu
  const shipLengths = (state.config && state.config.shipLengths) || [4, 3];
  if ((!myTeam.fleet || myTeam.fleet.length === 0) && window.GameEngine) {
    myTeam.fleet = window.GameEngine.generateRandomFleetOpenOcean(shipLengths);
  }

  const container = document.getElementById('placementGrid');
  if (container.children.length === 0) {
    buildGridInContainer(container, (key) => {
      // Chạm vào ô bất kỳ để xếp lại đội hình ngẫu nhiên quanh ô đó
      if (!myTeam.isFleetLocked && window.GameEngine) {
        myTeam.fleet = window.GameEngine.generateRandomFleetOpenOcean(shipLengths);
        renderPlacementView(state);
      }
    });
  }

  container.querySelectorAll('.ocean-cell').forEach(c => {
    c.className = 'ocean-cell';
    c.style.backgroundColor = '';
    c.style.borderColor = '';
    c.innerHTML = '';
  });

  // Hiển thị chiến hạm liền khối 3 ô hoặc 4 ô
  if (myTeam.fleet) {
    myTeam.fleet.forEach(ship => {
      ship.cells.forEach(k => {
        const cell = container.querySelector(`[data-key="${k}"]`);
        if (!cell) return;
        const partClass = window.GameEngine.getShipPartClass(ship, k);
        cell.classList.add('has-ship');
        if (partClass) cell.classList.add(partClass);
        cell.style.borderColor = myTeam.colorHex;
      });
    });
  }

  const btnLock = document.getElementById('btnLockFleet');
  if (btnLock) {
    if (myTeam.isFleetLocked) {
      btnLock.textContent = '🔒 ĐÃ KHÓA HẠM ĐỘI (CHỜ KHỞI TRANH)';
      btnLock.className = 'btn btn-outline';
      btnLock.disabled = true;
    } else {
      btnLock.textContent = '🔒 KHÓA HẠM ĐỘI & SẴN SÀNG';
      btnLock.className = 'btn btn-success btn-large';
      btnLock.disabled = !myTeam.fleet || myTeam.fleet.length === 0;
    }
  }

  // Cuộn vào trung tâm hạm đội của mình
  if (myTeam.fleet && myTeam.fleet.length > 0 && myTeam.fleet[0].cells.length > 0) {
    const firstCellKey = myTeam.fleet[0].cells[0];
    const firstCell = container.querySelector(`[data-key="${firstCellKey}"]`);
    if (firstCell) {
      firstCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }
}

function renderBattleView(state) {
  const myTeam = state.myTeam;
  const isMyTurn = state.isMyTurn;

  const banner = document.getElementById('turnBanner');
  const btnFire = document.getElementById('btnFire');

  if (myTeam && myTeam.isEliminated) {
    banner.className = 'turn-banner';
    banner.style.background = '#fee2e2';
    banner.style.color = '#dc2626';
    banner.textContent = '☠️ HẠM ĐỘI CỦA BẠN ĐÃ BỊ HỦY DIỆT (CHẾ ĐỘ KHÁN GIẢ)';
    btnFire.disabled = true;
    return;
  }

  if (isMyTurn) {
    banner.className = 'turn-banner my-turn';
    banner.textContent = '🚨 ĐẾN LƯỢT CHỈ HUY! CHỌN Ô HOẶC NHẬP TỌA ĐỘ ĐỂ TÁC CHIẾN!';
    if (navigator.vibrate) {
      navigator.vibrate([150, 50, 150]);
    }
    btnFire.disabled = !selectedTargetKey;
  } else {
    banner.className = 'turn-banner wait-turn';
    const activeTeam = state.teamsOverview ? state.teamsOverview.find(t => t.id === state.currentTurnTeamId) : null;
    banner.textContent = `⏳ ĐANG CHỜ ${activeTeam ? activeTeam.name : 'ĐỐI THỦ'} KHAI HỎA...`;
    btnFire.disabled = true;
  }

  // Khởi tạo lưới chiến đấu 20x20 nếu chưa có
  const container = document.getElementById('battleGrid');
  if (container.children.length === 0) {
    buildGridInContainer(container, (key) => {
      selectTargetCoordinate(key);
    });
  }

  // Cập nhật trạng thái từng ô
  updateGridCellVisuals(container, state, myTeam);

  // Cập nhật danh sách tàu của mình
  renderMyFleetStatus(myTeam);
}

function updateGridCellVisuals(container, state, myTeam) {
  const targetHighlightSet = getTargetAreaHighlightKeys();

  container.querySelectorAll('.ocean-cell').forEach(c => {
    c.className = 'ocean-cell';
    c.style.backgroundColor = '';
    c.style.borderColor = '';
    c.innerHTML = '';
  });

  // Ô tàu mình (hiển thị chiến hạm liền khối)
  if (myTeam && myTeam.fleet) {
    myTeam.fleet.forEach(ship => {
      const isSunk = ship.isSunk;
      ship.cells.forEach(k => {
        const cell = container.querySelector(`[data-key="${k}"]`);
        if (!cell) return;
        const partClass = window.GameEngine.getShipPartClass(ship, k);
        cell.classList.add('has-ship');
        if (partClass) cell.classList.add(partClass);
        cell.style.borderColor = myTeam.colorHex;

        if (isSunk) {
          cell.classList.add('shot-sunk');
        } else if (ship.hits && ship.hits.includes(k)) {
          cell.classList.add('shot-hit');
        }
      });
    });
  }

  // Ô đã bắn
  if (state.shotsMap) {
    for (const k in state.shotsMap) {
      const shot = state.shotsMap[k];
      const cell = container.querySelector(`[data-key="${k}"]`);
      if (!cell) continue;

      if (shot.result === 'MISS') {
        cell.className = 'ocean-cell shot-miss';
      } else if (shot.result === 'HIT' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-hit';
      } else if (shot.result === 'SUNK' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-sunk';
      }
    }
  }

  // Highlight phạm vi vũ khí đang chọn
  targetHighlightSet.forEach(k => {
    const c = container.querySelector(`[data-key="${k}"]`);
    if (!c) return;
    if (currentWeaponMode === 'CROSSFIRE') {
      c.classList.add('crossfire-target');
    } else {
      c.classList.add('selected-target');
    }
  });
}

function getTargetAreaHighlightKeys() {
  const set = new Set();
  if (!selectedTargetKey) return set;

  if (currentWeaponMode === 'NORMAL') {
    set.add(selectedTargetKey);
    return set;
  }

  const parsed = window.GameEngine ? window.GameEngine.parseKey(selectedTargetKey) : null;
  if (!parsed) {
    set.add(selectedTargetKey);
    return set;
  }

  if (currentWeaponMode === 'CROSSFIRE') {
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
        set.add(`${COLS[cIdx]}${ROWS[rIdx]}`);
      }
    }
    return set;
  }

  set.add(selectedTargetKey);
  return set;
}

function selectTargetCoordinate(key) {
  if (!myPlayerState || !myPlayerState.isMyTurn) return;

  if (currentWeaponMode === 'NORMAL' && myPlayerState.shotsMap && myPlayerState.shotsMap[key]) {
    alert('Tọa độ này đã bị bắn trước đó! Hãy chọn ô khác.');
    return;
  }

  selectedTargetKey = key;
  document.getElementById('selectedTargetDisplay').textContent = key;
  document.getElementById('selectedTargetText').textContent = `Tọa độ xác định: Cột ${key[0]}, Hàng ${key.substring(1)}`;
  document.getElementById('btnFire').disabled = false;

  const inputManual = document.getElementById('inputManualCoord');
  if (inputManual) inputManual.value = key;

  // Cập nhật lại hình ảnh ô trên bản đồ
  const container = document.getElementById('battleGrid');
  if (container) {
    updateGridCellVisuals(container, myPlayerState, myPlayerState.myTeam);
  }

  // Cuộn ô được chọn vào tầm nhìn trên điện thoại
  const targetCell = document.getElementById(`cell-${key}`);
  if (targetCell) {
    targetCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

function renderMyFleetStatus(myTeam) {
  const container = document.getElementById('myFleetList');
  if (!container || !myTeam || !myTeam.fleet) return;

  container.innerHTML = '';
  myTeam.fleet.forEach(ship => {
    const hitsCount = ship.hits ? ship.hits.length : 0;
    const isSunk = ship.isSunk;

    const card = document.createElement('div');
    card.className = `ship-status-card ${isSunk ? 'sunk' : ''}`;
    card.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 2px;">${isSunk ? '☠️' : '🚢'} ${ship.name}</div>
      <div style="font-size: 0.75rem; color: ${isSunk ? '#dc2626' : '#0284c7'};">
        ${isSunk ? 'Đã bị bắn chìm' : `Sinh lực: ${ship.size - hitsCount}/${ship.size}`}
      </div>
    `;
    container.appendChild(card);
  });
}

function buildGridInContainer(container, onClickCell) {
  container.innerHTML = '';
  container.style.gridTemplateColumns = `26px repeat(${COLS.length}, minmax(22px, 1fr))`;
  container.style.gridTemplateRows = `22px repeat(${ROWS.length}, minmax(22px, 1fr))`;

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

      if (onClickCell) {
        cell.addEventListener('click', () => onClickCell(key));
      }

      container.appendChild(cell);
    }
  }
}

// Bộ đếm thời gian 60s cho điện thoại
function startMobileTurnTicker() {
  if (turnTickerInterval) clearInterval(turnTickerInterval);
  turnTickerInterval = setInterval(() => {
    if (!myPlayerState || myPlayerState.phase !== 'BATTLE') return;

    const timerBadge = document.getElementById('mobileTurnTimer');
    if (!timerBadge) return;

    const turnStart = myPlayerState.turnStartTime || Date.now();
    const elapsed = Math.floor((Date.now() - turnStart) / 1000);
    const remaining = Math.max(0, 60 - elapsed);

    timerBadge.textContent = `${remaining}s`;

    if (remaining <= 10) {
      timerBadge.classList.add('urgent');
      if (myPlayerState.isMyTurn && remaining > 0 && navigator.vibrate) {
        navigator.vibrate(60);
      }
    } else {
      timerBadge.classList.remove('urgent');
    }
  }, 1000);
}

function initEventListeners() {
  // Nút Tham Gia Đội
  document.getElementById('btnJoinTeam').addEventListener('click', () => {
    if (!selectedSlotId) {
      alert('Vui lòng chọn 1 vị trí đội tham gia!');
      return;
    }
    const name = document.getElementById('inputPlayerName').value.trim() || `Chỉ Huy #${selectedSlotId}`;

    myTeamId = selectedSlotId;
    myDeviceToken = myDeviceToken || Math.random().toString(36).substring(2);
    localStorage.setItem('dai_hai_chien_token', myDeviceToken);

    document.getElementById('btnJoinTeam').style.display = 'none';
    document.getElementById('waitingRoomState').style.display = 'block';

    if (socket && socket.connected) {
      socket.emit('player:join', {
        roomId: currentRoomId,
        teamId: selectedSlotId,
        playerName: name,
        deviceToken: myDeviceToken,
      });
    }

    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'JOIN',
        teamId: selectedSlotId,
        playerName: name,
        deviceToken: myDeviceToken,
      });
    }
  });

  // Nút Sẵn Sàng (Lobby)
  document.getElementById('btnToggleReady').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId) return;
    if (socket && socket.connected) {
      socket.emit('player:ready', { roomId: currentRoomId, teamId: myTeamId });
    }
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, { type: 'READY', teamId: myTeamId });
    }
  });

  // Nút Xếp Tàu Tự Động (Placement)
  document.getElementById('btnAutoPlace').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId) return;
    if (socket && socket.connected) {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
    }
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, { type: 'AUTO_PLACE', teamId: myTeamId });
    }
  });

  // Nút Khóa Hạm Đội (Placement)
  document.getElementById('btnLockFleet').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId || !myPlayerState || !myPlayerState.myTeam) return;
    const fleet = myPlayerState.myTeam.fleet;
    if (!fleet || fleet.length === 0) {
      if (socket && socket.connected) {
        socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
      }
      if (window.firebaseSync && window.firebaseSync.isReady) {
        window.firebaseSync.clientSendAction(currentRoomId, { type: 'AUTO_PLACE', teamId: myTeamId });
      }
      return;
    }

    if (socket && socket.connected) {
      socket.emit('player:lock_fleet', { roomId: currentRoomId, teamId: myTeamId, fleet });
    }
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'LOCK_FLEET',
        teamId: myTeamId,
        fleet,
      });
    }
  });

  // Nút Kỹ Năng / Vũ Khí
  const btnSkillNormal = document.getElementById('btnSkillNormal');
  const btnSkillCrossfire = document.getElementById('btnSkillCrossfire');
  const btnFire = document.getElementById('btnFire');

  function updateSkillButtonsUI() {
    if (btnSkillNormal) btnSkillNormal.className = currentWeaponMode === 'NORMAL' ? 'btn btn-primary' : 'btn btn-outline';
    if (btnSkillCrossfire) btnSkillCrossfire.className = currentWeaponMode === 'CROSSFIRE' ? 'btn btn-primary' : 'btn btn-outline';

    if (currentWeaponMode === 'NORMAL') {
      btnFire.textContent = '🚀 KHAI HỎA TÊN LỬA!';
      btnFire.style.background = '#dc2626';
    } else if (currentWeaponMode === 'CROSSFIRE') {
      btnFire.textContent = '💥 BẮN TÊN LỬA CHỮ THẬP (+)!';
      btnFire.style.background = '#ea580c';
    }

    const container = document.getElementById('battleGrid');
    if (container && myPlayerState) {
      updateGridCellVisuals(container, myPlayerState, myPlayerState.myTeam);
    }
  }

  if (btnSkillNormal) {
    btnSkillNormal.addEventListener('click', () => {
      currentWeaponMode = 'NORMAL';
      updateSkillButtonsUI();
    });
  }

  if (btnSkillCrossfire) {
    btnSkillCrossfire.addEventListener('click', () => {
      if (myPlayerState && myPlayerState.myTeam && (myPlayerState.myTeam.crossfireRemaining || 0) <= 0) {
        alert('Bạn đã hết lượt bắn Tên lửa Chữ Thập!');
        return;
      }
      currentWeaponMode = 'CROSSFIRE';
      updateSkillButtonsUI();
    });
  }

  // Nhập Tọa Độ Nhanh
  const inputManual = document.getElementById('inputManualCoord');
  const btnApply = document.getElementById('btnApplyCoord');

  function applyManualInput() {
    const val = inputManual.value.trim().toUpperCase();
    if (!val) { alert('Vui lòng nhập tọa độ! (VD: B14, D8, K20)'); return; }

    const parsed = window.GameEngine ? window.GameEngine.parseKey(val) : null;
    if (!parsed) {
      alert(`Tọa độ [${val}] không hợp lệ! Tọa độ gồm Cột A-T và Hàng 1-20 (VD: A1, K15, T20).`);
      return;
    }

    selectTargetCoordinate(val);
  }

  btnApply.addEventListener('click', applyManualInput);
  inputManual.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyManualInput();
    }
  });

  // Điều khiển Zoom
  const battleGrid = document.getElementById('battleGrid');
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    currentZoomLevel = Math.min(2.0, currentZoomLevel + 0.25);
    battleGrid.style.transform = `scale(${currentZoomLevel})`;
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    currentZoomLevel = Math.max(0.65, currentZoomLevel - 0.25);
    battleGrid.style.transform = `scale(${currentZoomLevel})`;
  });

  document.getElementById('btnZoomReset').addEventListener('click', () => {
    currentZoomLevel = 1.0;
    battleGrid.style.transform = `scale(1)`;
  });

  // Nút Khai Hỏa Lớn (Tác Chiến)
  btnFire.addEventListener('click', () => {
    if (!selectedTargetKey || !currentRoomId || !myTeamId) return;

    if (currentWeaponMode === 'CROSSFIRE') {
      if (socket && socket.connected) {
        socket.emit('player:crossfire', {
          roomId: currentRoomId,
          teamId: myTeamId,
          centerKey: selectedTargetKey,
        });
      }
      if (window.firebaseSync && window.firebaseSync.isReady) {
        window.firebaseSync.clientSendAction(currentRoomId, {
          type: 'CROSSFIRE',
          teamId: myTeamId,
          centerKey: selectedTargetKey,
        });
      }
      currentWeaponMode = 'NORMAL';
      updateSkillButtonsUI();
    } else {
      // Bắn thường
      if (socket && socket.connected) {
        socket.emit('player:fire', {
          roomId: currentRoomId,
          teamId: myTeamId,
          targetKey: selectedTargetKey,
        });
      }
      if (window.firebaseSync && window.firebaseSync.isReady) {
        window.firebaseSync.clientSendAction(currentRoomId, {
          type: 'FIRE',
          teamId: myTeamId,
          targetKey: selectedTargetKey,
        });
      }
    }

    selectedTargetKey = null;
    document.getElementById('selectedTargetDisplay').textContent = '--';
    btnFire.disabled = true;
  });
}

function buildPlayerStateFromRoomState(roomState, targetTeamId) {
  if (!roomState || !roomState.teams) return roomState;
  const myTeam = roomState.teams.find(t => t.id === targetTeamId);
  return {
    phase: roomState.phase,
    grid: roomState.grid,
    config: roomState.config,
    myTeam: myTeam || null,
    teamsOverview: roomState.teams.map(t => ({
      id: t.id,
      name: t.customName || t.name,
      colorHex: t.colorHex,
      icon: t.icon,
      isBot: t.isBot,
      isConnected: t.isConnected,
      isFleetLocked: t.isFleetLocked,
      shipsRemaining: t.shipsRemaining,
      score: t.score,
      crossfireRemaining: t.crossfireRemaining ?? 1,
      isEliminated: t.isEliminated,
    })),
    turnOrder: roomState.turnOrder || [],
    currentTurnTeamId: roomState.currentTurnTeamId,
    turnNumber: roomState.turnNumber,
    turnTimeRemaining: roomState.turnTimeRemaining || 60,
    turnStartTime: roomState.turnStartTime || Date.now(),
    isMyTurn: roomState.currentTurnTeamId === targetTeamId && myTeam && !myTeam.isEliminated && roomState.phase === 'BATTLE',
    shotsMap: roomState.shotsMap || {},
    lastShotResult: roomState.lastShotResult,
    lastCrossfireRecord: roomState.lastCrossfireRecord,
    winner: roomState.winner,
  };
}
})();
