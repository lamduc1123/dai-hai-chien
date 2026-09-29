// public/js/screen.js
// Logic hiển thị Màn hình lớn máy chiếu (TV / Projector) thuần Tiếng Việt 100%

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let socket = null;
let currentRoomId = null;
let currentScreenState = null;
let soundManager = null;

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  initSocket();
  initGrid();
  initEvents();
  loadNetworkAndQR();
});

function initSocket() {
  socket = io();

  const urlParams = new URLSearchParams(window.location.search);
  const reqRoom = urlParams.get('room') || null;

  socket.emit('screen:register', { roomId: reqRoom });

  socket.on('screen:registered', (data) => {
    currentRoomId = data.roomId;
    document.getElementById('projRoomCode').textContent = currentRoomId;
    renderScreenState(data.state);

    if (window.firebaseSync && window.firebaseSync.init()) {
      window.firebaseSync.clientSubscribeState(currentRoomId, (state) => {
        if (state) renderScreenState(state);
      });
      window.firebaseSync.clientSubscribeShotEffect(currentRoomId, (shot) => {
        if (shot) handleProjectorShot(shot);
      });
    }
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

  const phaseBadge = document.getElementById('projPhaseBadge');
  const turnText = document.getElementById('projTurnText');

  if (state.phase === 'LOBBY') {
    phaseBadge.textContent = 'SẢNH CHỜ';
    phaseBadge.style.background = '#e0f2fe';
    phaseBadge.style.color = '#0284c7';
    turnText.textContent = 'ĐANG CHỜ CÁC ĐỘI QUÉT QR THAM GIA';
  } else if (state.phase === 'PLACEMENT') {
    phaseBadge.textContent = 'DÀN TRẬN';
    phaseBadge.style.background = '#fef3c7';
    phaseBadge.style.color = '#d97706';
    turnText.textContent = 'CÁC HẠM ĐỘI ĐANG TRIỂN KHAI VỊ TRÍ';
  } else if (state.phase === 'BATTLE') {
    phaseBadge.textContent = 'CHIẾN ĐẤU';
    phaseBadge.style.background = '#fee2e2';
    phaseBadge.style.color = '#dc2626';

    const currentTeam = state.teams.find(t => t.id === state.currentTurnTeamId);
    if (currentTeam) {
      turnText.innerHTML = `LƯỢT KHAI HỎA: <b style="color: ${currentTeam.colorHex};">${currentTeam.name}</b> (Lượt #${state.turnNumber})`;
    }
  } else if (state.phase === 'FINISHED') {
    phaseBadge.textContent = 'KẾT THÚC';
    phaseBadge.style.background = '#dcfce7';
    phaseBadge.style.color = '#15803d';

    if (state.winner) {
      turnText.innerHTML = `🏆 QUÁN QUÂN: <b style="color: ${state.winner.colorHex};">${state.winner.name}</b>`;
    }
  }

  renderTeamsList(state);
  renderGridShots(state);
}

function renderTeamsList(state) {
  const container = document.getElementById('projTeamsList');
  container.innerHTML = '';

  state.teams.forEach(team => {
    const row = document.createElement('div');
    row.className = 'team-badge-row';
    if (team.id === state.currentTurnTeamId && state.phase === 'BATTLE') {
      row.classList.add('active');
    }
    if (team.isEliminated) {
      row.classList.add('eliminated');
    }

    const shipIcons = '🚢'.repeat(Math.max(0, team.shipsRemaining || 0));

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.3rem;">${team.icon}</span>
        <div>
          <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.95rem;">
            ${team.name} ${team.isBot ? '🤖' : ''}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${shipIcons || '❌ Hết tàu'}</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-weight: bold; font-size: 0.9rem; color: var(--navy-dark);">${team.shipsRemaining} Tàu</div>
        <div style="font-size: 0.75rem; color: var(--navy-primary); font-weight: bold;">${team.score || 0} ĐIỂM</div>
      </div>
    `;

    container.appendChild(row);
  });
}

function renderGridShots(state) {
  const cells = document.querySelectorAll('.ocean-cell');
  cells.forEach(c => {
    c.className = 'ocean-cell';
  });

  if (state.shotsMap) {
    for (const [key, shot] of Object.entries(state.shotsMap)) {
      const el = document.getElementById(`proj-cell-${key}`);
      if (!el) continue;

      if (shot.result === 'MISS') {
        el.classList.add('shot-miss');
      } else if (shot.result === 'HIT') {
        el.classList.add('shot-hit');
      } else if (shot.result === 'SUNK') {
        el.classList.add('shot-sunk');
      }
    }
  }
}

function handleProjectorShot(shot) {
  const targetEl = document.getElementById(`proj-cell-${shot.targetKey}`);
  if (!targetEl) return;

  soundManager.playMissile();

  const flyer = document.createElement('div');
  flyer.className = 'missile-flyer';
  flyer.textContent = '🚀';

  const rect = targetEl.getBoundingClientRect();
  flyer.style.left = '40px';
  flyer.style.top = '100px';
  document.body.appendChild(flyer);

  requestAnimationFrame(() => {
    flyer.style.transform = `translate(${rect.left - 40}px, ${rect.top - 100}px) scale(1.6)`;
  });

  setTimeout(() => {
    if (flyer.parentNode) flyer.parentNode.removeChild(flyer);

    if (shot.result === 'HIT' || shot.result === 'SUNK') {
      soundManager.playHit();
      if (shot.result === 'SUNK') {
        setTimeout(() => soundManager.playSunk(), 300);
      }
    } else {
      soundManager.playMiss();
    }
  }, 700);
}

function initEvents() {
  document.getElementById('btnToggleSound').addEventListener('click', () => {
    const isEnabled = soundManager.isEnabled();
    soundManager.setEnabled(!isEnabled);
    document.getElementById('btnToggleSound').textContent = !isEnabled ? '🔊' : '🔇';
  });

  document.getElementById('btnFullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

async function loadNetworkAndQR() {
  try {
    const res = await fetch(`/api/network-info?room=${currentRoomId || ''}`);
    const data = await res.json();

    document.getElementById('projQrUrl').textContent = data.joinUrl;

    const qrRes = await fetch(`/api/qr?url=${encodeURIComponent(data.joinUrl)}`);
    const qrData = await qrRes.json();

    document.getElementById('projQrImg').src = qrData.dataUrl;
  } catch (err) {
    console.error('Lỗi tải QR code máy chiếu:', err);
  }
}
