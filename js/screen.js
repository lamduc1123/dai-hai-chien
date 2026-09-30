// public/js/screen.js
// Logic hiển thị Màn hình lớn máy chiếu (TV / Projector) thuần Tiếng Việt 100%
// Hải đồ 20x20 (400 ô), Đếm ngược 60s, Kỹ năng Radar 3x3 & Tên lửa Chữ Thập (+), Bảng xếp hạng Live

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

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

function initGrid() {
  const container = document.getElementById('projOceanGrid');
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
}

function renderScreenState(state) {
  if (!state) return;
  currentScreenState = state;

  updateProjectorPhase(state);
  renderProjectorOceanMap(state);
  renderProjectorLeaderboard(state);
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
  });

  // Hiển thị lịch sử bắn
  if (state.shotsMap) {
    for (const key in state.shotsMap) {
      const shot = state.shotsMap[key];
      const cell = document.getElementById(`proj-cell-${key}`);
      if (!cell) continue;

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

function renderProjectorLeaderboard(state) {
  const container = document.getElementById('projTeamsList');
  if (!container || !state.teams) return;

  container.innerHTML = '';

  // Xếp hạng: còn sống lên trước, sau đó theo điểm giảm dần, sau đó theo số tàu còn lại
  const sortedTeams = [...state.teams].sort((a, b) => {
    if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (b.shipsRemaining || 0) - (a.shipsRemaining || 0);
  });

  sortedTeams.forEach((team, idx) => {
    const isCurrentTurn = state.phase === 'BATTLE' && state.currentTurnTeamId === team.id;
    const card = document.createElement('div');
    card.className = `proj-team-card ${team.isEliminated ? 'eliminated' : ''}`;
    if (isCurrentTurn) {
      card.style.borderColor = team.colorHex;
      card.style.background = `${team.colorHex}12`;
      card.style.boxShadow = `0 0 14px ${team.colorHex}55`;
    }

    const rankBadge = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));

    let statusText = '';
    if (team.isEliminated) {
      statusText = '<span style="color: #dc2626; font-weight: bold;">☠️ ĐÃ BỊ CHÌM</span>';
    } else {
      statusText = `<span style="font-weight: 800; color: #0284c7;">❤️ Còn ${team.shipsRemaining} tàu</span>`;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.1rem; font-weight: 900;">${rankBadge}</span>
          <span style="font-size: 1.25rem;">${team.icon}</span>
          <div>
            <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.95rem;">${team.name}</div>
            <div style="font-size: 0.72rem; color: #64748b;">Điểm: <b>${team.score || 0}</b></div>
          </div>
        </div>
        <div style="text-align: right;">
          ${statusText}
          <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">
            📡 ${team.radarScansRemaining ?? 2}/2 • 🚀 ${team.crossfireRemaining ?? 1}/1
          </div>
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

async function loadNetworkAndQR() {
  let joinUrl = `${window.location.origin}${window.location.pathname.replace('screen.html', 'join.html')}?room=${currentRoomId || 'PHONG-01'}`;

  try {
    const res = await fetch(`/api/network-info?room=${currentRoomId || ''}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.joinUrl) {
        joinUrl = data.joinUrl;
      }
    }
  } catch (err) {}

  const urlEl = document.getElementById('projQrUrl');
  if (urlEl) urlEl.textContent = joinUrl;

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(joinUrl)}`;
  const imgEl = document.getElementById('projQrImg');
  if (imgEl) imgEl.src = qrImageUrl;
}
