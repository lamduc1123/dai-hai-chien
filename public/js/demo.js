// public/js/demo.js
// Chế độ Luyện Tập Solo: Bạn vs 3 Bot AI trên Đại Hải Đồ 400 Ô (20x20)
// 100% Client-side bằng GameEngine, không phụ thuộc server, đồng bộ hoàn hảo Theme Sáng Navy

(() => {
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

let gameState = null;
let soundManager = null;
let myTeamId = 1;
let selectedTargetKey = null;
let currentWeaponMode = 'NORMAL'; // 'NORMAL', 'CROSSFIRE'
let currentZoomLevel = 1.0;
let turnTickerInterval = null;
let botTurnTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  soundManager = new SoundManager();
  soundManager.init();

  initGrid();
  initEvents();
  startNewDemoGame();
  startTurnTicker();
});

function startNewDemoGame() {
  if (botTurnTimer) clearTimeout(botTurnTimer);

  // Khởi tạo ván đấu 4 đội (Bạn + 3 Bot AI)
  gameState = window.GameEngine.createInitialGameState({
    playerCount: 4,
    shipsPerPlayer: 2,
    turnDuration: 60,
  });

  // Đội 1 là Bạn
  const myTeam = gameState.teams.find(t => t.id === 1);
  myTeam.playerName = 'Bạn (Chỉ Huy)';
  myTeam.isConnected = true;
  myTeam.isBot = false;

  // Các đội còn lại là Bot AI
  for (let i = 1; i < gameState.teams.length; i++) {
    const bot = gameState.teams[i];
    bot.isBot = true;
    bot.botName = `Bot ${bot.name}`;
    bot.isConnected = true;
  }

  // Khởi động Dàn trận và Chiến đấu tự động
  window.GameEngine.startPlacementPhase(gameState);
  myTeam.fleet = window.GameEngine.generateRandomFleetInZone(myTeam.zone, gameState.config.shipLengths);
  myTeam.isFleetLocked = true;
  myTeam.isReady = true;

  window.GameEngine.startBattlePhase(gameState);
  gameState.turnStartTime = Date.now();

  selectedTargetKey = null;
  currentWeaponMode = 'NORMAL';
  updateWeaponButtonsUI();

  renderAll();
  addLog('⚓ Ván luyện tập mới đã bắt đầu! Bản đồ 400 ô (20x20), 4 Hạm đội tham chiến.', 'hit');

  checkBotTurn();
}

function initGrid() {
  const container = document.getElementById('demoOceanGrid');
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
      cell.id = `demo-cell-${key}`;
      cell.dataset.key = key;

      cell.addEventListener('click', () => {
        selectCoordinate(key);
      });

      container.appendChild(cell);
    }
  }
}

function selectCoordinate(key) {
  if (!gameState || gameState.phase !== 'BATTLE') return;
  if (gameState.currentTurnTeamId !== myTeamId) {
    alert('Đang trong lượt của Bot, vui lòng đợi lượt của bạn!');
    return;
  }

  if (currentWeaponMode === 'NORMAL' && gameState.shotsMap[key]) {
    alert('Tọa độ này đã bị bắn trước đó! Hãy chọn ô khác.');
    return;
  }

  selectedTargetKey = key;
  const inputEl = document.getElementById('inputDemoCoord');
  if (inputEl) inputEl.value = key;

  highlightTargetArea();

  const targetCell = document.getElementById(`demo-cell-${key}`);
  if (targetCell) {
    targetCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

function highlightTargetArea() {
  document.querySelectorAll('#demoOceanGrid .ocean-cell').forEach(c => {
    c.classList.remove('selected-target', 'radar-sweep', 'crossfire-target');
  });

  if (!selectedTargetKey) return;

  const parsed = window.GameEngine.parseKey(selectedTargetKey);
  if (!parsed) return;

  if (currentWeaponMode === 'NORMAL') {
    const cell = document.getElementById(`demo-cell-${selectedTargetKey}`);
    if (cell) cell.classList.add('selected-target');
    return;
  }

  if (currentWeaponMode === 'CROSSFIRE') {
    const deltas = [{ dc: 0, dr: 0 }, { dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];
    for (const d of deltas) {
      const cIdx = parsed.colIdx + d.dc;
      const rIdx = parsed.rowIdx + d.dr;
      if (cIdx >= 0 && cIdx < COLS.length && rIdx >= 0 && rIdx < ROWS.length) {
        const k = `${COLS[cIdx]}${ROWS[rIdx]}`;
        const cell = document.getElementById(`demo-cell-${k}`);
        if (cell) cell.classList.add('crossfire-target');
      }
    }
  }
}

function fireSelectedTarget() {
  if (!gameState || gameState.phase !== 'BATTLE') return;
  if (gameState.currentTurnTeamId !== myTeamId) {
    alert('Đang trong lượt của Bot!');
    return;
  }

  if (!selectedTargetKey) {
    alert('Vui lòng chọn 1 ô trên bản đồ hoặc nhập tọa độ!');
    return;
  }

  if (currentWeaponMode === 'CROSSFIRE') {
    const res = window.GameEngine.processCrossfire(gameState, myTeamId, selectedTargetKey);
    if (!res.success) {
      alert(res.error);
      return;
    }
    soundManager.playMissile();
    res.crossfireRecord.shots.forEach(s => animateShot(s));
    addLog(`🚀 Bạn phóng TÊN LỬA CHỮ THẬP (+) vào <b>[${selectedTargetKey}]</b> công phá đồng loạt 5 ô!`, 'hit');
    currentWeaponMode = 'NORMAL';
    updateWeaponButtonsUI();
  } else {
    // Bắn thường
    const res = window.GameEngine.processShot(gameState, myTeamId, selectedTargetKey);
    if (!res.success) {
      alert(res.error);
      return;
    }
    animateShot(res.shotRecord);
  }

  selectedTargetKey = null;
  const inputEl = document.getElementById('inputDemoCoord');
  if (inputEl) inputEl.value = '';

  renderAll();
  checkBotTurn();
}

function animateShot(shot) {
  soundManager.playMissile();
  const cell = document.getElementById(`demo-cell-${shot.targetKey}`);
  if (cell) {
    cell.classList.add('targeted');
    setTimeout(() => {
      cell.classList.remove('targeted');
      if (shot.result === 'HIT' || shot.result === 'SUNK') {
        soundManager.playHit();
        if (shot.result === 'SUNK') soundManager.playSunk();
      } else {
        soundManager.playMiss();
      }
      renderOceanGrid();
    }, 500);
  }

  if (shot.easterEgg) {
    soundManager.playAlarm();
    const eeBanner = document.getElementById('demoEasterEggBanner');
    if (eeBanner) {
      eeBanner.innerHTML = `🎁 <b>${shot.shooterName || 'CHIẾN HẠM'}</b> BẮN TRÚNG Ô MAY MẮN (EASTER EGG)!<br><span style="font-size: 0.95rem; font-weight: 700;">Nhận ngay thêm +1 LƯỢT BẮN tiếp tục! 🎯</span>`;
      eeBanner.style.display = 'block';
      setTimeout(() => { eeBanner.style.display = 'none'; }, 4500);
    }
    addLog(`🎁 <b>[EASTER EGG]</b> ${shot.shooterName} vừa bắn trúng ô may mắn và được thưởng thêm +1 lượt bắn!`, 'hit');
  }

  const shooterStr = `<b style="color: ${shot.shooterColor}">${shot.shooterName}</b>`;
  if (shot.result === 'HIT') {
    addLog(`${shooterStr} khai hỏa vào <b>[${shot.targetKey}]</b> ➔ 💥 BẮN TRÚNG TÀU đối phương!`, 'hit');
  } else if (shot.result === 'SUNK') {
    addLog(`${shooterStr} khai hỏa vào <b>[${shot.targetKey}]</b> ➔ ☠️ BẮN CHÌM ${shot.sunkShip ? shot.sunkShip.name : 'tàu'} của ${shot.hitTeamName}!`, 'sunk');
  } else {
    addLog(`${shooterStr} khai hỏa vào <b>[${shot.targetKey}]</b> ➔ 🌊 Bắn trượt xuống biển!`, 'miss');
  }
}

function checkBotTurn() {
  if (botTurnTimer) clearTimeout(botTurnTimer);
  if (!gameState || gameState.phase !== 'BATTLE') return;

  const currentTeam = gameState.teams.find(t => t.id === gameState.currentTurnTeamId);
  if (!currentTeam || currentTeam.isEliminated) return;

  if (currentTeam.isBot) {
    botTurnTimer = setTimeout(() => {
      if (!gameState || gameState.phase !== 'BATTLE' || gameState.currentTurnTeamId !== currentTeam.id) return;
      const targetKey = window.GameEngine.calculateBotTarget(gameState, currentTeam.id);
      if (targetKey) {
        const res = window.GameEngine.processShot(gameState, currentTeam.id, targetKey);
        if (res.success) {
          animateShot(res.shotRecord);
        }
        renderAll();
        checkBotTurn();
      }
    }, 1300);
  }
}

function renderAll() {
  if (!gameState) return;

  renderTurnHeader();
  renderOceanGrid();
  renderMyFleet();
  renderSurvivalBar();
  updateWeaponCounts();
}

function renderTurnHeader() {
  const isMyTurn = gameState.currentTurnTeamId === myTeamId;
  const currentTeam = gameState.teams.find(t => t.id === gameState.currentTurnTeamId);
  const turnBox = document.getElementById('demoTurnBox');
  const turnText = document.getElementById('demoTurnText');

  if (gameState.phase === 'FINISHED') {
    turnText.textContent = gameState.winner ? `🏆 CHIẾN THẮNG: ${gameState.winner.name}!` : 'TRẬN ĐẤU KẾT THÚC';
    turnBox.style.borderColor = '#10b981';
    return;
  }

  if (isMyTurn) {
    turnText.textContent = '🎯 ĐẾN LƯỢT CỦA BẠN';
    turnBox.style.borderColor = '#0284c7';
    turnBox.style.background = '#f0f9ff';
  } else {
    turnText.textContent = `⏳ LƯỢT: ${currentTeam ? currentTeam.name : 'BOT'}...`;
    turnBox.style.borderColor = '#f59e0b';
    turnBox.style.background = '#fef3c7';
  }
}

function renderOceanGrid() {
  document.querySelectorAll('#demoOceanGrid .ocean-cell').forEach(c => {
    c.className = 'ocean-cell';
    c.style.backgroundColor = '';
    c.style.borderColor = '';
  });

  // Render các tàu của bạn (và các tàu đối phương đã bị bắn chìm)
  gameState.teams.forEach(team => {
    const isMe = team.id === myTeamId;
    if (team.fleet) {
      team.fleet.forEach(ship => {
        if (isMe || ship.isSunk) {
          ship.cells.forEach(k => {
            const cell = document.getElementById(`demo-cell-${k}`);
            if (!cell) return;
            const partClass = window.GameEngine.getShipPartClass(ship, k);
            cell.classList.add('has-ship');
            if (partClass) cell.classList.add(partClass);
            cell.style.borderColor = team.colorHex;

            if (ship.isSunk) {
              cell.classList.add('shot-sunk');
            } else if (ship.hits && ship.hits.includes(k)) {
              cell.classList.add('shot-hit');
            }
          });
        }
      });
    }
  });

  // Render các phát bắn khác
  if (gameState.shotsMap) {
    for (const k in gameState.shotsMap) {
      const s = gameState.shotsMap[k];
      const cell = document.getElementById(`demo-cell-${k}`);
      if (!cell) continue;

      if (s.result === 'MISS') {
        cell.className = 'ocean-cell shot-miss';
      } else if (s.result === 'HIT' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-hit';
      } else if (s.result === 'SUNK' && !cell.classList.contains('has-ship')) {
        cell.className = 'ocean-cell shot-sunk';
      }
    }
  }

  highlightTargetArea();
}

function renderMyFleet() {
  const container = document.getElementById('myFleetList');
  const myTeam = gameState.teams.find(t => t.id === myTeamId);
  if (!container || !myTeam || !myTeam.fleet) return;

  container.innerHTML = '';
  myTeam.fleet.forEach(ship => {
    const isSunk = ship.isSunk;
    const hits = ship.hits ? ship.hits.length : 0;
    const badge = document.createElement('div');
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 700;
      background: ${isSunk ? '#fee2e2' : '#e0f2fe'};
      color: ${isSunk ? '#dc2626' : '#0369a1'};
      border: 1px solid ${isSunk ? '#fca5a5' : '#bae6fd'};
    `;
    badge.innerHTML = `
      <span>${isSunk ? '☠️' : '🚢'}</span>
      <span>${ship.name}: ${isSunk ? 'Đã chìm' : `${ship.size - hits}/${ship.size} HP`}</span>
    `;
    container.appendChild(badge);
  });
}

function renderSurvivalBar() {
  const container = document.getElementById('demoSurvivalBar');
  if (!container || !gameState) return;

  container.innerHTML = '';
  gameState.teams.forEach(t => {
    const isTurn = gameState.currentTurnTeamId === t.id;
    const isMe = t.id === myTeamId;
    const card = document.createElement('div');
    card.className = `survival-team-card ${isTurn ? 'active-turn' : ''} ${t.isEliminated ? 'eliminated' : ''}`;
    if (isTurn) {
      card.style.borderColor = t.colorHex;
    }

    const shipStatus = t.isEliminated
      ? '<span style="color: #dc2626; font-weight: 800;">☠️ ĐÃ CHÌM</span>'
      : `<span style="color: #16a34a; font-weight: 800;">❤️ Còn ${t.shipsRemaining}/${gameState.config.shipsPerPlayer || 2} tàu</span>`;

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.4rem;">${t.icon}</span>
        <div>
          <div style="font-weight: 800; font-size: 0.9rem; color: ${t.colorHex};">
            ${isMe ? 'Bạn (Hải Ưng)' : t.name}
          </div>
          <div style="font-size: 0.72rem; color: #64748b;">
            ${t.isBot ? '🤖 AI Máy' : '👤 Chỉ Huy'}
          </div>
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 0.85rem;">${shipStatus}</div>
        ${isMe && !t.isEliminated ? `
          <div style="font-size: 0.72rem; color: #ea580c; margin-top: 2px;">
            🚀 Chữ Thập: ${t.crossfireRemaining ?? 1}/1
          </div>
        ` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

function updateWeaponCounts() {
  const myTeam = gameState.teams.find(t => t.id === myTeamId);
  if (!myTeam) return;

  const crossText = document.getElementById('crossfireCountText');
  if (crossText) crossText.textContent = `${myTeam.crossfireRemaining ?? 1}/1`;
}

function updateWeaponButtonsUI() {
  const btnNorm = document.getElementById('btnModeNormal');
  const btnCross = document.getElementById('btnModeCrossfire');
  const btnFire = document.getElementById('btnDemoFire');

  if (btnNorm) btnNorm.className = currentWeaponMode === 'NORMAL' ? 'btn btn-primary' : 'btn btn-outline';
  if (btnCross) btnCross.className = currentWeaponMode === 'CROSSFIRE' ? 'btn btn-primary' : 'btn btn-outline';

  if (btnFire) {
    if (currentWeaponMode === 'NORMAL') {
      btnFire.textContent = '🚀 KHAI HỎA';
      btnFire.style.background = '#dc2626';
    } else if (currentWeaponMode === 'CROSSFIRE') {
      btnFire.textContent = '💥 BẮN CHỮ THẬP';
      btnFire.style.background = '#ea580c';
    }
  }

  highlightTargetArea();
}

function addLog(text, type = 'normal') {
  const container = document.getElementById('demoCombatLog');
  if (!container) return;

  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  item.innerHTML = text;
  container.prepend(item);
}

function startTurnTicker() {
  if (turnTickerInterval) clearInterval(turnTickerInterval);
  turnTickerInterval = setInterval(() => {
    if (!gameState || gameState.phase !== 'BATTLE') return;

    const badge = document.getElementById('demoTimerBadge');
    const text = document.getElementById('demoTimerText');
    if (!badge || !text) return;

    const start = gameState.turnStartTime || Date.now();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const remaining = Math.max(0, 60 - elapsed);

    text.textContent = `${remaining}s`;

    if (remaining <= 10) {
      badge.classList.add('urgent');
    } else {
      badge.classList.remove('urgent');
    }

    if (remaining === 0) {
      addLog('⏰ Hết 60s thời gian suy nghĩ! Pháo tự động khai hỏa.', 'miss');
      const timeoutRes = window.GameEngine.handleTurnTimeout(gameState);
      if (timeoutRes && timeoutRes.shotRecord) {
        animateShot(timeoutRes.shotRecord);
      }
      renderAll();
      checkBotTurn();
    }
  }, 1000);
}

function initEvents() {
  document.getElementById('btnNewGame').addEventListener('click', () => {
    if (confirm('Bắt đầu ván luyện tập mới?')) {
      startNewDemoGame();
    }
  });

  document.getElementById('btnSoundToggle').addEventListener('click', () => {
    const en = soundManager.isEnabled();
    soundManager.setEnabled(!en);
    document.getElementById('btnSoundToggle').textContent = !en ? '🔊 Âm Thanh' : '🔇 Đã Tắt';
  });

  // Chọn kỹ năng
  document.getElementById('btnModeNormal').addEventListener('click', () => {
    currentWeaponMode = 'NORMAL';
    updateWeaponButtonsUI();
  });

  document.getElementById('btnModeCrossfire').addEventListener('click', () => {
    const myTeam = gameState.teams.find(t => t.id === myTeamId);
    if (myTeam && (myTeam.crossfireRemaining || 0) <= 0) {
      alert('Bạn đã hết lượt bắn Tên lửa Chữ Thập!');
      return;
    }
    currentWeaponMode = 'CROSSFIRE';
    updateWeaponButtonsUI();
  });

  // Khai hỏa
  document.getElementById('btnDemoFire').addEventListener('click', fireSelectedTarget);

  // Nhập tọa độ
  const inputCoord = document.getElementById('inputDemoCoord');
  inputCoord.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = inputCoord.value.trim().toUpperCase();
      const parsed = window.GameEngine.parseKey(val);
      if (!parsed) {
        alert(`Tọa độ [${val}] không hợp lệ! (VD: B14, D8, K20)`);
        return;
      }
      selectCoordinate(val);
      fireSelectedTarget();
    }
  });

  // Zoom
  const gridEl = document.getElementById('demoOceanGrid');
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    currentZoomLevel = Math.min(1.8, currentZoomLevel + 0.2);
    gridEl.style.transform = `scale(${currentZoomLevel})`;
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    currentZoomLevel = Math.max(0.7, currentZoomLevel - 0.2);
    gridEl.style.transform = `scale(${currentZoomLevel})`;
  });

  document.getElementById('btnZoomReset').addEventListener('click', () => {
    currentZoomLevel = 1.0;
    gridEl.style.transform = `scale(1)`;
  });
}
})();
