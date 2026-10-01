// server.js
// Máy chủ Đại Hải Chiến: Express + Socket.IO + Tự động dò IP LAN + Dynamic QR Code + Bot AI

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const {
  createRoom,
  getRoom,
  registerHost,
  registerScreen,
  updateRoomConfig,
  addBot,
  fillRemainingBots,
  joinTeam,
  leaveTeam,
  toggleTeamReady,
  startPlacement,
  autoPlaceTeamFleet,
  lockTeamFleet,
  startBattle,
  handleShot,
  handleCrossfire,
  manualChangeTurn,
  undoShot,
  resetGame,
  handleDisconnect,
  getScreenState,
  getPlayerState,
  getHostState,
} = require('./src/room-manager');

const { calculateBotTarget } = require('./src/game-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Tự động tìm IP LAN máy chủ
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal && alias.address !== '127.0.0.1') {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLocalIpAddress();

// Tạo sẵn 1 phòng mặc định
let defaultRoom = createRoom({ playerCount: 4, shipsPerPlayer: 2, shipConfigMode: 'mix34' });

/**
 * Tự động kích hoạt lượt bắn của Bot nếu đến lượt Bot
 */
function triggerBotTurnIfNeeded(room) {
  if (!room || room.gameState.phase !== 'BATTLE') return;

  const currentTeam = room.gameState.teams.find(t => t.id === room.gameState.currentTurnTeamId);
  if (!currentTeam || !currentTeam.isBot || currentTeam.isEliminated) return;

  if (room.botTurnTimer) {
    clearTimeout(room.botTurnTimer);
  }

  room.botTurnTimer = setTimeout(() => {
    if (room.gameState.phase !== 'BATTLE' || room.gameState.currentTurnTeamId !== currentTeam.id) return;

    const targetKey = calculateBotTarget(room.gameState, currentTeam.id);
    if (!targetKey) return;

    const shotRes = handleShot(room.roomId, currentTeam.id, targetKey);
    if (shotRes.success) {
      io.to(room.roomId).emit('battle:shot_fired', shotRes.shotRecord);
      broadcastRoomState(room);
    }
  }, 1300); // 1.3 giây suy nghĩ mô phỏng người thật
}

/**
 * Phát broadcast trạng thái an toàn (Zero-Leak) tới từng màn hình
 */
function broadcastRoomState(room) {
  if (!room) return;

  // 1. Gửi cho MC Host
  if (room.sockets.host) {
    const hostState = getHostState(room.gameState);
    io.to(room.sockets.host).emit('host:state_update', hostState);
  }

  // 2. Gửi cho Màn hình lớn (Trình chiếu)
  const screenState = getScreenState(room.gameState);
  for (const sId of room.sockets.screens) {
    io.to(sId).emit('screen:state_update', screenState);
  }

  // 3. Gửi riêng cho từng Điện thoại (chỉ có tàu của mình)
  for (const [teamId, sId] of room.sockets.teams.entries()) {
    const playerState = getPlayerState(room.gameState, teamId);
    if (playerState) {
      io.to(sId).emit('player:state_update', playerState);
    }
  }

  // Kích hoạt chu kỳ Bot nếu cần
  triggerBotTurnIfNeeded(room);
}

// -------------------------------------------------------------
// HTTP ROUTES
// -------------------------------------------------------------

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/screen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'screen.html'));
});

app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/', (req, res) => {
  res.redirect('/host');
});

app.get('/api/network-info', (req, res) => {
  const hostHeader = req.get('host');
  const protocol = req.protocol;
  const baseUrl = hostHeader ? `${protocol}://${hostHeader}` : `http://${LAN_IP}:${PORT}`;
  const roomId = req.query.room || defaultRoom.roomId;
  const joinUrl = `${baseUrl}/join?room=${roomId}`;

  res.json({
    lanIp: LAN_IP,
    port: PORT,
    baseUrl,
    roomId,
    joinUrl,
  });
});

app.get('/api/qr', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Thiếu tham số url' });
    }
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 380,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
    res.json({ dataUrl: qrDataUrl, url: targetUrl });
  } catch (err) {
    res.status(500).json({ error: 'Không thể tạo mã QR', details: err.message });
  }
});

// -------------------------------------------------------------
// WEBSOCKET (SOCKET.IO) HANDLERS
// -------------------------------------------------------------

io.on('connection', (socket) => {
  // 1. Host kết nối
  socket.on('host:register', ({ roomId }) => {
    let targetRoomId = roomId ? roomId.toUpperCase() : defaultRoom.roomId;
    let room = getRoom(targetRoomId);
    if (!room) {
      room = defaultRoom;
      targetRoomId = room.roomId;
    }

    registerHost(targetRoomId, socket.id);
    socket.join(targetRoomId);

    socket.emit('host:registered', {
      roomId: targetRoomId,
      hostToken: room.hostToken,
      state: getHostState(room.gameState),
    });

    broadcastRoomState(room);
  });

  // 2. Màn hình máy chiếu kết nối
  socket.on('screen:register', ({ roomId }) => {
    let targetRoomId = roomId ? roomId.toUpperCase() : defaultRoom.roomId;
    let room = getRoom(targetRoomId);
    if (!room) {
      room = defaultRoom;
      targetRoomId = room.roomId;
    }

    registerScreen(targetRoomId, socket.id);
    socket.join(targetRoomId);

    socket.emit('screen:registered', {
      roomId: targetRoomId,
      state: getScreenState(room.gameState),
    });

    broadcastRoomState(room);
  });

  // 3. MC cập nhật cấu hình phòng
  socket.on('host:update_config', ({ roomId, config }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const ok = updateRoomConfig(roomId, config);
    if (ok) {
      broadcastRoomState(room);
    }
  });

  // 4. Thêm 1 máy (Bot)
  socket.on('host:add_bot', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    addBot(roomId);
    broadcastRoomState(room);
  });

  // 5. Lấp đầy tất cả bằng máy (Bot)
  socket.on('host:fill_bots', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    fillRemainingBots(roomId);
    broadcastRoomState(room);
  });

  // 6. MC bấm Bắt đầu Dàn trận (Placement)
  socket.on('host:start_placement', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const ok = startPlacement(roomId);
    if (ok) {
      io.to(roomId).emit('phase:changed', { phase: 'PLACEMENT' });
      broadcastRoomState(room);
    }
  });

  // 7. MC bấm Bắt đầu Chiến Đấu (Battle)
  socket.on('host:start_battle', ({ roomId, manualTurnOrder }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const ok = startBattle(roomId, manualTurnOrder);
    if (ok) {
      io.to(roomId).emit('phase:changed', { phase: 'BATTLE' });
      broadcastRoomState(room);
    }
  });

  // 8. MC chuyển lượt thủ công
  socket.on('host:manual_turn', ({ roomId, targetTeamId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const ok = manualChangeTurn(roomId, targetTeamId);
    if (ok) {
      broadcastRoomState(room);
    }
  });

  // 9. MC Hoàn tác phát bắn (Undo)
  socket.on('host:undo', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const ok = undoShot(roomId);
    if (ok) {
      io.to(roomId).emit('battle:shot_undone');
      broadcastRoomState(room);
    }
  });

  // 10. MC Đặt lại ván chơi mới (Reset)
  socket.on('host:reset', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const ok = resetGame(roomId);
    if (ok) {
      io.to(roomId).emit('phase:changed', { phase: 'LOBBY' });
      broadcastRoomState(room);
    }
  });

  // 11. Điện thoại người chơi tham gia (/join)
  socket.on('player:join', ({ roomId, teamId, playerName, deviceToken }) => {
    let targetRoomId = roomId ? roomId.toUpperCase() : defaultRoom.roomId;
    let room = getRoom(targetRoomId);
    if (!room) {
      room = defaultRoom;
      targetRoomId = room.roomId;
    }

    const joinRes = joinTeam(targetRoomId, {
      teamId,
      playerName,
      deviceToken,
      socketId: socket.id,
    });

    if (!joinRes.success) {
      return socket.emit('player:join_error', { error: joinRes.error });
    }

    socket.join(targetRoomId);
    socket.emit('player:joined', {
      roomId: targetRoomId,
      teamId: joinRes.teamId,
      deviceToken: joinRes.deviceToken,
      state: getPlayerState(room.gameState, joinRes.teamId),
    });

    broadcastRoomState(room);
  });

  // 11b. Người chơi đổi đội / rời phòng
  socket.on('player:leave', ({ roomId, teamId, deviceToken }) => {
    let targetRoomId = roomId ? roomId.toUpperCase() : defaultRoom.roomId;
    let room = getRoom(targetRoomId);
    if (!room) return;

    leaveTeam(targetRoomId, { teamId, deviceToken });
    broadcastRoomState(room);
  });

  // 12. Người chơi bấm Sẵn Sàng
  socket.on('player:ready', ({ roomId, teamId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    toggleTeamReady(roomId, teamId);
    broadcastRoomState(room);
  });

  // 13. Người chơi bấm Xếp tàu tự động
  socket.on('player:auto_place', ({ roomId, teamId }) => {
    const res = autoPlaceTeamFleet(roomId, teamId);
    const room = getRoom(roomId);
    if (room) {
      broadcastRoomState(room);
    }
  });

  // 14. Người chơi khóa hạm đội
  socket.on('player:lock_fleet', ({ roomId, teamId, fleet }) => {
    const res = lockTeamFleet(roomId, teamId, fleet);
    if (!res.success) {
      return socket.emit('player:placement_error', { error: res.error });
    }
    const room = getRoom(roomId);
    if (room) {
      broadcastRoomState(room);
    }
  });

  // 15. Người chơi Khai Hỏa (Fire shot)
  socket.on('player:fire', ({ roomId, teamId, targetKey }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const shotRes = handleShot(roomId, teamId, targetKey);
    if (!shotRes.success) {
      return socket.emit('player:fire_error', { error: shotRes.error });
    }

    io.to(roomId).emit('battle:shot_fired', shotRes.shotRecord);
    broadcastRoomState(room);
  });

  // 15c. Người chơi Bắn Tên lửa Chữ Thập (+)
  socket.on('player:crossfire', ({ roomId, teamId, centerKey }) => {
    const room = getRoom(roomId);
    if (!room) return;

    const crossRes = handleCrossfire(roomId, teamId, centerKey);
    if (!crossRes.success) {
      return socket.emit('player:fire_error', { error: crossRes.error });
    }

    io.to(roomId).emit('battle:shot_fired', crossRes.crossfireRecord);
    broadcastRoomState(room);
  });

  // 16. Ngắt kết nối
  socket.on('disconnect', () => {
    const room = handleDisconnect(socket.id);
    if (room) {
      broadcastRoomState(room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`⚓ MÁY CHỦ ĐẠI HẢI CHIẾN (200 Ô - 20x10) ĐÃ KHỞI CHẠY!`);
  console.log(`📡 Mạng LAN / Wi-Fi : http://${LAN_IP}:${PORT}`);
  console.log(`🖥️  Màn hình MC/Máy chiếu: http://${LAN_IP}:${PORT}/host`);
  console.log(`📱 Điện thoại người chơi: http://${LAN_IP}:${PORT}/join`);
  console.log(`====================================================`);
});
