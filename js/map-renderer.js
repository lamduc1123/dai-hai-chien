// public/js/map-renderer.js
// Bộ vẽ và tương tác 6 Chiến Khu (Mỗi đội 1 bảng 15x15 riêng biệt: A..O, 1..15)

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
const COLS = Array.from({ length: 15 }, (_, i) => i + 1);

const SHIP_ICONS = {
  CARRIER_1: '🚢',
  CARRIER_2: '⚓',
  BATTLESHIP: '⛴️',
  CRUISER: '🛳️',
  DESTROYER_1: '🚤',
  DESTROYER_2: '🤿',
};

/**
 * ------------------------------------------------------------------------
 * 1. MULTI-ZONE RENDERER (Dành cho Màn hình lớn MC & Trình chiếu máy chiếu)
 * Hiển thị đồng thời 6 Chiến khu (3 cột x 2 hàng), mỗi khu là 1 bảng 15x15
 * ------------------------------------------------------------------------
 */
class MultiZoneRenderer {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = {
      showSecretShips: false,
      onCellClick: null,
      ...options,
    };
    this.zoneElements = new Map(); // teamId -> { cardEl, gridEl, cells: Map<cellKey, divEl>, hpBarEl, hpTextEl, scoreEl }
    this.gameState = null;
    this.selectedTarget = null; // { teamId, cellKey }
    this.initLayout();
  }

  initLayout() {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'multi-zone-grid';
    this.wrapper = wrapper;
    this.container.appendChild(wrapper);
  }

  createZoneCard(teamId) {
    const card = document.createElement('div');
    card.className = `zone-card zone-card-${teamId}`;
    card.id = `zoneCard_${teamId}`;

    // 1. Header của Chiến khu
    const header = document.createElement('div');
    header.className = 'zone-card-header';
    header.innerHTML = `
      <div class="zone-card-title-group">
        <span class="zone-badge zone-badge-${teamId}" id="zoneBadge_${teamId}">Đội ${teamId}</span>
        <span class="zone-team-name" id="zoneTeamName_${teamId}">Đội ${teamId}</span>
        <span class="zone-status-pill" id="zoneStatusPill_${teamId}">Đang chờ</span>
      </div>
      <div class="zone-card-stats">
        <div class="zone-hp-wrap">
          <div class="zone-hp-bar-bg">
            <div class="zone-hp-bar" id="zoneHpBar_${teamId}" style="width: 100%;"></div>
          </div>
          <span class="zone-hp-text" id="zoneHpText_${teamId}">100%</span>
        </div>
        <div class="zone-score" id="zoneScore_${teamId}">0đ</div>
      </div>
    `;
    card.appendChild(header);

    // 2. Bảng 15x15
    const grid = document.createElement('div');
    grid.className = 'zone-board-15x15';

    // Góc trống
    const corner = document.createElement('div');
    corner.className = 'z-hdr-corner';
    grid.appendChild(corner);

    // Cột 1 -> 15
    COLS.forEach(c => {
      const ch = document.createElement('div');
      ch.className = 'z-hdr-col';
      ch.textContent = c;
      grid.appendChild(ch);
    });

    const cellMap = new Map();

    // Hàng A -> O
    ROWS.forEach(r => {
      const rh = document.createElement('div');
      rh.className = 'z-hdr-row';
      rh.textContent = r;
      grid.appendChild(rh);

      COLS.forEach(c => {
        const cellKey = `${r}${c}`;
        const cell = document.createElement('div');
        cell.className = 'z-cell';
        cell.dataset.teamId = teamId;
        cell.dataset.key = cellKey;
        cell.title = `Chiến khu ${teamId} - Ô ${cellKey}`;

        if (typeof this.options.onCellClick === 'function') {
          cell.addEventListener('click', () => {
            this.options.onCellClick(teamId, cellKey);
          });
        }

        cellMap.set(cellKey, cell);
        grid.appendChild(cell);
      });
    });

    card.appendChild(grid);

    // 3. Footer thông tin tàu chìm
    const footer = document.createElement('div');
    footer.className = 'zone-card-footer';
    footer.id = `zoneFooter_${teamId}`;
    footer.innerHTML = `<span class="zone-ships-status" id="zoneShips_${teamId}">Tàu còn lại: 6/6</span>`;
    card.appendChild(footer);

    this.zoneElements.set(teamId, {
      cardEl: card,
      gridEl: grid,
      cells: cellMap,
      nameEl: header.querySelector(`#zoneTeamName_${teamId}`),
      badgeEl: header.querySelector(`#zoneBadge_${teamId}`),
      statusPillEl: header.querySelector(`#zoneStatusPill_${teamId}`),
      hpBarEl: header.querySelector(`#zoneHpBar_${teamId}`),
      hpTextEl: header.querySelector(`#zoneHpText_${teamId}`),
      scoreEl: header.querySelector(`#zoneScore_${teamId}`),
      shipsEl: footer.querySelector(`#zoneShips_${teamId}`),
    });

    return card;
  }

  updateState(gameState) {
    if (!gameState) return;
    this.gameState = gameState;
    const shots = gameState.shots || {};
    const teams = gameState.teams || [];
    const currentTurnTeamId = gameState.currentTurnTeamId;
    const isPrep = gameState.status === 'PREPARATION';

    // 1. Đồng bộ nghiêm ngặt: Xóa hoàn toàn các thẻ vùng của đội không tham gia
    const activeTeamIds = new Set(teams.map(t => t.id));
    for (const [tId, zObj] of this.zoneElements.entries()) {
      if (!activeTeamIds.has(tId)) {
        if (zObj.cardEl && zObj.cardEl.parentNode) {
          zObj.cardEl.parentNode.removeChild(zObj.cardEl);
        }
        this.zoneElements.delete(tId);
      }
    }

    // 2. Tạo thẻ mới chỉ cho các đội tham gia nếu chưa có
    teams.forEach(t => {
      if (!this.zoneElements.has(t.id)) {
        this.createZoneCard(t.id);
      }
    });

    // 3. Cập nhật class grid theo số đội hiện tại (2 đến 6)
    const activeCount = teams.length || 6;
    if (this.wrapper) {
      this.wrapper.className = `multi-zone-grid grid-count-${activeCount}`;
    }

    // 4. Tái sắp xếp vị trí các thẻ khu vực trong DOM theo thứ tự mảng teams (đã được xáo trộn ngẫu nhiên trên server)
    if (this.wrapper && teams && teams.length > 0) {
      teams.forEach(t => {
        const zObj = this.zoneElements.get(t.id);
        if (zObj && zObj.cardEl) {
          this.wrapper.appendChild(zObj.cardEl);
        }
      });
    }

    teams.forEach(team => {
      const zObj = this.zoneElements.get(team.id);
      if (!zObj) return;

      // Cập nhật tên, huy hiệu, viền màu, điểm, HP
      if (zObj.nameEl) zObj.nameEl.textContent = team.name || `Đội ${team.id}`;
      if (zObj.scoreEl) zObj.scoreEl.textContent = `${team.score || 0}đ`;

      if (zObj.badgeEl) {
        if (team.mysteryZoneName) {
          zObj.badgeEl.textContent = team.mysteryZoneName;
        } else {
          zObj.badgeEl.textContent = team.name || `Đội ${team.id}`;
        }
        if (team.badgeClass) {
          zObj.badgeEl.className = `zone-badge ${team.badgeClass}`;
        }
      }

      if (team.colorHex) {
        zObj.cardEl.style.borderColor = team.colorHex;
      }

      const hp = team.hpPercent !== undefined ? team.hpPercent : 100;
      if (zObj.hpBarEl) {
        zObj.hpBarEl.style.width = `${hp}%`;
        zObj.hpBarEl.className = hp <= 25 ? 'zone-hp-bar critical' : hp <= 50 ? 'zone-hp-bar low' : 'zone-hp-bar';
      }
      if (zObj.hpTextEl) zObj.hpTextEl.textContent = `${hp}%`;

      // Cập nhật tàu còn lại
      const remShips = team.remainingShipsCount !== undefined ? team.remainingShipsCount : 6;
      if (zObj.shipsEl) {
        if (team.isEliminated) {
          zObj.shipsEl.innerHTML = `<span style="color: #ef4444; font-weight: 800;">☠️ ĐÃ BỊ TIÊU DIỆT</span>`;
        } else {
          zObj.shipsEl.textContent = `Tàu còn: ${remShips}/6`;
        }
      }

      // Trạng thái thẻ: Đang bắn / Bị tiêu diệt / Chuẩn bị
      zObj.cardEl.classList.remove('active-turn', 'eliminated', 'prep-ready');
      if (team.isEliminated) {
        zObj.cardEl.classList.add('eliminated');
        if (zObj.statusPillEl) {
          zObj.statusPillEl.textContent = 'ĐÃ BỊ LOẠI';
          zObj.statusPillEl.className = 'zone-status-pill eliminated';
        }
      } else if (isPrep) {
        if (team.prepFinished) {
          zObj.cardEl.classList.add('prep-ready');
          if (zObj.statusPillEl) {
            zObj.statusPillEl.textContent = '✓ ĐÃ KHÓA ĐỘI HÌNH';
            zObj.statusPillEl.className = 'zone-status-pill ready';
          }
        } else {
          if (zObj.statusPillEl) {
            zObj.statusPillEl.textContent = '🛠️ Đang dàn trận';
            zObj.statusPillEl.className = 'zone-status-pill prep';
          }
        }
      } else if (team.id === currentTurnTeamId) {
        zObj.cardEl.classList.add('active-turn');
        if (zObj.statusPillEl) {
          zObj.statusPillEl.textContent = '🎯 ĐANG KHAI HỎA';
          zObj.statusPillEl.className = 'zone-status-pill turn';
        }
      } else {
        if (zObj.statusPillEl) {
          zObj.statusPillEl.textContent = 'Chờ lượt';
          zObj.statusPillEl.className = 'zone-status-pill';
        }
      }

      // Tập hợp các ô có tàu đã chìm
      const sunkCells = new Set();
      if (team.sunkShips) {
        team.sunkShips.forEach(s => {
          if (s.cells) s.cells.forEach(c => sunkCells.add(c));
        });
      }

      // Tập hợp tàu bí mật nếu MC bật chế độ xem bí mật
      const secretShipMap = new Map();
      if (this.options.showSecretShips && team.fleet) {
        team.fleet.forEach(s => {
          const icon = SHIP_ICONS[s.type] || '🚢';
          s.cells.forEach(c => secretShipMap.set(c, icon));
        });
      }

      // Cập nhật từng ô trong 15x15 của đội này
      zObj.cells.forEach((cellEl, cellKey) => {
        const shotKey = `${team.id}_${cellKey}`;
        const shot = shots[shotKey];

        cellEl.className = 'z-cell';
        cellEl.innerHTML = '';

        if (shot) {
          if (shot.isHit) {
            if (sunkCells.has(cellKey)) {
              cellEl.classList.add('hit-sunk');
              cellEl.innerHTML = '<span class="cell-hit-sunk">🔥</span>';
            } else {
              cellEl.classList.add('hit');
              cellEl.innerHTML = '<span class="cell-hit-marker">💥</span>';
            }
          } else {
            cellEl.classList.add('miss');
            cellEl.innerHTML = '<span class="cell-miss-x">✕</span>';
          }
        } else if (this.options.showSecretShips && secretShipMap.has(cellKey)) {
          cellEl.classList.add('secret-ship');
          cellEl.innerHTML = secretShipMap.get(cellKey);
        }

        // Đánh dấu ô đang ngắm bắn trên Màn hình lớn
        if (this.selectedTarget && this.selectedTarget.teamId === team.id && this.selectedTarget.cellKey === cellKey) {
          if (!shot) {
            cellEl.classList.add('aiming-target', 'selected');
          }
        }
      });
    });
  }

  setSelectedCell(targetTeamId, cellKey) {
    // 1. Xóa mục tiêu ngắm bắn cũ
    if (this.selectedTarget) {
      const prevZone = this.zoneElements.get(Number(this.selectedTarget.teamId));
      if (prevZone) {
        const prevCell = prevZone.cells.get(this.selectedTarget.cellKey);
        if (prevCell) {
          prevCell.classList.remove('aiming-target', 'selected');
        }
      }
      this.selectedTarget = null;
    }

    if (!targetTeamId || !cellKey) return;

    // 2. Kích hoạt mục tiêu ngắm bắn mới
    const zone = this.zoneElements.get(Number(targetTeamId));
    if (!zone) return;
    const cellEl = zone.cells.get(cellKey);
    if (!cellEl) return;

    if (!cellEl.classList.contains('hit') && !cellEl.classList.contains('miss')) {
      this.selectedTarget = { teamId: Number(targetTeamId), cellKey };
      cellEl.classList.add('aiming-target', 'selected');
    }
  }

  clearSelection() {
    this.setSelectedCell(null, null);
  }

  highlightShot(targetTeamId, cellKey, isHit) {
    const zObj = this.zoneElements.get(Number(targetTeamId));
    if (!zObj) return;
    const cellEl = zObj.cells.get(cellKey);
    if (!cellEl) return;

    cellEl.classList.add('incoming-shot');
    setTimeout(() => {
      cellEl.classList.remove('incoming-shot');
      if (isHit) {
        cellEl.classList.add('hit-explode');
        setTimeout(() => cellEl.classList.remove('hit-explode'), 1000);
      }
    }, 400);
  }
}

/**
 * ------------------------------------------------------------------------
 * 2. SINGLE-ZONE RENDERER (Dành cho Điện thoại Người chơi /join)
 * Dùng để:
 * - Giai đoạn Dàn trận (Preparation): hiển thị 15x15 hạm đội 6 tàu của đội mình
 * - Giai đoạn Tác chiến: hiển thị 15x15 của 1 đội đối thủ được chọn để bắn
 * ------------------------------------------------------------------------
 */
class SingleZoneRenderer {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = {
      isInteractive: true,
      onCellClick: null,
      ...options,
    };
    this.selectedCellKey = null;
    this.cellElements = new Map(); // cellKey -> HTMLDivElement
    this.initGrid();
  }

  initGrid() {
    this.container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'single-zone-board-15x15';

    // Góc trống
    const corner = document.createElement('div');
    corner.className = 'sz-hdr-corner';
    grid.appendChild(corner);

    // Cột 1 -> 15
    COLS.forEach(c => {
      const ch = document.createElement('div');
      ch.className = 'sz-hdr-col';
      ch.textContent = c;
      grid.appendChild(ch);
    });

    // Hàng A -> O
    ROWS.forEach(r => {
      const rh = document.createElement('div');
      rh.className = 'sz-hdr-row';
      rh.textContent = r;
      grid.appendChild(rh);

      COLS.forEach(c => {
        const cellKey = `${r}${c}`;
        const cell = document.createElement('div');
        cell.className = 'sz-cell';
        cell.dataset.key = cellKey;

        cell.addEventListener('click', () => {
          this.handleCellClick(cellKey);
        });

        this.cellElements.set(cellKey, cell);
        grid.appendChild(cell);
      });
    });

    this.container.appendChild(grid);
  }

  handleCellClick(cellKey) {
    if (!this.options.isInteractive) return;
    const cellEl = this.cellElements.get(cellKey);
    if (!cellEl) return;

    // Không cho chọn ô đã bắn
    if (cellEl.classList.contains('hit') || cellEl.classList.contains('miss')) {
      return;
    }

    // Toggle selection
    if (this.selectedCellKey) {
      const prev = this.cellElements.get(this.selectedCellKey);
      if (prev) prev.classList.remove('selected');
    }

    this.selectedCellKey = cellKey;
    cellEl.classList.add('selected');

    if (typeof this.options.onCellClick === 'function') {
      this.options.onCellClick(cellKey);
    }
  }

  clearSelection() {
    if (this.selectedCellKey) {
      const prev = this.cellElements.get(this.selectedCellKey);
      if (prev) prev.classList.remove('selected');
      this.selectedCellKey = null;
    }
  }

  setSelectedCell(cellKey) {
    this.clearSelection();
    if (!cellKey) return;
    const cellEl = this.cellElements.get(cellKey);
    if (cellEl && !cellEl.classList.contains('hit') && !cellEl.classList.contains('miss')) {
      this.selectedCellKey = cellKey;
      cellEl.classList.add('selected');
    }
  }

  /**
   * Render hạm đội bí mật của chính đội mình (Giai đoạn Dàn trận)
   * Có hỗ trợ đồ họa vector tàu chiến mượt mà và viền vàng khi đang chọn
   */
  renderFleetPreview(fleet, activeShipType = null) {
    this.cellElements.forEach(cellEl => {
      cellEl.className = 'sz-cell';
      cellEl.innerHTML = '';
    });

    if (!Array.isArray(fleet)) return;

    fleet.forEach(ship => {
      if (!Array.isArray(ship.cells) || ship.cells.length === 0) return;
      const isActive = ship.type === activeShipType;
      const orient = getShipOrientation(ship.cells);

      ship.cells.forEach((cellKey, idx) => {
        const cellEl = this.cellElements.get(cellKey);
        if (cellEl) {
          cellEl.classList.add('my-ship-cell');
          if (isActive) {
            cellEl.classList.add('active-ship');
          }
          cellEl.innerHTML = getShipSegmentSVG(ship.type, idx, ship.cells.length, orient, isActive);
        }
      });
    });
  }

  /**
   * Render hải phận của đối thủ trong giai đoạn tác chiến
   * Bắn trượt: X màu đen rõ ràng; Bắn trúng: Hiện màu đỏ rực rỡ ngay ô đó
   */
  renderEnemyZone(targetTeamId, shots = {}, sunkShips = []) {
    const sunkCells = new Set();
    if (Array.isArray(sunkShips)) {
      sunkShips.forEach(s => {
        if (s.cells) s.cells.forEach(c => sunkCells.add(c));
      });
    }

    this.cellElements.forEach((cellEl, cellKey) => {
      const isSelected = cellKey === this.selectedCellKey;
      cellEl.className = 'sz-cell' + (isSelected ? ' selected' : '');
      cellEl.innerHTML = '';

      const shotKey = `${targetTeamId}_${cellKey}`;
      const shot = shots[shotKey];

      if (shot) {
        cellEl.classList.remove('selected');
        if (shot.isHit) {
          if (sunkCells.has(cellKey)) {
            cellEl.classList.add('hit-sunk');
            cellEl.innerHTML = '<span class="cell-hit-sunk">🔥</span>';
          } else {
            cellEl.classList.add('hit');
            cellEl.innerHTML = '<span class="cell-hit-marker">💥</span>';
          }
        } else {
          cellEl.classList.add('miss');
          cellEl.innerHTML = '<span class="cell-miss-x">✕</span>';
        }
      }
    });
  }
}

/**
 * Tạo vector SVG đồ họa mượt mà, chân thực cho từng khoang tàu hải quân
 */
function getShipSegmentSVG(shipType, idx, totalSize, orientation, isActive = false) {
  const isBow = idx === 0;
  const isStern = idx === totalSize - 1;
  const strokeColor = isActive ? '#fbbf24' : '#38bdf8';
  const strokeWidth = isActive ? '1.8' : '1.2';
  const glowStyle = isActive ? 'filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.9));' : '';
  const gradId = `hullGrad_${shipType}_${idx}_${orientation}_${isActive ? 'act' : 'norm'}`;

  let gradTop = '#334155';
  let gradMid = '#1e293b';
  let gradBot = '#0f172a';

  if (shipType.startsWith('CARRIER')) {
    gradTop = '#475569';
    gradMid = '#1e293b';
    gradBot = '#0b1120';
  } else if (shipType === 'BATTLESHIP') {
    gradTop = '#334155';
    gradMid = '#1e293b';
    gradBot = '#020617';
  } else if (shipType === 'CRUISER') {
    gradTop = '#0284c7';
    gradMid = '#0369a1';
    gradBot = '#0c4a6e';
  } else {
    gradTop = '#0891b2';
    gradMid = '#0e7490';
    gradBot = '#155e75';
  }

  const defs = `
    <defs>
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="${orientation === 'HORIZONTAL' ? '0%' : '100%'}" y2="${orientation === 'HORIZONTAL' ? '100%' : '0%'}">
        <stop offset="0%" stop-color="${gradTop}"/>
        <stop offset="50%" stop-color="${gradMid}"/>
        <stop offset="100%" stop-color="${gradBot}"/>
      </linearGradient>
    </defs>
  `;

  if (orientation === 'HORIZONTAL') {
    let hullPath = '';
    let details = '';

    if (isBow) {
      hullPath = 'M36,6 C24,6 12,11 3,18 C12,25 24,30 36,30 Z';
      details += `<path d="M12,18 L32,18" stroke="${strokeColor}" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.7"/>`;
      details += `<circle cx="22" cy="18" r="3" fill="#0f172a" stroke="${strokeColor}" stroke-width="1"/>`;
      if (shipType.startsWith('CARRIER')) {
        details += `<polygon points="14,18 20,15 20,21" fill="#facc15"/>`;
      }
    } else if (isStern) {
      hullPath = 'M0,6 L24,6 C31,6 36,11 36,18 C36,25 31,30 24,30 L0,30 Z';
      details += `<line x1="8" y1="10" x2="22" y2="10" stroke="#64748b" stroke-width="1"/>`;
      details += `<line x1="8" y1="26" x2="22" y2="26" stroke="#64748b" stroke-width="1"/>`;
      if (shipType.startsWith('CARRIER')) {
        details += `<text x="18" y="21" font-size="7.5" font-weight="900" fill="#f8fafc" text-anchor="middle">H</text>`;
      } else {
        details += `<circle cx="16" cy="18" r="3" fill="#1e293b" stroke="${strokeColor}" stroke-width="0.8"/>`;
      }
    } else {
      hullPath = 'M0,6 L36,6 L36,30 L0,30 Z';
      if (shipType.startsWith('CARRIER')) {
        details += `<line x1="0" y1="18" x2="36" y2="18" stroke="#facc15" stroke-width="1.2" stroke-dasharray="4,3"/>`;
        details += `<rect x="12" y="8" width="12" height="4" rx="1" fill="#0f172a" stroke="${strokeColor}" stroke-width="0.8"/>`;
      } else if (shipType === 'BATTLESHIP') {
        details += `<circle cx="18" cy="18" r="5.5" fill="#0f172a" stroke="${strokeColor}" stroke-width="1"/>`;
        details += `<line x1="18" y1="16" x2="30" y2="16" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round"/>`;
        details += `<line x1="18" y1="20" x2="30" y2="20" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round"/>`;
      } else if (shipType === 'CRUISER') {
        details += `<rect x="8" y="12" width="20" height="12" rx="1.5" fill="#0f172a" stroke="${strokeColor}" stroke-width="0.8"/>`;
        details += `<circle cx="14" cy="18" r="1.5" fill="#38bdf8"/>`;
        details += `<circle cx="22" cy="18" r="1.5" fill="#38bdf8"/>`;
      } else {
        details += `<line x1="0" y1="18" x2="36" y2="18" stroke="${strokeColor}" stroke-width="0.8" stroke-dasharray="3,3"/>`;
      }
    }

    return `<svg class="ship-segment-svg" viewBox="0 0 36 36" style="${glowStyle}">${defs}<path d="${hullPath}" fill="url(#${gradId})" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>${details}</svg>`;

  } else {
    let hullPath = '';
    let details = '';

    if (isBow) {
      hullPath = 'M6,36 C6,24 11,12 18,3 C25,12 30,24 30,36 Z';
      details += `<path d="M18,12 L18,32" stroke="${strokeColor}" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.7"/>`;
      details += `<circle cx="18" cy="22" r="3" fill="#0f172a" stroke="${strokeColor}" stroke-width="1"/>`;
      if (shipType.startsWith('CARRIER')) {
        details += `<polygon points="18,14 15,20 21,20" fill="#facc15"/>`;
      }
    } else if (isStern) {
      hullPath = 'M6,0 L6,24 C6,31 11,36 18,36 C25,31 30,24 30,0 Z';
      details += `<line x1="10" y1="8" x2="10" y2="22" stroke="#64748b" stroke-width="1"/>`;
      details += `<line x1="26" y1="8" x2="26" y2="22" stroke="#64748b" stroke-width="1"/>`;
      if (shipType.startsWith('CARRIER')) {
        details += `<text x="18" y="21" font-size="7.5" font-weight="900" fill="#f8fafc" text-anchor="middle">H</text>`;
      } else {
        details += `<circle cx="18" cy="16" r="3" fill="#1e293b" stroke="${strokeColor}" stroke-width="0.8"/>`;
      }
    } else {
      hullPath = 'M6,0 L30,0 L30,36 L6,36 Z';
      if (shipType.startsWith('CARRIER')) {
        details += `<line x1="18" y1="0" x2="18" y2="36" stroke="#facc15" stroke-width="1.2" stroke-dasharray="4,3"/>`;
        details += `<rect x="8" y="12" width="4" height="12" rx="1" fill="#0f172a" stroke="${strokeColor}" stroke-width="0.8"/>`;
      } else if (shipType === 'BATTLESHIP') {
        details += `<circle cx="18" cy="18" r="5.5" fill="#0f172a" stroke="${strokeColor}" stroke-width="1"/>`;
        details += `<line x1="16" y1="18" x2="16" y2="30" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round"/>`;
        details += `<line x1="20" y1="18" x2="20" y2="30" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round"/>`;
      } else if (shipType === 'CRUISER') {
        details += `<rect x="12" y="8" width="12" height="20" rx="1.5" fill="#0f172a" stroke="${strokeColor}" stroke-width="0.8"/>`;
        details += `<circle cx="18" cy="14" r="1.5" fill="#38bdf8"/>`;
        details += `<circle cx="18" cy="22" r="1.5" fill="#38bdf8"/>`;
      } else {
        details += `<line x1="18" y1="0" x2="18" y2="36" stroke="${strokeColor}" stroke-width="0.8" stroke-dasharray="3,3"/>`;
      }
    }

    return `<svg class="ship-segment-svg" viewBox="0 0 36 36" style="${glowStyle}">${defs}<path d="${hullPath}" fill="url(#${gradId})" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>${details}</svg>`;
  }
}

// -------------------------------------------------------------
// 3. MANUAL FLEET PLACER (HỆ THỐNG TỰ TAY ĐẶT VÀ XOAY TÀU)
// -------------------------------------------------------------

const SHIP_SPECS = [
  { type: 'CARRIER_1', name: 'Tàu sân bay I', size: 5, icon: '🚢' },
  { type: 'CARRIER_2', name: 'Tàu sân bay II', size: 5, icon: '⚓' },
  { type: 'BATTLESHIP', name: 'Thiết giáp hạm', size: 4, icon: '⛴️' },
  { type: 'CRUISER', name: 'Tàu tuần dương', size: 3, icon: '🛳️' },
  { type: 'DESTROYER_1', name: 'Tàu khu trục I', size: 2, icon: '🚤' },
  { type: 'DESTROYER_2', name: 'Tàu khu trục II', size: 2, icon: '🤿' },
];

function parseCellKey(cellKey) {
  if (!cellKey || typeof cellKey !== 'string') return null;
  const match = cellKey.trim().toUpperCase().match(/^([A-O])([1-9]|1[0-5])$/);
  if (!match) return null;
  const row = match[1];
  const col = parseInt(match[2], 10);
  const rowIdx = ROWS.indexOf(row);
  return { row, col, rowIdx, colIdx: col - 1 };
}

function getShipOrientation(cells) {
  if (!cells || cells.length <= 1) return 'HORIZONTAL';
  const p0 = parseCellKey(cells[0]);
  const p1 = parseCellKey(cells[1]);
  if (!p0 || !p1) return 'HORIZONTAL';
  return p0.row === p1.row ? 'HORIZONTAL' : 'VERTICAL';
}

function computeShipCells(startCellKey, size, orientation) {
  const parsed = parseCellKey(startCellKey);
  if (!parsed) return null;
  const isHoriz = orientation === 'HORIZONTAL';
  const cells = [];
  for (let i = 0; i < size; i++) {
    const col = isHoriz ? parsed.col + i : parsed.col;
    const rowIdx = isHoriz ? parsed.rowIdx : parsed.rowIdx + i;
    if (col < 1 || col > 15 || rowIdx < 0 || rowIdx >= ROWS.length) {
      return null; // Tràn mép bản đồ
    }
    cells.push(`${ROWS[rowIdx]}${col}`);
  }
  return cells;
}

function checkFleetCollision(fleet, excludeShipType, candidateCells) {
  const candidateSet = new Set(candidateCells);
  for (const ship of fleet) {
    if (ship.type === excludeShipType) continue;
    if (!Array.isArray(ship.cells)) continue;
    for (const c of ship.cells) {
      if (candidateSet.has(c)) return true;
    }
  }
  return false;
}

function tryShiftFit(startCellKey, size, orientation, fleet, excludeType) {
  const parsed = parseCellKey(startCellKey);
  if (!parsed) return null;
  const isHoriz = orientation === 'HORIZONTAL';

  for (let shift = 1; shift < size; shift++) {
    const col = isHoriz ? Math.max(1, parsed.col - shift) : parsed.col;
    const rowIdx = isHoriz ? parsed.rowIdx : Math.max(0, parsed.rowIdx - shift);
    const candidate = [];
    let ok = true;
    for (let i = 0; i < size; i++) {
      const c = isHoriz ? col + i : col;
      const r = isHoriz ? rowIdx : rowIdx + i;
      if (c < 1 || c > 15 || r < 0 || r >= ROWS.length) {
        ok = false;
        break;
      }
      candidate.push(`${ROWS[r]}${c}`);
    }
    if (ok && !checkFleetCollision(fleet, excludeType, candidate)) {
      return candidate;
    }
  }
  return null;
}

class ManualFleetPlacer {
  constructor({
    renderer,
    initialFleet = [],
    onFleetChange = null,
    onToast = null,
  }) {
    this.renderer = renderer;
    this.onFleetChange = onFleetChange;
    this.onToast = onToast;

    // Khởi tạo 6 tàu từ initialFleet hoặc rỗng
    this.fleet = SHIP_SPECS.map(spec => {
      const existing = Array.isArray(initialFleet) ? initialFleet.find(s => s.type === spec.type) : null;
      return {
        id: existing ? existing.id : `${spec.type}_custom`,
        type: spec.type,
        name: spec.name,
        size: spec.size,
        icon: spec.icon,
        cells: existing && Array.isArray(existing.cells) ? [...existing.cells] : [],
        hits: [],
        isSunk: false,
      };
    });

    this.activeType = 'CARRIER_1';
    this.orientation = 'HORIZONTAL'; // 'HORIZONTAL' | 'VERTICAL'

    // Kết nối click ô trên bàn cờ
    this.renderer.options.isInteractive = true;
    this.renderer.options.onCellClick = (cellKey) => {
      this.handleCellClick(cellKey);
    };

    this.updatePreview();
  }

  getShip(type) {
    return this.fleet.find(s => s.type === type);
  }

  getActiveShip() {
    return this.getShip(this.activeType);
  }

  getFleet() {
    return this.fleet.map(s => ({
      id: s.id,
      type: s.type,
      name: s.name,
      size: s.size,
      icon: s.icon,
      cells: [...s.cells],
      hits: [],
      isSunk: false,
    }));
  }

  getPlacedCount() {
    return this.fleet.filter(s => Array.isArray(s.cells) && s.cells.length === s.size).length;
  }

  getTotalCells() {
    return this.fleet.reduce((acc, s) => acc + (Array.isArray(s.cells) ? s.cells.length : 0), 0);
  }

  isValid() {
    if (this.fleet.length !== 6) return false;
    const occupied = new Set();
    for (const ship of this.fleet) {
      if (!Array.isArray(ship.cells) || ship.cells.length !== ship.size) return false;
      for (const c of ship.cells) {
        if (occupied.has(c)) return false;
        occupied.add(c);
      }
    }
    return occupied.size === 21;
  }

  selectShip(type) {
    this.activeType = type;
    const ship = this.getShip(type);
    if (ship && Array.isArray(ship.cells) && ship.cells.length > 1) {
      this.orientation = getShipOrientation(ship.cells);
    }
    this.updatePreview();
    this.triggerChange();
  }

  toggleOrientation() {
    const newOrient = this.orientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';
    const activeShip = this.getActiveShip();

    if (activeShip && Array.isArray(activeShip.cells) && activeShip.cells.length > 0) {
      const startCell = activeShip.cells[0];
      const newCells = computeShipCells(startCell, activeShip.size, newOrient);

      if (newCells && !checkFleetCollision(this.fleet, this.activeType, newCells)) {
        this.orientation = newOrient;
        activeShip.cells = newCells;
        this.updatePreview();
        this.triggerChange();
        if (this.onToast) this.onToast(`🔄 Đã xoay ${activeShip.name} sang hướng ${newOrient === 'HORIZONTAL' ? 'Ngang ↔' : 'Dọc ↕'}`, '🔄');
        return true;
      } else {
        const shifted = tryShiftFit(startCell, activeShip.size, newOrient, this.fleet, this.activeType);
        if (shifted) {
          this.orientation = newOrient;
          activeShip.cells = shifted;
          this.updatePreview();
          this.triggerChange();
          if (this.onToast) this.onToast(`🔄 Đã xoay ${activeShip.name} sang hướng ${newOrient === 'HORIZONTAL' ? 'Ngang ↔' : 'Dọc ↕'}`, '🔄');
          return true;
        }

        if (this.onToast) this.onToast('⚠️ Không thể xoay tại đây vì vướng mép hoặc tàu khác!', '⚠️');
        return false;
      }
    } else {
      this.orientation = newOrient;
      this.triggerChange();
      return true;
    }
  }

  handleCellClick(cellKey) {
    // 1. Kiểm tra xem ô vừa bấm có thuộc về một tàu đã đặt trên bàn cờ không
    const clickedShip = this.fleet.find(s => Array.isArray(s.cells) && s.cells.includes(cellKey));

    if (clickedShip) {
      if (clickedShip.type !== this.activeType) {
        // Chọn tàu này
        this.selectShip(clickedShip.type);
        if (this.onToast) {
          this.onToast(`🎯 Đã chọn ${clickedShip.name} (${clickedShip.size} ô). Chạm ô khác để dời hoặc bấm 🔄 để xoay!`, clickedShip.icon);
        }
        return;
      } else {
        // Bấm lại vào chính con tàu đang chọn -> Tự động xoay hướng!
        this.toggleOrientation();
        return;
      }
    }

    // 2. Ô bấm là ô trống -> Đặt hoặc dời con tàu đang chọn bắt đầu từ ô này
    const activeShip = this.getActiveShip();
    if (!activeShip) return;

    const candidateCells = computeShipCells(cellKey, activeShip.size, this.orientation);
    if (!candidateCells) {
      if (this.onToast) this.onToast(`⚠️ Tàu ${activeShip.name} (${activeShip.size} ô) vượt quá mép bản đồ 15x15!`, '⚠️');
      return;
    }

    if (checkFleetCollision(this.fleet, this.activeType, candidateCells)) {
      if (this.onToast) this.onToast('⚠️ Vị trí bị vướng tàu khác! Hãy chọn ô trống khác.', '⚠️');
      return;
    }

    // Đặt thành công
    activeShip.cells = candidateCells;

    // Tự động chuyển con trỏ sang tàu tiếp theo chưa được đặt (nếu có)
    const nextUnplaced = this.fleet.find(s => !Array.isArray(s.cells) || s.cells.length === 0);
    if (nextUnplaced) {
      this.activeType = nextUnplaced.type;
    }

    this.updatePreview();
    this.triggerChange();

    if (this.onToast) {
      this.onToast(`⚓ Đã đặt ${activeShip.name} tại ô ${cellKey}!`, activeShip.icon);
    }
  }

  removeActiveShip() {
    const activeShip = this.getActiveShip();
    if (activeShip) {
      activeShip.cells = [];
      this.updatePreview();
      this.triggerChange();
      if (this.onToast) this.onToast(`🗑️ Đã gỡ ${activeShip.name} khỏi bàn cờ!`, '🗑️');
    }
  }

  clearAll() {
    this.fleet.forEach(s => s.cells = []);
    this.activeType = 'CARRIER_1';
    this.orientation = 'HORIZONTAL';
    this.updatePreview();
    this.triggerChange();
    if (this.onToast) this.onToast('🧹 Đã xóa toàn bộ bàn cờ. Hãy chạm vào các ô để tự đặt từng tàu!', '🧹');
  }

  setFleet(newFleet) {
    if (!Array.isArray(newFleet)) return;
    this.fleet = SHIP_SPECS.map(spec => {
      const found = newFleet.find(s => s.type === spec.type);
      return {
        id: found ? found.id : `${spec.type}_custom`,
        type: spec.type,
        name: spec.name,
        size: spec.size,
        icon: spec.icon,
        cells: found && Array.isArray(found.cells) ? [...found.cells] : [],
        hits: [],
        isSunk: false,
      };
    });
    this.updatePreview();
    this.triggerChange();
  }

  updatePreview() {
    this.renderer.renderFleetPreview(this.fleet, this.activeType);
  }

  triggerChange() {
    if (typeof this.onFleetChange === 'function') {
      this.onFleetChange({
        fleet: this.getFleet(),
        isValid: this.isValid(),
        placedCount: this.getPlacedCount(),
        totalCells: this.getTotalCells(),
        activeShip: this.getActiveShip(),
        orientation: this.orientation,
      });
    }
  }
}

// Xuất ra window cho browser
window.ROWS = ROWS;
window.COLS = COLS;
window.SHIP_ICONS = SHIP_ICONS;
window.SHIP_SPECS = SHIP_SPECS;
window.MultiZoneRenderer = MultiZoneRenderer;
window.SingleZoneRenderer = SingleZoneRenderer;
window.ManualFleetPlacer = ManualFleetPlacer;
window.computeShipCells = computeShipCells;
window.checkFleetCollision = checkFleetCollision;
window.parseCellKey = parseCellKey;
window.getShipOrientation = getShipOrientation;
window.getShipSegmentSVG = getShipSegmentSVG;

