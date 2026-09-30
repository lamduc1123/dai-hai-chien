// public/js/screen.js
// Logic hiển thị Màn hình lớn máy chiếu (TV / Projector) thuần Tiếng Việt 100%
// Hải đồ 20x20 (400 ô), Đếm ngược 60s, Kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+), Bảng xếp hạng Live

(() => {
const ALL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
let COLS = ALL_LETTERS.slice(0, 20);
let ROWS = Array.from({ length: 20 }, (_, i) => i + 1);

let socket = null;
let currentRoomId = null;
let currentScreenState = null;
let soundManager = null;
let turnTickerInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  const urlParams = new URLSearchParams(window.location.search);
  currentRoomId = urlParams.get('room') || 'PHONG-01';
  document.getElementById('projRoomCode').textContent = currentRoomId;

  initFirebase();
  initSocket();
  initGrid();
  initEvents();
  loadNetworkAndQR();
  startScreenTurnTicker();

  window.addEventListener('resize', fitProjectorGridToScreen);
});

function initFirebase() {
  if (window.firebaseSync && window.firebaseSync.init()) {
    window.firebaseSync.clientSubscribeState(currentRoomId, (state) => {
      if (state) renderScreenState(state);
    });
    window.firebaseSync.clientSubscribeShotEffect(currentRoomId, (effect) => {
      if (!effect) return;
      if (effect.actionType === 'RADAR') {
        handleProjectorRadar(effect);
      } else if (effect.actionType === 'CROSSFIRE') {
        handleProjectorCrossfire(effect);
      } else {
        handleProjectorShot(effect);
      }
    });
  }
}

function initSocket() {
  try {
    socket = io({ timeout: 2500, reconnectionAttempts: 3 });

    socket.emit('screen:register', { roomId: currentRoomId });

    socket.on('screen:registered', (data) => {
      currentRoomId = data.roomId;
      document.getElementById('projRoomCode').textContent = currentRoomId;
      renderScreenState(data.state);
    });

    socket.on('screen:state_update', (state) => {
      renderScreenState(state);
    });

    socket.on('battle:shot_fired', (shot) => {
      handleProjectorShot(shot);
    });

    socket.on('phase:changed', ({ phase }) => {
      if (phase === 'BATTLE') {
        soundManager.playAlarm();
      }
    });
  } catch (err) {
    console.log('Chế độ Standalone Projector Screen');
  }
}

function fitProjectorGridToScreen() {
  const container = document.getElementById('projOceanGrid');
  const wrapper = container ? container.parentElement : null;
  if (!wrapper || !container) return;

  const numCols = COLS.length;
  const numRows = ROWS.length;
  if (!numCols || !numRows) return;

  const rect = wrapper.getBoundingClientRect();
  const pad = 8;
  const availW = Math.max(100, rect.width - pad);
  const availH = Math.max(100, rect.height - pad);

  const headerColW = Math.max(18, Math.min(26, Math.floor(availW / (numCols + 1))));
  const headerRowH = Math.max(16, Math.min(24, Math.floor(availH / (numRows + 1))));
  const gap = 2;

  const remainingW = availW - headerColW - (numCols * gap);
  const remainingH = availH - headerRowH - (numRows * gap);

  let cellSize = Math.floor(Math.min(remainingW / numCols, remainingH / numRows));
  cellSize = Math.max(8, cellSize);

  container.style.gridTemplateColumns = `${headerColW}px repeat(${numCols}, ${cellSize}px)`;
  container.style.gridTemplateRows = `${headerRowH}px repeat(${numRows}, ${cellSize}px)`;
  container.style.width = `${headerColW + numCols * cellSize + numCols * gap}px`;
  container.style.height = `${headerRowH + numRows * cellSize + numRows * gap}px`;

  const fontSize = Math.max(7, Math.min(14, Math.floor(cellSize * 0.42)));
  container.style.setProperty('--cell-size', `${cellSize}px`);
  container.style.setProperty('--cell-font-size', `${fontSize}px`);
}

function initGrid() {
  const container = document.getElementById('projOceanGrid');
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
      cell.id = `proj-cell-${key}`;
      cell.dataset.key = key;

      container.appendChild(cell);
    }
  }

  fitProjectorGridToScreen();
}

function renderScreenState(state) {
  if (!state) return;
  currentScreenState = state;

  if (state.grid && state.grid.cols && state.grid.rows) {
    if (state.grid.cols.length !== COLS.length || state.grid.rows.length !== ROWS.length) {
      COLS = [...state.grid.cols];
      ROWS = [...state.grid.rows];
      initGrid();
    }
  } else if (state.config && state.config.gridCols && state.config.gridRows) {
    if (state.config.gridCols !== COLS.length || state.config.gridRows !== ROWS.length) {
      COLS = ALL_LETTERS.slice(0, state.config.gridCols);
      ROWS = Array.from({ length: state.config.gridRows }, (_, i) => i + 1);
      initGrid();
    }
  }

  updateProjectorPhase(state);
  renderProjectorOceanMap(state);
  renderProjectorSurvivalBar(state);
  fitProjectorGridToScreen();
}

function updateProjectorPhase(state) {
  const badge = document.getElementById('projPhaseBadge');
  const bannerText = document.getElementById('projTurnText');
  const bannerBox = document.getElementById('projTurnBanner');

  if (state.phase === 'LOBBY') {
    badge.textContent = 'SẢNH CHỜ';
    badge.style.background = '#e0f2fe';
    badge.style.color = '#0284c7';
    bannerText.textContent = 'CHỜ NGƯỜI CHƠI VÀO PHÒNG';
    bannerBox.style.borderColor = '#0284c7';
  } else if (state.phase === 'PLACEMENT') {
    badge.textContent = 'DÀN TRẬN';
    badge.style.background = '#fef3c7';
    badge.style.color = '#d97706';
    bannerText.textContent = 'CÁC HẠM ĐỘI ĐANG BỐ TRÍ TÀU';
    bannerBox.style.borderColor = '#d97706';
  } else if (state.phase === 'BATTLE') {
    badge.textContent = 'CHIẾN ĐẤU';
    badge.style.background = '#fee2e2';
    badge.style.color = '#dc2626';

    const currentTeam = state.teams.find(t => t.id === state.currentTurnTeamId);
    if (currentTeam) {
      bannerText.innerHTML = `LƯỢT KHAI HỎA: <b style="color: ${currentTeam.colorHex};">${currentTeam.name}</b> (Lượt #${state.turnNumber})`;
      bannerBox.style.borderColor = currentTeam.colorHex;
    }
  } else if (state.phase === 'FINISHED' || state.phase === 'GAME_OVER') {
    badge.textContent = 'KẾT THÚC';
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';

    if (state.winner) {
      bannerText.innerHTML = `🏆 CHIẾN THẮNG: <b style="color: ${state.winner.colorHex};">${state.winner.name}</b>!`;
      bannerBox.style.borderColor = state.winner.colorHex;
    }
  }
}

function renderProjectorOceanMap(state) {
  // Xóa các ô cũ
  document.querySelectorAll('#projOceanGrid .ocean-cell').forEach(c => {
    c.className = 'ocean-cell';
    c.innerHTML = '';
    c.style.borderColor = '';
  });

  // Hiển thị các chiến hạm đã chìm hoàn toàn dạng liền khối
  if (state.teams) {
    state.teams.forEach(team => {
      if (team.fleet) {
        team.fleet.forEach(ship => {
          if (ship.isSunk) {
            ship.cells.forEach(key => {
              const cell = document.getElementById(`proj-cell-${key}`);
              if (!cell) return;
              const partClass = window.GameEngine.getShipPartClass(ship, key);
              cell.classList.add('has-ship', 'shot-sunk');
              if (partClass) cell.classList.add(partClass);
              cell.style.borderColor = team.colorHex;
            });
          }
        });
      }
    });
  }

  // Hiển thị lịch sử bắn khác
  if (state.shotsMap) {
    for (const key in state.shotsMap) {
      const shot = state.shotsMap[key];
      const cell = document.getElementById(`proj-cell-${key}`);
      if (!cell) continue;

      if (shot.result === 'MISS') {
        cell.className = 'ocean-cell shot-miss';
      } else if (shot.result === 'HIT' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-hit';
      }
    }
  }
}

function renderProjectorSurvivalBar(state) {
  const container = document.getElementById('projSurvivalBar') || document.getElementById('projTeamsList');
  if (!container || !state.teams) return;

  container.innerHTML = '';

  state.teams.forEach(team => {
    const isCurrentTurn = state.phase === 'BATTLE' && state.currentTurnTeamId === team.id;
    const card = document.createElement('div');
    card.className = `proj-team-card ${isCurrentTurn ? 'active-turn' : ''} ${team.isEliminated ? 'eliminated' : ''}`;
    if (isCurrentTurn) {
      card.style.borderColor = team.colorHex;
      card.style.background = `${team.colorHex}18`;
      card.style.boxShadow = `0 0 16px ${team.colorHex}66`;
    }

    let statusText = '';
    if (team.isEliminated) {
      statusText = '<span style="color: #dc2626; font-weight: 800; font-size: 0.85rem;">☠️ ĐÃ CHÌM</span>';
    } else {
      statusText = `<span style="font-weight: 800; color: #15803d; font-size: 0.85rem;">❤️ Còn ${team.shipsRemaining}/${state.config ? state.config.shipsPerPlayer : 2} tàu</span>`;
    }

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.4rem;">${team.icon}</span>
        <div>
          <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.95rem;">${team.name}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${team.isBot ? '🤖 AI Máy' : (team.playerName || 'Đang chờ')}</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div>${statusText}</div>
        <div style="font-size: 0.7rem; color: #0284c7; margin-top: 2px;">
          📡 ${team.radarScansRemaining ?? 2}/2 • 🚀 ${team.crossfireRemaining ?? 1}/1
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function handleProjectorShot(shot) {
  const cell = document.getElementById(`proj-cell-${shot.targetKey}`);
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
  }, 750);
}

function handleProjectorRadar(radar) {
  soundManager.playSonar();

  radar.scannedCells.forEach(key => {
    const cell = document.getElementById(`proj-cell-${key}`);
    if (cell) cell.classList.add('radar-sweep');
  });

  const banner = document.getElementById('projSkillBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = radar.hasEnemyShip ? '#fee2e2' : '#e0f2fe';
    banner.style.color = radar.hasEnemyShip ? '#dc2626' : '#0284c7';
    banner.innerHTML = radar.hasEnemyShip
      ? `📡 <b>${radar.shooterName}</b> quét Radar vùng <b>[${radar.centerKey}] (3x3)</b> ➔ ⚠️ BÁO ĐỘNG: Phát hiện ${radar.detectedCount} vị trí tàu địch!`
      : `📡 <b>${radar.shooterName}</b> quét Radar vùng <b>[${radar.centerKey}] (3x3)</b> ➔ 🌊 Vùng biển tĩnh lặng, không có tín hiệu tàu!`;
  }

  setTimeout(() => {
    radar.scannedCells.forEach(key => {
      const cell = document.getElementById(`proj-cell-${key}`);
      if (cell) cell.classList.remove('radar-sweep');
    });
    if (banner) banner.style.display = 'none';
  }, 3500);
}

function handleProjectorCrossfire(crossfire) {
  soundManager.playMissile();

  crossfire.targetKeys.forEach(key => {
    const cell = document.getElementById(`proj-cell-${key}`);
    if (cell) cell.classList.add('crossfire-target');
  });

  const banner = document.getElementById('projSkillBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = '#ffedd5';
    banner.style.color = '#ea580c';
    banner.innerHTML = `🚀 <b>${crossfire.shooterName}</b> PHÓNG TÊN LỬA CHỮ THẬP (+) VÀO TÂM <b>[${crossfire.centerKey}]</b> CÔNG PHÁ ĐỒNG LOẠT 5 Ô!`;
  }

  setTimeout(() => {
    crossfire.targetKeys.forEach(key => {
      const cell = document.getElementById(`proj-cell-${key}`);
      if (cell) cell.classList.remove('crossfire-target');
    });

    crossfire.shots.forEach(s => handleProjectorShot(s));
  }, 1000);

  setTimeout(() => {
    if (banner) banner.style.display = 'none';
  }, 4000);
}

// Bộ đếm thời gian 60s cho máy chiếu
function startScreenTurnTicker() {
  if (turnTickerInterval) clearInterval(turnTickerInterval);
  turnTickerInterval = setInterval(() => {
    if (!currentScreenState || currentScreenState.phase !== 'BATTLE') return;

    const timerBadge = document.getElementById('projTurnTimerBadge');
    const timerText = document.getElementById('projTurnTimerText');
    if (!timerBadge || !timerText) return;

    const turnStart = currentScreenState.turnStartTime || Date.now();
    const elapsed = Math.floor((Date.now() - turnStart) / 1000);
    const remaining = Math.max(0, 60 - elapsed);

    timerText.textContent = `${remaining}s`;

    if (remaining <= 10) {
      timerBadge.classList.add('urgent');
    } else {
      timerBadge.classList.remove('urgent');
    }
  }, 1000);
}

function initEvents() {
  const btnSound = document.getElementById('btnToggleSound');
  if (btnSound) {
    btnSound.addEventListener('click', () => {
      const enabled = soundManager.isEnabled();
      soundManager.setEnabled(!enabled);
      btnSound.textContent = !enabled ? '🔊' : '🔇';
    });
  }

  const btnFullscreen = document.getElementById('btnFullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }
}

function loadNetworkAndQR() {
  let joinUrl = `${window.location.origin}${window.location.pathname.replace('screen.html', 'join.html')}?room=${currentRoomId || 'PHONG-01'}`;
  if (!joinUrl.includes('join.html')) {
    joinUrl = `${window.location.origin}/join.html?room=${currentRoomId || 'PHONG-01'}`;
  }

  applyScreenQRToUI(joinUrl);

  fetch(`/api/network-info?room=${currentRoomId || ''}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.joinUrl) {
        applyScreenQRToUI(data.joinUrl);
      }
    })
    .catch(() => {});
}

function applyScreenQRToUI(url) {
  const urlEl = document.getElementById('projQrUrl');
  if (urlEl) urlEl.textContent = url;

  const imgEl = document.getElementById('projQrImg');
  if (window.QRCode && window.QRCode.toDataURL) {
    window.QRCode.toDataURL(url, { width: 320, margin: 1 }, (err, dataUri) => {
      if (!err && dataUri && imgEl) {
        imgEl.src = dataUri;
      } else if (imgEl) {
        imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
      }
    });
  } else if (imgEl) {
    imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
  }
}
})();
