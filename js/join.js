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
let myDeviceToken = localStorage.getItem('dai_hai_chien_token');
if (!myDeviceToken) {
  myDeviceToken = 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  localStorage.setItem('dai_hai_chien_token', myDeviceToken);
}
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

  window.addEventListener('resize', () => {
    fitPlacementGridToScreen();
    fitBattleGridToScreen();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(fitPlacementGridToScreen, 120);
    setTimeout(fitBattleGridToScreen, 120);
  });

  if (window.ResizeObserver) {
    const pWrap = document.getElementById('placementMapWrapper');
    const bWrap = document.getElementById('mobileMapWrapper');
    if (pWrap) new ResizeObserver(() => fitPlacementGridToScreen()).observe(pWrap);
    if (bWrap) new ResizeObserver(() => fitBattleGridToScreen()).observe(bWrap);
  }

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

  // Cập nhật kích thước hải đồ động nếu có thay đổi từ máy chủ
  const gridCols = (state.grid && state.grid.cols && state.grid.cols.length) || (state.config && state.config.gridCols) || COLS.length;
  const gridRows = (state.grid && state.grid.rows && state.grid.rows.length) || (state.config && state.config.gridRows) || ROWS.length;

  if (gridCols !== COLS.length || gridRows !== ROWS.length) {
    COLS = ALL_LETTERS.slice(0, gridCols);
    ROWS = Array.from({ length: gridRows }, (_, i) => i + 1);
    if (window.GameEngine && window.GameEngine.setGridDimensions) {
      window.GameEngine.setGridDimensions(gridCols, gridRows);
    }
    const pGrid = document.getElementById('placementGrid');
    const bGrid = document.getElementById('battleGrid');
    if (pGrid) {
      buildGridInContainer(pGrid, handlePlacementCellClick);
      fitPlacementGridToScreen();
    }
    if (bGrid) buildGridInContainer(bGrid, handleBattleCellClick);
  } else if (window.GameEngine && window.GameEngine.setGridDimensions) {
    window.GameEngine.setGridDimensions(COLS.length, ROWS.length);
  }

  // CHỈ KHỚP ĐỘI CỦA THIẾT BỊ NÀY KHI:
  // 1. myDeviceToken hợp lệ
  // 2. VÀ team trên Máy Chủ đang kết nối (isConnected === true)
  // 3. VÀ deviceToken của team đó TRÙNG KHỚP với myDeviceToken của máy này
  let myTeam = state.myTeam || null;
  if (myTeam && myTeam.deviceToken && myDeviceToken && myTeam.deviceToken !== myDeviceToken) {
    myTeam = null;
  }
  if (!myTeam && myDeviceToken && state.teamsOverview) {
    const verified = state.teamsOverview.find(t => t.isConnected && t.deviceToken && t.deviceToken === myDeviceToken);
    if (verified) {
      myTeam = verified;
    }
  }

  // Tuyệt đối không nhận vơ đội nếu không khớp token thiết bị
  if (myTeam) {
    myTeamId = myTeam.id;
    state.myTeam = myTeam;
    localStorage.setItem('dai_hai_chien_team_id', myTeam.id);
  } else {
    myTeamId = null;
    state.myTeam = null;
    localStorage.removeItem('dai_hai_chien_team_id');
  }

  // Luôn cập nhật trạng thái danh sách các vị trí đội ở form đăng ký
  if (state.teamsOverview) {
    renderTeamSlots(state.teamsOverview);
  }

  // Cập nhật Header & Badge thông tin hạm đội
  if (myTeam) {
    const titleEl = document.getElementById('headerTeamTitle');
    if (titleEl) {
      titleEl.textContent = myTeam.name || `Chiến Hạm #${myTeam.id}`;
      titleEl.style.color = myTeam.colorHex || '#0284c7';
    }
    const subTitleEl = document.getElementById('headerSubTitle');
    if (subTitleEl) subTitleEl.textContent = `Vị Trí #${myTeam.id}`;

    const badge = document.getElementById('teamBadgeHeader');
    if (badge) {
      badge.style.display = 'inline-flex';
      badge.textContent = `${myTeam.icon || '⚓'} ĐỘI ${myTeam.id}`;
      badge.style.background = `${myTeam.colorHex || '#0284c7'}22`;
      badge.style.color = myTeam.colorHex || '#0284c7';
    }

    const waitTitle = document.getElementById('waitingAssignedShipTitle');
    if (waitTitle) waitTitle.innerHTML = `${myTeam.icon || '⚓'} <b>${myTeam.name}</b>`;
    const waitSub = document.getElementById('waitingAssignedShipSub');
    if (waitSub) waitSub.textContent = `Đã kết nối Vị Trí #${myTeam.id} thành công!`;

    const badgeCrossfire = document.getElementById('badgeCrossfireCount');
    if (badgeCrossfire) badgeCrossfire.textContent = `Còn ${myTeam.crossfireRemaining ?? 1}/1`;

    const btnReady = document.getElementById('btnToggleReady');
    if (btnReady) {
      if (myTeam.isReady) {
        btnReady.textContent = '✓ ĐÃ SẴN SÀNG (CHỜ BẮT ĐẦU)';
        btnReady.className = 'btn btn-outline';
      } else {
        btnReady.textContent = '✓ BẤM SẴN SÀNG';
        btnReady.className = 'btn btn-success';
      }
    }
  }

  // Điều phối View theo Phase & Tình trạng tham gia
  const viewLobby = document.getElementById('viewLobby');
  const viewPlacement = document.getElementById('viewPlacement');
  const viewBattle = document.getElementById('viewBattle');
  const viewFinished = document.getElementById('viewFinished');
  const joinFormArea = document.getElementById('joinFormArea');
  const waitingRoomState = document.getElementById('waitingRoomState');

  // NẾU NGƯỜI CHƠI CHƯA CÓ ĐỘI -> HIỂN THỊ FORM NHẬP TÊN THAM GIA
  if (!myTeam) {
    document.body.classList.remove('mode-placement');
    viewLobby.style.display = 'block';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';
    if (joinFormArea) joinFormArea.style.display = 'block';
    if (waitingRoomState) waitingRoomState.style.display = 'none';
    return;
  }

  // ĐÃ CÓ ĐỘI -> HIỂN THỊ THEO GIAI ĐOẠN TRẬN ĐẤU
  if (state.phase === 'LOBBY') {
    document.body.classList.remove('mode-placement');
    document.body.classList.remove('mode-battle');
    viewLobby.style.display = 'block';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';
    if (joinFormArea) joinFormArea.style.display = 'none';
    if (waitingRoomState) waitingRoomState.style.display = 'block';
  } else if (state.phase === 'PLACEMENT') {
    document.body.classList.remove('mode-battle');
    document.body.classList.add('mode-placement');
    viewLobby.style.display = 'none';
    viewPlacement.style.display = 'flex';
    viewBattle.style.display = 'none';
    viewFinished.style.display = 'none';

    renderPlacementView(state);
    requestAnimationFrame(fitPlacementGridToScreen);
    setTimeout(fitPlacementGridToScreen, 60);
  } else if (state.phase === 'BATTLE') {
    document.body.classList.remove('mode-placement');
    document.body.classList.add('mode-battle');
    viewLobby.style.display = 'none';
    viewPlacement.style.display = 'none';
    viewBattle.style.display = 'flex';
    viewFinished.style.display = 'none';

    renderBattleView(state);
    requestAnimationFrame(fitBattleGridToScreen);
    setTimeout(fitBattleGridToScreen, 60);
  } else if (state.phase === 'FINISHED' || state.phase === 'GAME_OVER') {
    document.body.classList.remove('mode-placement');
    document.body.classList.remove('mode-battle');
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
  if (!container || !teams) return;

  // Nếu slot đang chọn đã bị người khác chiếm (isConnected và không phải deviceToken của mình), bỏ chọn
  if (selectedSlotId) {
    const currentSelected = teams.find(t => t.id === selectedSlotId);
    if (currentSelected && currentSelected.isConnected && currentSelected.deviceToken !== myDeviceToken) {
      selectedSlotId = null;
    }
  }

  // Tự động gợi ý chọn ô trống đầu tiên nếu chưa chọn
  if (!selectedSlotId) {
    const firstAvail = teams.find(t => !t.isConnected && !t.isBot);
    if (firstAvail) {
      selectedSlotId = firstAvail.id;
    }
  }

  const badgeEl = document.getElementById('selectedSlotBadge');
  if (badgeEl) {
    if (selectedSlotId) {
      const sel = teams.find(t => t.id === selectedSlotId);
      badgeEl.textContent = sel ? `Đang chọn: Vị trí #${sel.id}` : 'Tự động chọn ô trống';
    } else {
      badgeEl.textContent = 'Phòng đã kín';
    }
  }

  container.innerHTML = '';
  teams.forEach(t => {
    const isSelected = selectedSlotId !== null && t.id === selectedSlotId;
    const isTaken = t.isConnected && (!t.deviceToken || t.deviceToken !== myDeviceToken);
    const isMine = t.isConnected && t.deviceToken === myDeviceToken;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.slotId = t.id;
    btn.style.padding = '8px 10px';
    btn.style.borderRadius = '8px';
    btn.style.border = isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1';
    btn.style.background = isSelected ? '#e0f2fe' : (isTaken ? '#f1f5f9' : '#ffffff');
    btn.style.cursor = isTaken ? 'not-allowed' : 'pointer';
    btn.style.opacity = isTaken ? '0.6' : '1';
    btn.style.display = 'flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'flex-start';
    btn.style.gap = '2px';
    btn.style.textAlign = 'left';
    btn.style.boxShadow = isSelected ? '0 0 8px rgba(2, 132, 199, 0.4)' : 'none';

    let statusText = '🟢 Trống (Bấm chọn)';
    let statusColor = '#16a34a';
    if (isMine) {
      statusText = '⭐ Đội của bạn';
      statusColor = '#0284c7';
    } else if (isTaken) {
      statusText = `🔴 Đã có: ${t.name || 'Người chơi'}`;
      statusColor = '#dc2626';
    } else if (t.isBot) {
      statusText = '🤖 Máy tự động';
      statusColor = '#64748b';
    }

    btn.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <span style="font-weight: 800; font-size: 0.85rem; color: ${t.colorHex || '#0f172a'};">${t.icon || '⚓'} Vị trí #${t.id}</span>
        ${isSelected ? '<span style="font-size: 0.7rem; font-weight: 900; color: #0284c7;">✓ CHỌN</span>' : ''}
      </div>
      <div style="font-size: 0.72rem; color: ${statusColor}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
        ${statusText}
      </div>
    `;

    if (!isTaken) {
      btn.addEventListener('click', () => {
        selectedSlotId = t.id;
        const nameInput = document.getElementById('inputPlayerName');
        if (nameInput && !nameInput.value.trim()) {
          nameInput.placeholder = `VD: ${t.name || ('Chiến Hạm #' + t.id)}`;
        }
        renderTeamSlots(teams);
      });
    }

    container.appendChild(btn);
  });
}

function handlePlacementCellClick(key) {
  if (!myPlayerState || !myPlayerState.myTeam) return;
  const myTeam = myPlayerState.myTeam;
  if (window.GameEngine) {
    if (window.GameEngine.setGridDimensions) {
      window.GameEngine.setGridDimensions(COLS.length, ROWS.length);
    }
    const shipLengths = (myPlayerState.config && myPlayerState.config.shipLengths) || [4, 3];
    myTeam.isFleetLocked = false;
    myTeam.fleet = window.GameEngine.generateRandomFleetOpenOcean(shipLengths);
    renderPlacementView(myPlayerState);
    if (socket && socket.connected) {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
    }
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId && myTeamId) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'AUTO_PLACE',
        teamId: myTeamId,
        fleet: myTeam.fleet,
        deviceToken: myDeviceToken,
      });
    }
  }
}

function handleBattleCellClick(key) {
  selectTargetCoordinate(key);
}

function fitPlacementGridToScreen() {
  const grid = document.getElementById('placementGrid');
  const wrapper = document.getElementById('placementMapWrapper') || (grid ? grid.parentElement : null);
  if (!wrapper || !grid || wrapper.offsetParent === null) return;

  const numCols = (COLS && COLS.length) ? COLS.length : 20;
  const numRows = (ROWS && ROWS.length) ? ROWS.length : 20;
  if (!numCols || !numRows) return;

  const padW = 4;
  const padH = 4;
  const availW = Math.max(50, (wrapper.clientWidth || wrapper.getBoundingClientRect().width) - padW);
  const availH = Math.max(50, (wrapper.clientHeight || wrapper.getBoundingClientRect().height) - padH);

  // Dynamic header sizes for mobile screen
  const headerColW = Math.max(10, Math.min(20, Math.floor(availW / (numCols + 1.5))));
  const headerRowH = Math.max(10, Math.min(18, Math.floor(availH / (numRows + 1.5))));
  const gap = 1;

  const remainingW = availW - headerColW - (numCols * gap);
  const remainingH = availH - headerRowH - (numRows * gap);

  let cellSize = Math.floor(Math.min(remainingW / numCols, remainingH / numRows));
  cellSize = Math.max(6, cellSize);

  wrapper.style.overflow = 'hidden';
  grid.style.transform = 'none';
  grid.style.minWidth = '0px';
  grid.style.gridTemplateColumns = `${headerColW}px repeat(${numCols}, ${cellSize}px)`;
  grid.style.gridTemplateRows = `${headerRowH}px repeat(${numRows}, ${cellSize}px)`;
  grid.style.gap = `${gap}px`;
  grid.style.width = 'fit-content';
  grid.style.height = 'fit-content';
  grid.style.margin = 'auto';

  // Responsive font size for headers based on cellSize
  const fontSz = Math.max(7, Math.min(11, Math.floor(cellSize * 0.72)));
  grid.querySelectorAll('.ocean-col-header, .ocean-row-header').forEach(h => {
    h.style.fontSize = `${fontSz}px`;
    h.style.lineHeight = `${cellSize}px`;
  });
}

function renderPlacementView(state) {
  const myTeam = state.myTeam;
  if (!myTeam) return;

  const hint = document.getElementById('placementZoneHint');
  if (hint) {
    hint.textContent = 'Chạm ô hoặc bấm nút để đổi vị trí';
  }

  const container = document.getElementById('placementGrid');
  const expectedCells = (COLS.length + 1) * (ROWS.length + 1);
  if (container.children.length !== expectedCells) {
    buildGridInContainer(container, handlePlacementCellClick);
  }

  // Tự động sinh hạm đội ban đầu nếu chưa có tàu hoặc tọa độ nằm ngoài kích thước hải đồ hiện tại
  const shipLengths = (state.config && state.config.shipLengths) || [4, 3];
  let hasOutOfBounds = false;
  if (myTeam.fleet && myTeam.fleet.length > 0) {
    for (const ship of myTeam.fleet) {
      if (!ship.cells || !Array.isArray(ship.cells)) {
        hasOutOfBounds = true;
        break;
      }
      for (const cellKey of ship.cells) {
        if (!container.querySelector(`[data-key="${cellKey}"]`)) {
          hasOutOfBounds = true;
          break;
        }
      }
      if (hasOutOfBounds) break;
    }
  }

  if ((!myTeam.fleet || myTeam.fleet.length === 0 || hasOutOfBounds) && window.GameEngine) {
    if (window.GameEngine.setGridDimensions) {
      window.GameEngine.setGridDimensions(COLS.length, ROWS.length);
    }
    myTeam.fleet = window.GameEngine.generateRandomFleetOpenOcean(shipLengths);
    if (socket && socket.connected) {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
    }
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId && myTeamId) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'UPDATE_FLEET',
        teamId: myTeamId,
        fleet: myTeam.fleet,
        deviceToken: myDeviceToken,
      });
    }
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
        if (partClass) partClass.split(' ').filter(Boolean).forEach(cls => cell.classList.add(cls));
        cell.style.borderColor = myTeam.colorHex;
      });
    });
  }

  const btnLock = document.getElementById('btnLockFleet');
  if (btnLock) {
    if (myTeam.isFleetLocked) {
      btnLock.textContent = '🔒 ĐÃ KHÓA HẠM ĐỘI (CHỜ KHỞI TRANH)';
      btnLock.className = 'btn btn-outline btn-lock-fleet';
      btnLock.disabled = false;
    } else {
      btnLock.textContent = '🔒 KHÓA HẠM ĐỘI & SẴN SÀNG';
      btnLock.className = 'btn btn-success btn-large btn-lock-fleet';
      btnLock.disabled = !myTeam.fleet || myTeam.fleet.length === 0;
    }
  }

  // Căn chỉnh hải đồ vừa trọn vẹn màn hình điện thoại 100% không cuộn
  requestAnimationFrame(fitPlacementGridToScreen);
  setTimeout(fitPlacementGridToScreen, 50);
}

function renderBattleView(state) {
  const myTeam = state.myTeam;
  const isMyTurn = Boolean(
    myTeam &&
    !myTeam.isEliminated &&
    state.phase === 'BATTLE' &&
    parseInt(state.currentTurnTeamId, 10) === parseInt(myTeam.id, 10)
  );
  state.isMyTurn = isMyTurn;

  const banner = document.getElementById('turnBanner');
  const btnFireDirect = document.getElementById('btnFireDirect');
  const activeTeam = state.teamsOverview ? state.teamsOverview.find(t => parseInt(t.id, 10) === parseInt(state.currentTurnTeamId, 10)) : null;

  if (myTeam && myTeam.isEliminated) {
    if (banner) {
      banner.className = 'turn-banner';
      banner.style.background = '#fee2e2';
      banner.style.color = '#dc2626';
      banner.textContent = '☠️ HẠM ĐỘI ĐÃ BỊ HỦY DIỆT (CHẾ ĐỘ KHÁN GIẢ)';
    }
    if (btnFireDirect) btnFireDirect.disabled = true;
    return;
  }

  if (isMyTurn) {
    if (banner) {
      banner.className = 'turn-banner my-turn';
      banner.innerHTML = `🚨 <b>ĐẾN LƯỢT BẠN BẮN!</b> (${myTeam.icon || '⚓'} ${myTeam.name})`;
    }
    if (btnFireDirect && selectedTargetKey) {
      btnFireDirect.disabled = false;
    }
    if (window._lastTurnAlert !== state.turnNumber) {
      window._lastTurnAlert = state.turnNumber;
      if (soundManager) soundManager.playSonar();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
      showTurnToast(`🚨 ĐÃ ĐẾN LƯỢT BẠN BẮN! 🎯`);
    }
  } else {
    if (banner) {
      banner.className = 'turn-banner wait-turn';
      const activeName = activeTeam ? `${activeTeam.icon || '⚓'} ${activeTeam.name}` : `Đội #${state.currentTurnTeamId}`;
      banner.innerHTML = `⏳ LƯỢT: <b style="color: ${activeTeam ? activeTeam.colorHex : '#0284c7'};">${activeName}</b> (Chờ đối thủ...)`;
    }
    if (btnFireDirect) btnFireDirect.disabled = true;
    window._lastTurnAlert = null;
  }

  // Khởi tạo hoặc cập nhật lưới chiến đấu đúng kích thước
  const container = document.getElementById('battleGrid');
  const expectedCells = (COLS.length + 1) * (ROWS.length + 1);
  if (container && container.children.length !== expectedCells) {
    buildGridInContainer(container, (key) => {
      selectTargetCoordinate(key);
    });
  }

  // Cập nhật trạng thái từng ô
  if (container) {
    updateGridCellVisuals(container, state, myTeam);
  }

  // Căn chỉnh hải đồ vừa trọn vẹn màn hình điện thoại 100% không cuộn
  requestAnimationFrame(fitBattleGridToScreen);
  setTimeout(fitBattleGridToScreen, 50);
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
        if (partClass) partClass.split(' ').filter(Boolean).forEach(cls => cell.classList.add(cls));
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

      if (shot.easterEgg || shot.isLuckyCell) {
        cell.innerHTML = '<span style="font-size: 0.85em; z-index: 2;">🎁</span>';
        cell.style.boxShadow = 'inset 0 0 6px #f59e0b';
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

function showTurnToast(msg) {
  let toast = document.getElementById('turnAlertToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'turnAlertToast';
    toast.className = 'turn-alert-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.style.animation = 'toastSlideDown 0.35s ease-out';
  if (window._toastTimeout) clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 2800);
}

function fitBattleGridToScreen() {
  const grid = document.getElementById('battleGrid');
  const wrapper = document.getElementById('mobileMapWrapper') || (grid ? grid.parentElement : null);
  if (!wrapper || !grid || wrapper.offsetParent === null) return;

  const numCols = (COLS && COLS.length) ? COLS.length : 20;
  const numRows = (ROWS && ROWS.length) ? ROWS.length : 20;
  if (!numCols || !numRows) return;

  const padW = 4;
  const padH = 4;
  const availW = Math.max(50, (wrapper.clientWidth || wrapper.getBoundingClientRect().width) - padW);
  const availH = Math.max(50, (wrapper.clientHeight || wrapper.getBoundingClientRect().height) - padH);

  const headerColW = Math.max(10, Math.min(20, Math.floor(availW / (numCols + 1.5))));
  const headerRowH = Math.max(10, Math.min(18, Math.floor(availH / (numRows + 1.5))));
  const gap = 1;

  const remainingW = availW - headerColW - (numCols * gap);
  const remainingH = availH - headerRowH - (numRows * gap);

  let baseCellSize = Math.floor(Math.min(remainingW / numCols, remainingH / numRows));
  baseCellSize = Math.max(6, baseCellSize);

  // Khi Zoom <= 1.0: Tự động khóa toàn màn hình 100%, không cần vuốt lên xuống
  if (currentZoomLevel <= 1.0) {
    currentZoomLevel = 1.0;
    wrapper.style.overflow = 'hidden';
    grid.style.transform = 'none';
    grid.style.minWidth = '0px';
    grid.style.gridTemplateColumns = `${headerColW}px repeat(${numCols}, ${baseCellSize}px)`;
    grid.style.gridTemplateRows = `${headerRowH}px repeat(${numRows}, ${baseCellSize}px)`;
    grid.style.gap = `${gap}px`;
    grid.style.width = 'fit-content';
    grid.style.height = 'fit-content';
    grid.style.margin = 'auto';

    const fontSz = Math.max(7, Math.min(11, Math.floor(baseCellSize * 0.72)));
    grid.querySelectorAll('.ocean-col-header, .ocean-row-header').forEach(h => {
      h.style.fontSize = `${fontSz}px`;
      h.style.lineHeight = `${baseCellSize}px`;
    });
  } else {
    // Khi phóng to (> 1.0): Cho phép cuộn tự do bên trong khung hải đồ với kích thước ô sắc nét
    wrapper.style.overflow = 'auto';
    const zoomedCellSize = Math.max(baseCellSize, Math.round(baseCellSize * currentZoomLevel));
    const zoomedColW = Math.max(headerColW, Math.round(headerColW * currentZoomLevel));
    const zoomedRowH = Math.max(headerRowH, Math.round(headerRowH * currentZoomLevel));

    grid.style.transform = 'none';
    grid.style.minWidth = '0px';
    grid.style.gridTemplateColumns = `${zoomedColW}px repeat(${numCols}, ${zoomedCellSize}px)`;
    grid.style.gridTemplateRows = `${zoomedRowH}px repeat(${numRows}, ${zoomedCellSize}px)`;
    grid.style.gap = `${gap}px`;
    grid.style.width = 'fit-content';
    grid.style.height = 'fit-content';
    grid.style.margin = '0 auto';

    const fontSz = Math.max(8, Math.min(16, Math.floor(zoomedCellSize * 0.68)));
    grid.querySelectorAll('.ocean-col-header, .ocean-row-header').forEach(h => {
      h.style.fontSize = `${fontSz}px`;
      h.style.lineHeight = `${zoomedRowH}px`;
    });
  }
}

function executeFireAction(targetKey) {
  const coord = targetKey || selectedTargetKey;
  if (!coord || !currentRoomId) return;

  const effectiveTeamId = myTeamId || (myPlayerState && myPlayerState.myTeam ? myPlayerState.myTeam.id : null);
  if (!effectiveTeamId) {
    alert('Không tìm thấy thông tin đội của bạn.');
    return;
  }

  if (!myPlayerState || !myPlayerState.isMyTurn) {
    alert('⏳ Chưa đến lượt bắn của bạn! Vui lòng chờ đối thủ.');
    return;
  }

  if (myPlayerState.shotsMap && myPlayerState.shotsMap[coord] && myPlayerState.shotsMap[coord].result !== 'PENDING') {
    alert('Tọa độ này đã bị bắn trước đó! Hãy chọn ô khác.');
    return;
  }

  // 🚀 Phản hồi tức thì 0ms (Zero-Latency Feedback)
  const cell = document.getElementById(`cell-${coord}`);
  if (cell) {
    cell.classList.add('firing-pulse');
  }
  if (soundManager) soundManager.playMissile();
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);

  const disp = document.getElementById('selectedTargetDisplay');
  if (disp) disp.textContent = coord;
  const txt = document.getElementById('selectedTargetText');
  if (txt) {
    txt.innerHTML = `🚀 <b style="color: #dc2626;">ĐÃ KHAI HỎA [${coord}]!</b> Đang công phá...`;
  }

  const btnFireDirect = document.getElementById('btnFireDirect');
  if (btnFireDirect) btnFireDirect.disabled = true;

  if (!myPlayerState.shotsMap) myPlayerState.shotsMap = {};
  myPlayerState.shotsMap[coord] = {
    result: 'PENDING',
    targetKey: coord,
    shooterTeamId: effectiveTeamId,
    timestamp: Date.now(),
  };

  if (currentWeaponMode === 'CROSSFIRE') {
    if (socket && socket.connected) {
      socket.emit('player:crossfire', {
        roomId: currentRoomId,
        teamId: effectiveTeamId,
        centerKey: coord,
      });
    }
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'CROSSFIRE',
        teamId: effectiveTeamId,
        centerKey: coord,
      });
    }
    currentWeaponMode = 'NORMAL';
    updateSkillButtonsUI();
  } else {
    // Bắn thường
    if (socket && socket.connected) {
      socket.emit('player:fire', {
        roomId: currentRoomId,
        teamId: effectiveTeamId,
        targetKey: coord,
      });
    }
    if (window.firebaseSync && window.firebaseSync.isReady) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'FIRE',
        teamId: effectiveTeamId,
        targetKey: coord,
      });
    }
  }

  selectedTargetKey = null;

  const container = document.getElementById('battleGrid');
  if (container && myPlayerState) {
    updateGridCellVisuals(container, myPlayerState, myPlayerState.myTeam);
  }
}

function selectTargetCoordinate(key) {
  if (!myPlayerState || !myPlayerState.isMyTurn) {
    const txt = document.getElementById('selectedTargetText');
    if (txt) {
      const activeTeam = myPlayerState && myPlayerState.teamsOverview ? myPlayerState.teamsOverview.find(t => parseInt(t.id, 10) === parseInt(myPlayerState.currentTurnTeamId, 10)) : null;
      const activeName = activeTeam ? `${activeTeam.icon || '⚓'} ${activeTeam.name}` : `Đội #${myPlayerState.currentTurnTeamId}`;
      txt.innerHTML = `⏳ <b style="color: #64748b;">Chưa đến lượt!</b> Đang chờ ${activeName}...`;
    }
    return;
  }

  if (currentWeaponMode === 'NORMAL' && myPlayerState.shotsMap && myPlayerState.shotsMap[key] && myPlayerState.shotsMap[key].result !== 'PENDING') {
    alert('Tọa độ này đã bị bắn trước đó! Hãy chọn ô khác.');
    return;
  }

  // 🔥 NHẤN 2 LẦN VÀO CÙNG 1 Ô -> KHAI HỎA BẮN NGAY LẬP TỨC!
  if (selectedTargetKey === key) {
    executeFireAction(key);
    return;
  }

  // Lần chạm đầu tiên: Nhắm ô
  selectedTargetKey = key;
  const disp = document.getElementById('selectedTargetDisplay');
  if (disp) disp.textContent = key;
  const btnFireDirect = document.getElementById('btnFireDirect');
  if (btnFireDirect) btnFireDirect.disabled = false;

  const txt = document.getElementById('selectedTargetText');
  if (txt) {
    txt.innerHTML = `<span style="color:#dc2626; font-weight:900;">[${key}]</span> <b>Chạm lần nữa hoặc bấm [🔥 BẮN]!</b>`;
  }

  const inputManual = document.getElementById('inputManualCoord');
  if (inputManual) inputManual.value = key;

  if (navigator.vibrate) navigator.vibrate(30);

  // Cập nhật lại hình ảnh ô trên bản đồ
  const container = document.getElementById('battleGrid');
  if (container && myPlayerState) {
    updateGridCellVisuals(container, myPlayerState, myPlayerState.myTeam);
  }
}

function renderMyFleetStatus(myTeam) {
  // Đã tối ưu loại bỏ danh sách thẻ để mở rộng tối đa không gian cho hải đồ
}

function buildGridInContainer(container, onClickCell) {
  container.innerHTML = '';
  container.style.minWidth = '0px';

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
        let lastTouchTime = 0;
        cell.addEventListener('touchend', (e) => {
          lastTouchTime = Date.now();
          e.preventDefault();
          onClickCell(key);
        }, { passive: false });

        cell.addEventListener('click', (e) => {
          if (Date.now() - lastTouchTime < 450) return;
          onClickCell(key);
        });
      }

      container.appendChild(cell);
    }
  }

  if (container.id === 'placementGrid') {
    requestAnimationFrame(fitPlacementGridToScreen);
  } else if (container.id === 'battleGrid') {
    requestAnimationFrame(fitBattleGridToScreen);
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
  const joinTeamAction = () => {
    const inputEl = document.getElementById('inputPlayerName');
    let name = (inputEl && inputEl.value.trim()) ? inputEl.value.trim() : '';

    if (!name && selectedSlotId && myPlayerState && myPlayerState.teamsOverview) {
      const targetTeam = myPlayerState.teamsOverview.find(t => t.id === selectedSlotId);
      if (targetTeam && targetTeam.name && !targetTeam.name.startsWith('Ô Trống')) {
        name = targetTeam.name;
      }
    }
    if (!name) {
      name = `Chiến Hạm #${selectedSlotId || 1}`;
    }

    if (!myDeviceToken) {
      myDeviceToken = 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('dai_hai_chien_token', myDeviceToken);
    }
    localStorage.setItem('dai_hai_chien_name', name);

    const joinFormArea = document.getElementById('joinFormArea');
    if (joinFormArea) joinFormArea.style.display = 'none';
    const waitingEl = document.getElementById('waitingRoomState');
    if (waitingEl) waitingEl.style.display = 'block';

    const waitTitle = document.getElementById('waitingAssignedShipTitle');
    if (waitTitle) waitTitle.innerHTML = `🚢 <b>${name}</b>`;
    const waitSub = document.getElementById('waitingAssignedShipSub');
    waitSub.textContent = `Đang kết nối vào Vị trí #${selectedSlotId || 'trống'} trên Máy Chủ...`;

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
  };

  const btnJoinEl = document.getElementById('btnJoinTeam');
  if (btnJoinEl) {
    btnJoinEl.addEventListener('click', joinTeamAction);
  }

  const inputNameEl = document.getElementById('inputPlayerName');
  if (inputNameEl) {
    inputNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        joinTeamAction();
      }
    });
  }

  // Nút Đổi Tên / Đổi Vị Trí Đội
  const btnChangeTeam = document.getElementById('btnChangeTeam');
  if (btnChangeTeam) {
    btnChangeTeam.addEventListener('click', () => {
      const joinFormArea = document.getElementById('joinFormArea');
      const waitingEl = document.getElementById('waitingRoomState');
      if (joinFormArea) joinFormArea.style.display = 'block';
      if (waitingEl) waitingEl.style.display = 'none';

      const inputEl = document.getElementById('inputPlayerName');
      if (inputEl && myPlayerState && myPlayerState.myTeam) {
        inputEl.value = myPlayerState.myTeam.name || '';
        inputEl.focus();
      }

      if (myPlayerState && myPlayerState.teamsOverview) {
        renderTeamSlots(myPlayerState.teamsOverview);
      }
    });
  }

  // Nút Rời Phòng / Hủy Đội
  const btnLeaveRoom = document.getElementById('btnLeaveRoom');
  if (btnLeaveRoom) {
    btnLeaveRoom.addEventListener('click', () => {
      if (!confirm('Bạn có chắc chắn muốn rời phòng và hủy vị trí chiến hạm này?')) return;

      if (myTeamId) {
        if (socket && socket.connected) {
          socket.emit('player:leave', { roomId: currentRoomId, teamId: myTeamId, deviceToken: myDeviceToken });
        }
        if (window.firebaseSync && window.firebaseSync.isReady) {
          window.firebaseSync.clientSendAction(currentRoomId, {
            type: 'LEAVE',
            teamId: myTeamId,
            deviceToken: myDeviceToken,
          });
        }
      }

      myTeamId = null;
      selectedSlotId = null;
      localStorage.removeItem('dai_hai_chien_team_id');

      const joinFormArea = document.getElementById('joinFormArea');
      const waitingEl = document.getElementById('waitingRoomState');
      if (joinFormArea) joinFormArea.style.display = 'block';
      if (waitingEl) waitingEl.style.display = 'none';

      if (myPlayerState && myPlayerState.teamsOverview) {
        renderTeamSlots(myPlayerState.teamsOverview);
      }
    });
  }

  // Nút Sẵn Sàng (Lobby)
  const btnToggleReady = document.getElementById('btnToggleReady');
  if (btnToggleReady) {
    btnToggleReady.addEventListener('click', () => {
      if (!currentRoomId || !myTeamId) return;
      btnToggleReady.innerHTML = '✓ ĐÃ BÁO SẴN SÀNG (CHỜ MÁY CHỦ BẮT ĐẦU)';
      btnToggleReady.style.background = '#059669';
      btnToggleReady.style.color = '#ffffff';

      if (socket && socket.connected) {
        socket.emit('player:ready', { roomId: currentRoomId, teamId: myTeamId });
      }
      if (window.firebaseSync && window.firebaseSync.isReady) {
        window.firebaseSync.clientSendAction(currentRoomId, { type: 'READY', teamId: myTeamId });
      }
    });
  }

  // Nút Xếp Tàu Tự Động (Placement)
  document.getElementById('btnAutoPlace').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId) return;
    if (myPlayerState && myPlayerState.myTeam && window.GameEngine) {
      if (window.GameEngine.setGridDimensions) {
        window.GameEngine.setGridDimensions(COLS.length, ROWS.length);
      }
      const shipLengths = (myPlayerState.config && myPlayerState.config.shipLengths) || [4, 3];
      myPlayerState.myTeam.isFleetLocked = false;
      myPlayerState.myTeam.fleet = window.GameEngine.generateRandomFleetOpenOcean(shipLengths);
      renderPlacementView(myPlayerState);
    }
    if (socket && socket.connected) {
      socket.emit('player:auto_place', { roomId: currentRoomId, teamId: myTeamId });
    }
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId && myTeamId) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: 'AUTO_PLACE',
        teamId: myTeamId,
        fleet: myPlayerState && myPlayerState.myTeam ? myPlayerState.myTeam.fleet : null,
        deviceToken: myDeviceToken,
      });
    }
  });

  // Nút Khóa Hạm Đội (Placement)
  document.getElementById('btnLockFleet').addEventListener('click', () => {
    if (!currentRoomId || !myTeamId || !myPlayerState || !myPlayerState.myTeam) return;
    const myTeam = myPlayerState.myTeam;
    // Đảo trạng thái khóa hạm đội
    myTeam.isFleetLocked = !myTeam.isFleetLocked;
    renderPlacementView(myPlayerState);

    const fleet = myTeam.fleet;
    if (socket && socket.connected) {
      socket.emit('player:lock_fleet', { roomId: currentRoomId, teamId: myTeamId, fleet });
    }
    if (window.firebaseSync && window.firebaseSync.isReady && currentRoomId && myTeamId) {
      window.firebaseSync.clientSendAction(currentRoomId, {
        type: myTeam.isFleetLocked ? 'LOCK_FLEET' : 'UPDATE_FLEET',
        teamId: myTeamId,
        fleet,
        deviceToken: myDeviceToken,
      });
    }
  });

  // Nút Kỹ Năng / Vũ Khí
  const btnSkillNormal = document.getElementById('btnSkillNormal');
  const btnSkillCrossfire = document.getElementById('btnSkillCrossfire');

  function updateSkillButtonsUI() {
    if (btnSkillNormal) btnSkillNormal.className = currentWeaponMode === 'NORMAL' ? 'btn btn-primary' : 'btn btn-outline';
    if (btnSkillCrossfire) btnSkillCrossfire.className = currentWeaponMode === 'CROSSFIRE' ? 'btn btn-primary' : 'btn btn-outline';

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

  // Nhập Tọa Độ Nhanh & Bắn
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

    if (currentWeaponMode === 'NORMAL' && myPlayerState && myPlayerState.shotsMap && myPlayerState.shotsMap[val]) {
      alert('Tọa độ này đã bị bắn trước đó! Hãy chọn ô khác.');
      return;
    }

    // Bắn thẳng tọa độ đã nhập
    executeFireAction(val);
  }

  if (btnApply) btnApply.addEventListener('click', applyManualInput);
  if (inputManual) {
    inputManual.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyManualInput();
      }
    });
  }

  // Nút Khai Hỏa Trực Tiếp
  const btnFireDirect = document.getElementById('btnFireDirect');
  if (btnFireDirect) {
    btnFireDirect.addEventListener('click', () => {
      if (!selectedTargetKey) {
        alert('Vui lòng chạm vào một ô trên hải đồ để chọn tọa độ trước khi bấm Bắn!');
        return;
      }
      executeFireAction(selectedTargetKey);
    });
  }

  // Điều khiển Zoom Hải đồ
  const btnZoomIn = document.getElementById('btnZoomIn');
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      currentZoomLevel = Math.min(2.5, currentZoomLevel + 0.35);
      fitBattleGridToScreen();
    });
  }

  const btnZoomOut = document.getElementById('btnZoomOut');
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      currentZoomLevel = Math.max(1.0, currentZoomLevel - 0.35);
      fitBattleGridToScreen();
    });
  }

  const btnZoomReset = document.getElementById('btnZoomReset');
  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', () => {
      currentZoomLevel = 1.0;
      fitBattleGridToScreen();
    });
  }
}

function buildPlayerStateFromRoomState(roomState, targetTeamId) {
  if (!roomState || !roomState.teams) return roomState;

  let myTeam = null;
  if (myDeviceToken) {
    myTeam = roomState.teams.find(t => t.isConnected && t.deviceToken && t.deviceToken === myDeviceToken);
  }
  if (myTeam) {
    myTeamId = myTeam.id;
    localStorage.setItem('dai_hai_chien_team_id', myTeam.id);
  } else {
    myTeamId = null;
    localStorage.removeItem('dai_hai_chien_team_id');
  }
  const effectiveTeamId = myTeam ? myTeam.id : null;

  return {
    phase: roomState.phase,
    grid: roomState.grid,
    config: roomState.config,
    myTeam: myTeam || null,
    teamsOverview: roomState.teams.map(t => ({
      id: t.id,
      name: t.customName || t.name,
      colorHex: t.colorHex,
      colorName: t.colorName,
      icon: t.icon,
      isBot: t.isBot,
      isConnected: t.isConnected,
      deviceToken: t.deviceToken,
      isFleetLocked: t.isFleetLocked,
      isReady: t.isReady,
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
    isMyTurn: Boolean(
      myTeam &&
      !myTeam.isEliminated &&
      roomState.phase === 'BATTLE' &&
      effectiveTeamId &&
      parseInt(roomState.currentTurnTeamId, 10) === parseInt(effectiveTeamId, 10)
    ),
    shotsMap: roomState.shotsMap || {},
    lastShotResult: roomState.lastShotResult,
    lastCrossfireRecord: roomState.lastCrossfireRecord,
    winner: roomState.winner,
  };
}
})();
