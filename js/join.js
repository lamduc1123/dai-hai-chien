// public/js/join.js
// Logic giao diện điện thoại người chơi: Tối giản, tập trung vào bản đồ, dàn trận và ngắm bắn

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let socket = null;
let currentRoomId = null;
let myTeamId = null;
let myDeviceToken = localStorage.getItem('dai_hai_chien_token') || null;
let myPlayerState = null;
let soundManager = null;

let selectedSlotId = null;
let selectedTargetKey = null;

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  const urlParams = new URLSearchParams(window.location.search);
  currentRoomId = urlParams.get('room') || 'PHONG-01';

  initSocket();
  initEventListeners();

  if (window.firebaseSync && window.firebaseSync.init() && currentRoomId) {
    window.firebaseSync.clientSubscribeState(currentRoomId, (roomState) => {
      if (roomState) {
        const pState = buildPlayerStateFromRoomState(roomState, myTeamId);
        updatePlayerUI(pState);
      }
    });

    window.firebaseSync.clientSubscribeShotEffect(currentRoomId, (shot) => {
      if (shot.shooterTeamId === myTeamId) {
        soundManager.playMissile();
      }
      if (shot.result === 'HIT' || shot.result === 'SUNK') {
        soundManager.playHit();
      } else {
        soundManager.playMiss();
      }
    });
  }
});

function initSocket() {
  socket = io();

  // Yêu cầu thông tin phòng ban đầu
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

  socket.on('battle:shot_fired', (shot) => {
    if (shot.shooterTeamId === myTeamId) {
      soundManager.playMissile();
    }
    if (shot.result === 'HIT' || shot.result === 'SUNK') {
      soundManager.playHit();
    } else {
      soundManager.playMiss();
    }
  });
}

function updatePlayerUI(state) {
  if (!state) return;
  myPlayerState = state;

  const myTeam = state.myTeam;
  if (myTeam) {
    // Cập nhật Header
    document.getElementById('headerTeamTitle').textContent = myTeam.name;
    document.getElementById('headerTeamTitle').style.color = myTeam.colorHex;
    document.getElementById('headerSubTitle').textContent = `Chiến Hạm #${myTeam.id}`;

    const badge = document.getElementById('teamBadgeHeader');
    badge.style.display = 'inline-flex';
    badge.textContent = `${myTeam.icon} ĐỘI ${myTeam.id}`;
    badge.style.background = `${myTeam.colorHex}22`;
    badge.style.color = myTeam.colorHex;

    // Nút Sẵn Sàng ở sảnh chờ
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

  // 1. Điều phối View theo Phase
  const viewLobby = document.getElementById('viewLobby');
  const viewPlacement = document.getElementById('viewPlacement');
  const viewBattle = document.getElementById('viewBattle');
  const viewFinished = document.getElementById('viewFinished');

  if (state.phase === 'LOBBY') {
    viewLobby.style.display = 'block';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';

    renderTeamSlots(state.teamsOverview || []);
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
  } else if (state.phase === 'FINISHED') {
    viewLobby.style.display = 'none';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'block';

    if (state.winner) {
      const isWinnerMe = myTeam && state.winner.id === myTeam.id;
      document.getElementById('winnerAnnounceText').innerHTML = isWinnerMe
        ? '🎉 XIN CHÚC MỪNG! HẠM ĐỘI CỦA BẠN ĐÃ CHIẾN THẮNG QUÁN QUÂN!'
        : `🏆 ĐỘI CHIẾN THẮNG: <b>${state.winner.name}</b>`;
    }
  }
}

function renderTeamSlots(teams) {
  const container = document.getElementById('teamSlotsContainer');
  if (!container || myTeamId) return;

  container.innerHTML = '';
  teams.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `slot-btn ${selectedSlotId === t.id ? 'selected' : ''}`;
    if (t.isConnected && (!myPlayerState || !myPlayerState.myTeam || myPlayerState.myTeam.id !== t.id)) {
      btn.classList.add('taken');
      btn.disabled = true;
    }

    btn.innerHTML = `
      <span style="font-size: 1.2rem;">${t.icon}</span>
      <div style="flex: 1;">
        <div style="font-weight: 800; color: ${t.colorHex};">${t.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${t.isConnected ? 'Đã có người vào' : 'Đang trống (Chọn đội này)'}</div>
      </div>
    `;

    btn.addEventListener('click', () => {
      selectedSlotId = t.id;
      renderTeamSlots(teams);
    });

    container.appendChild(btn);
  });
}

/**
 * Render Giao diện Dàn Trận (Placement)
 */
function renderPlacementView(state) {
  const myTeam = state.myTeam;
  if (!myTeam || !myTeam.zone) return;

  document.getElementById('placementZoneHint').textContent =
    `Vùng của bạn: [${myTeam.zone.colStart}${myTeam.zone.rowStart} - ${myTeam.zone.colEnd}${myTeam.zone.rowEnd}] (${myTeam.zone.cells.length} ô)`;

  const container = document.getElementById('placementGrid');
  if (container.children.length === 0) {
    buildGridInContainer(container, (key) => {
      // Khi bấm vào ô trong phân vùng
      console.log('Chạm vào ô dàn trận:', key);
    });
  }

  // Highlight phân vùng được phép đặt tàu
  const zoneSet = new Set(myTeam.zone.cells);
  const cells = container.querySelectorAll('.ocean-cell');
  cells.forEach(c => {
    const k = c.dataset.key;
    c.className = 'ocean-cell';
    c.style.backgroundColor = '';
    c.style.borderColor = '';

    if (zoneSet.has(k)) {
      c.classList.add('zone-highlight');
      c.style.backgroundColor = `${myTeam.colorHex}20`;
      c.style.borderColor = `${myTeam.colorHex}77`;
    } else {
      c.classList.add('disabled');
      c.style.opacity = '0.35';
    }
  });

  // Hiển thị vị trí tàu đã xếp của mình
  if (myTeam.fleet && myTeam.fleet.length > 0) {
    myTeam.fleet.forEach(ship => {
      ship.cells.forEach(k => {
        const el = container.querySelector(`[data-key="${k}"]`);
        if (el) {
          el.classList.add('has-ship');
          el.style.backgroundColor = myTeam.colorHex;
          el.style.color = '#ffffff';
        }
      });
    });
  }

  // Khóa nút nếu đã khóa hạm đội
  const btnLock = document.getElementById('btnLockFleet');
  if (myTeam.isFleetLocked) {
    btnLock.disabled = true;
    btnLock.textContent = '🔒 ĐÃ KHÓA HẠM ĐỘI (CHỜ TRẬN ĐẤU BẮT ĐẦU)';
  } else {
    btnLock.disabled = false;
    btnLock.textContent = '🔒 KHÓA HẠM ĐỘI & SẴN SÀNG';
  }
}

/**
 * Render Giao diện Chiến Đấu (Battle)
 */
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
    banner.textContent = '🚨 ĐẾN LƯỢT CHỈ HUY! HÃY CHỌN Ô ĐỂ KHAI HỎA!';
    // Rung phản hồi haptic
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

  // Khởi tạo lưới chiến đấu nếu chưa có
  const container = document.getElementById('battleGrid');
  if (container.children.length === 0) {
    buildGridInContainer(container, (key) => {
      onCellClickBattle(key);
    });
  }

  // Cập nhật trạng thái ô
  const cells = container.querySelectorAll('.ocean-cell');
  cells.forEach(c => {
    const k = c.dataset.key;
    c.className = 'ocean-cell';
    c.innerHTML = '';
    c.style.backgroundColor = '';
    c.style.borderColor = '';

    // 1. Ô của tàu mình (chỉ mình nhìn thấy)
    if (myTeam && myTeam.fleet) {
      for (const ship of myTeam.fleet) {
        if (ship.cells.includes(k)) {
          c.classList.add('has-ship');
          c.style.borderColor = myTeam.colorHex;
          break;
        }
      }
    }

    // 2. Ô đã bắn trên đại hải đồ
    if (state.shotsMap && state.shotsMap[k]) {
      const shot = state.shotsMap[k];
      if (shot.result === 'MISS') {
        c.classList.add('shot-miss');
      } else if (shot.result === 'HIT') {
        c.classList.add('shot-hit');
      } else if (shot.result === 'SUNK') {
        c.classList.add('shot-sunk');
      }
    }

    // 3. Ô đang được chọn
    if (k === selectedTargetKey) {
      c.classList.add('selected-target');
    }
  });

  // Cập nhật danh sách tàu của mình
  renderMyFleetStatus(myTeam);
}

function onCellClickBattle(key) {
  if (!myPlayerState || !myPlayerState.isMyTurn) return;

  // Nếu ô này đã bị bắn rồi thì không chọn
  if (myPlayerState.shotsMap && myPlayerState.shotsMap[key]) {
    alert('Tọa độ này đã bị bắn trước đó! Hãy chọn ô khác.');
    return;
  }

  selectedTargetKey = key;
  document.getElementById('selectedTargetDisplay').textContent = key;
  document.getElementById('selectedTargetText').textContent = `Tọa độ xác định: Cột ${key[0]}, Hàng ${key.substring(1)}`;
  document.getElementById('btnFire').disabled = false;

  // Cập nhật highlight trên lưới
  const container = document.getElementById('battleGrid');
  container.querySelectorAll('.ocean-cell').forEach(c => {
    if (c.dataset.key === key) {
      c.classList.add('selected-target');
    } else {
      c.classList.remove('selected-target');
    }
  });
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

  // 1. Góc
  const corner = document.createElement('div');
  corner.className = 'ocean-header-corner';
  container.appendChild(corner);

  // 2. Tiêu đề Cột
  for (let c = 0; c < COLS.length; c++) {
    const colHeader = document.createElement('div');
    colHeader.className = 'ocean-col-header';
    colHeader.textContent = COLS[c];
    container.appendChild(colHeader);
  }

  // 3. Hàng & Các ô
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
      cell.dataset.key = key;

      cell.addEventListener('click', () => {
        if (onClickCell) onClickCell(key);
      });

      container.appendChild(cell);
    }
  }
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
    socket.emit('player:ready', { roomId: currentRoomId, teamId: myTeamId });
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, { type: 'READY', teamId: myTeamId });
    }
  });

  // Nút Xếp Tàu Tự Động (Placement)
  document.getElementById('btnAutoPlace').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId) return;
    socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, { type: 'AUTO_PLACE', teamId: myTeamId });
    }
  });

  // Nút Khóa Hạm Đội (Placement)
  document.getElementById('btnLockFleet').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId) return;
    if (!myPlayerState || !myPlayerState.myTeam || !myPlayerState.myTeam.fleet || myPlayerState.myTeam.fleet.length === 0) {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
      if (window.firebaseSync && window.firebaseSync.isReady) {
        window.firebaseSync.clientSendAction(currentRoomId, { type: 'AUTO_PLACE', teamId: myTeamId });
      }
    } else {
      socket.emit('player:lock_fleet', {
        roomId: currentRoomId,
        teamId: myTeamId,
        fleet: myPlayerState.myTeam.fleet,
      });
      if (window.firebaseSync && window.firebaseSync.isReady) {
        window.firebaseSync.clientSendAction(currentRoomId, {
          type: 'LOCK_FLEET',
          teamId: myTeamId,
          fleet: myPlayerState.myTeam.fleet,
        });
      }
    }
  });

  // Nút Khai Hỏa (Battle)
  document.getElementById('btnFire').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId || !selectedTargetKey) return;
    socket.emit('player:fire', {
      roomId: currentRoomId,
      teamId: myTeamId,
      targetKey: selectedTargetKey,
    });

    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'FIRE',
        teamId: myTeamId,
        targetKey: selectedTargetKey,
      });
    }

    selectedTargetKey = null;
    document.getElementById('selectedTargetDisplay').textContent = '--';
    document.getElementById('btnFire').disabled = true;
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
      isEliminated: t.isEliminated,
    })),
    turnOrder: roomState.turnOrder || [],
    currentTurnTeamId: roomState.currentTurnTeamId,
    turnNumber: roomState.turnNumber,
    isMyTurn: roomState.currentTurnTeamId === targetTeamId && myTeam && !myTeam.isEliminated && roomState.phase === 'BATTLE',
    shotsMap: roomState.shotsMap || {},
    lastShotResult: roomState.lastShotResult,
    winner: roomState.winner,
  };
}
