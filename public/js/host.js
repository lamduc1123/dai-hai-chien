// public/js/host.js
// Logic điều khiển trung tâm MC Host thuần Tiếng Việt 100%, tích hợp Bot AI kiểm thử

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let socket = null;
let currentRoomId = null;
let currentHostState = null;
let soundManager = null;
let showSecretShips = false;

let tempPlayerCount = 4;
let tempShipsPerPlayer = 2;

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  initSocket();
  initGrid();
  initEventListeners();
  loadNetworkAndQR();
});

function initSocket() {
  socket = io();

  const urlParams = new URLSearchParams(window.location.search);
  const requestedRoom = urlParams.get('room') || null;

  socket.emit('host:register', { roomId: requestedRoom });

  socket.on('host:registered', (data) => {
    currentRoomId = data.roomId;
    document.getElementById('roomCodeText').textContent = currentRoomId;
    renderHostState(data.state);

    if (window.firebaseSync && window.firebaseSync.init()) {
      window.firebaseSync.hostListenActions(currentRoomId, handleIncomingFirebaseAction);
      window.firebaseSync.hostPublishState(currentRoomId, data.state);
      addLogItem('🔥 Đã kích hoạt đồng bộ đám mây Firebase Realtime Database!', 'hit');
    }
  });

  socket.on('host:state_update', (state) => {
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
  } else if (state.phase === 'FINISHED') {
    phaseBadge.textContent = 'KẾT THÚC';
    phaseBadge.style.background = '#dcfce7';
    phaseBadge.style.color = '#15803d';

    if (state.winner) {
      statusTurnText.innerHTML = `🏆 QUÁN QUÂN: <b style="color: ${state.winner.colorHex};">${state.winner.name}</b>`;
    }
    statusProgressText.textContent = 'Trận Đấu Đã Kết Thúc';

    btnStartPlacement.style.display = 'none';
    btnStartBattle.style.display = 'none';
    btnManualTurn.style.display = 'none';
    btnUndo.style.display = 'none';
  }
}

function renderTeamsRoster(state) {
  const container = document.getElementById('teamsRosterList');
  container.innerHTML = '';

  state.teams.forEach(team => {
    const card = document.createElement('div');
    card.className = 'team-roster-card';
    if (team.id === state.currentTurnTeamId && state.phase === 'BATTLE') {
      card.classList.add('active-turn');
    }
    if (team.isEliminated) {
      card.classList.add('eliminated');
    }

    const shipsIcons = '🚢'.repeat(Math.max(0, team.shipsRemaining || 0));

    let statusBadge = '';
    if (team.isEliminated) {
      statusBadge = '<span class="badge" style="background: #fee2e2; color: #dc2626;">ĐÃ BỊ HỦY DIỆT</span>';
    } else if (state.phase === 'LOBBY') {
      if (team.isBot) {
        statusBadge = '<span class="badge" style="background: #e0f2fe; color: #0284c7;">🤖 MÁY SẴN SÀNG</span>';
      } else {
        statusBadge = team.isReady
          ? '<span class="badge" style="background: #dcfce7; color: #16a34a;">✓ SẴN SÀNG</span>'
          : (team.isConnected ? '<span class="badge" style="background: #fef3c7; color: #d97706;">CHỜ SẴN SÀNG</span>' : '<span class="badge" style="background: #f1f5f9; color: #64748b;">ĐANG TRỐNG</span>');
      }
    } else if (state.phase === 'PLACEMENT') {
      statusBadge = team.isFleetLocked
        ? '<span class="badge" style="background: #dcfce7; color: #16a34a;">🔒 ĐÃ KHÓA TÀU</span>'
        : '<span class="badge" style="background: #fef3c7; color: #d97706;">⚙️ ĐANG XẾP</span>';
    } else {
      statusBadge = `<span class="badge" style="background: #e0f2fe; color: #0369a1;">ĐIỂM: ${team.score || 0}</span>`;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.3rem;">${team.icon}</span>
          <div>
            <div style="font-weight: 800; color: ${team.colorHex}; font-size: 0.95rem;">
              ${team.name} ${team.isBot ? '🤖' : ''}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${team.zone ? `Phân vùng: ${team.zone.colStart}${team.zone.rowStart} - ${team.zone.colEnd}${team.zone.rowEnd}` : ''}
            </div>
          </div>
        </div>
        ${statusBadge}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; margin-top: 4px;">
        <div title="Tàu còn lại">${shipsIcons || '❌ Hết tàu'}</div>
        <div style="font-weight: bold; color: var(--navy-dark);">${team.shipsRemaining} Tàu</div>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderOceanMap(state) {
  const cells = document.querySelectorAll('.ocean-cell');
  cells.forEach(c => {
    c.className = 'ocean-cell';
    c.innerHTML = '';
  });

  if (state.zones && state.phase === 'PLACEMENT') {
    for (const teamId in state.zones) {
      const z = state.zones[teamId];
      const team = state.teams.find(t => t.id === parseInt(teamId, 10));
      if (z.cells && team) {
        z.cells.forEach(k => {
          const el = document.getElementById(`cell-${k}`);
          if (el) {
            el.classList.add('zone-highlight');
            el.style.backgroundColor = `${team.colorHex}15`;
            el.style.borderColor = `${team.colorHex}55`;
          }
        });
      }
    }
  }

  if ((showSecretShips || state.phase === 'FINISHED') && state.teams) {
    state.teams.forEach(team => {
      if (team.fleet) {
        team.fleet.forEach(ship => {
          ship.cells.forEach(k => {
            const el = document.getElementById(`cell-${k}`);
            if (el && !el.classList.contains('shot-hit') && !el.classList.contains('shot-sunk')) {
              el.classList.add('has-ship');
              el.style.borderColor = team.colorHex;
              el.title = `${ship.name} (${team.name})`;
            }
          });
        });
      }
    });
  }

  if (state.shotsMap) {
    for (const [key, shot] of Object.entries(state.shotsMap)) {
      const el = document.getElementById(`cell-${key}`);
      if (!el) continue;

      if (shot.result === 'MISS') {
        el.classList.add('shot-miss');
        el.title = `Tọa độ ${key}: Bắn trượt xuống biển`;
      } else if (shot.result === 'HIT') {
        el.classList.add('shot-hit');
        el.title = `Tọa độ ${key}: BẮN TRÚNG TÀU!`;
      } else if (shot.result === 'SUNK') {
        el.classList.add('shot-sunk');
        el.title = `Tọa độ ${key}: TÀU ĐÃ BỊ BẮN CHÌM (${shot.sunkShip || ''})`;
      }
    }
  }
}

function handleShotAnimation(shot) {
  const targetEl = document.getElementById(`cell-${shot.targetKey}`);
  if (!targetEl) return;

  soundManager.playMissile();

  const flyer = document.createElement('div');
  flyer.className = 'missile-flyer';
  flyer.textContent = '🚀';

  const rect = targetEl.getBoundingClientRect();
  flyer.style.left = '50px';
  flyer.style.top = '150px';
  document.body.appendChild(flyer);

  requestAnimationFrame(() => {
    flyer.style.transform = `translate(${rect.left - 50}px, ${rect.top - 150}px) scale(1.3)`;
  });

  setTimeout(() => {
    if (flyer.parentNode) flyer.parentNode.removeChild(flyer);

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
    if (!currentRoomId) return;
    socket.emit('host:add_bot', { roomId: currentRoomId });
    addLogItem('🤖 Đã thêm 1 máy (Bot) vào phòng.', 'miss');
  });

  // Lấp đầy bằng bot
  document.getElementById('btnFillBots').addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('host:fill_bots', { roomId: currentRoomId });
    addLogItem('🤖 Đã lấp đầy tất cả các đội còn trống bằng máy (Bot).', 'miss');
  });

  // Bắt đầu dàn trận
  document.getElementById('btnStartPlacement').addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('host:start_placement', { roomId: currentRoomId });
  });

  // Bắt đầu chiến đấu
  document.getElementById('btnStartBattle').addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('host:start_battle', { roomId: currentRoomId });
  });

  // Chuyển lượt thủ công
  document.getElementById('btnManualTurn').addEventListener('click', () => {
    if (!currentRoomId || !currentHostState) return;
    const living = currentHostState.teams.filter(t => !t.isEliminated);
    if (living.length > 0) {
      const currentIdx = living.findIndex(t => t.id === currentHostState.currentTurnTeamId);
      const nextTeam = living[(currentIdx + 1) % living.length];
      socket.emit('host:manual_turn', { roomId: currentRoomId, targetTeamId: nextTeam.id });
    }
  });

  // Hoàn tác
  document.getElementById('btnUndo').addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('host:undo', { roomId: currentRoomId });
  });

  // Đặt lại
  document.getElementById('btnResetGame').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn đặt lại ván đấu mới không?')) {
      socket.emit('host:reset', { roomId: currentRoomId });
    }
  });

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

  // Modal Cài Đặt Game
  document.getElementById('btnOpenConfig').addEventListener('click', openConfigModal);
  document.getElementById('btnCloseConfig').addEventListener('click', closeConfigModal);
  document.getElementById('modalConfig').addEventListener('click', (e) => {
    if (e.target.id === 'modalConfig') closeConfigModal();
  });

  document.querySelectorAll('.cfg-player-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cfg-player-btn').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-outline');
      });
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
      tempPlayerCount = parseInt(btn.dataset.val, 10);
    });
  });

  document.querySelectorAll('.cfg-ship-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cfg-ship-btn').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-outline');
      });
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
      tempShipsPerPlayer = parseInt(btn.dataset.val, 10);
    });
  });

  document.getElementById('btnSaveConfig').addEventListener('click', () => {
    const shipConfigMode = document.getElementById('cfgShipConfigMode').value;
    const turnOrderMode = document.getElementById('cfgTurnOrderMode').value;

    socket.emit('host:update_config', {
      roomId: currentRoomId,
      config: {
        playerCount: tempPlayerCount,
        shipsPerPlayer: tempShipsPerPlayer,
        shipConfigMode,
        turnOrderMode,
      },
    });

    closeConfigModal();
    addLogItem(`⚙️ Đã cập nhật thiết lập: ${tempPlayerCount} người chơi, ${tempShipsPerPlayer} tàu/người`, 'miss');
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

function handleIncomingFirebaseAction(action) {
  if (!action || !action.type || !currentRoomId) return;

  if (action.type === 'FIRE') {
    socket.emit('player:fire', {
      roomId: currentRoomId,
      teamId: action.teamId,
      targetKey: action.targetKey,
    });
  } else if (action.type === 'JOIN') {
    socket.emit('player:join', {
      roomId: currentRoomId,
      teamId: action.teamId,
      playerName: action.playerName,
      deviceToken: action.deviceToken,
    });
  } else if (action.type === 'READY') {
    socket.emit('player:ready', {
      roomId: currentRoomId,
      teamId: action.teamId,
    });
  } else if (action.type === 'AUTO_PLACE') {
    socket.emit('player:auto_place', {
      roomId: currentRoomId,
      teamId: action.teamId,
    });
  } else if (action.type === 'LOCK_FLEET') {
    socket.emit('player:lock_fleet', {
      roomId: currentRoomId,
      teamId: action.teamId,
      fleet: action.fleet,
    });
  }
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
  try {
    const res = await fetch(`/api/network-info?room=${currentRoomId || ''}`);
    const data = await res.json();

    const joinUrl = data.joinUrl;
    document.getElementById('qrMiniUrl').textContent = joinUrl;
    document.getElementById('qrCopyUrlInput').value = joinUrl;

    const qrRes = await fetch(`/api/qr?url=${encodeURIComponent(joinUrl)}`);
    const qrData = await qrRes.json();

    document.getElementById('qrMiniThumb').src = qrData.dataUrl;
    document.getElementById('qrBigImage').src = qrData.dataUrl;
  } catch (err) {
    console.error('Lỗi tải QR code:', err);
  }
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
