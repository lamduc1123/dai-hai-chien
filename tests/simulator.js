// tests/simulator.js
// Kịch bản kiểm thử tự động toàn diện mô phỏng 6 đội (bảng 15x15 x 6), dàn trận 2 phút (6 tàu 21 ô), bốc thăm ngẫu nhiên, MC và máy chiếu

const { io: ClientIO } = require('socket.io-client');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const {
  createRoom,
  getRoom,
  registerHost,
  registerScreen,
  joinTeam,
  toggleTeamReady,
  startPreparation,
  skipPreparation,
  randomizeTeamFleet,
  confirmTeamFleet,
  startGame,
  handleShot,
  undoLastShot,
  getScreenState,
  getPlayerState,
  getHostState,
  addBot,
  fillRemainingBots,
  simulateTestVictory,
  setRoomPlayerCount,
} = require('../src/room-manager');

const engine = require('../src/game-engine');

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG HỆ THỐNG ĐẠI HẢI CHIẾN 6 VÙNG 15x15');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      throw new Error(`Kiểm thử thất bại: ${message}`);
    }
  }

  // Khởi tạo Mock Server tạm thời cho Socket Client
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const TEST_PORT = 3099;

  server.listen(TEST_PORT);

  // Gắn Socket.IO handlers
  io.on('connection', (socket) => {
    socket.on('player:join', ({ roomId, teamId, representative, deviceToken, customTeamName }) => {
      const room = getRoom(roomId);
      if (!room) return socket.emit('error:message', { message: 'Phòng không tồn tại' });
      const res = joinTeam(room, { teamId, representative, deviceToken, socketId: socket.id, customTeamName });
      if (res.success) {
        socket.join(room.roomId);
        socket.emit('player:joined', { ...res, state: getPlayerState(room.gameState, res.teamId) });
      } else {
        socket.emit('error:message', { message: res.error });
      }
    });

    socket.on('player:ready', ({ roomId, teamId, isReady }) => {
      const room = getRoom(roomId);
      if (!room) return;
      const res = toggleTeamReady(room, teamId, isReady);
      if (res.success) {
        socket.emit('ready:success', { teamId, ready: res.ready });
      } else {
        socket.emit('error:message', { message: res.error });
      }
    });

    socket.on('player:randomize_fleet', ({ roomId, teamId }) => {
      const room = getRoom(roomId);
      if (!room) return;
      const res = randomizeTeamFleet(room, teamId);
      if (res.success) {
        socket.emit('player:fleet_updated', { fleet: res.fleet });
      } else {
        socket.emit('error:message', { message: res.error });
      }
    });

    socket.on('player:confirm_fleet', ({ roomId, teamId, fleet }) => {
      const room = getRoom(roomId);
      if (!room) return;
      const res = confirmTeamFleet(room, teamId, fleet);
      if (res.success) {
        socket.emit('player:fleet_confirmed');
      } else {
        socket.emit('error:message', { message: res.error });
      }
    });

    socket.on('player:fire', ({ roomId, teamId, targetCellKey, targetTeamId }) => {
      const room = getRoom(roomId);
      if (!room) return;
      const res = handleShot(room, Number(teamId), targetCellKey, targetTeamId ? Number(targetTeamId) : null);
      if (res.success) {
        io.to(room.roomId).emit('shot:executed', res);
      } else {
        socket.emit('error:message', { message: res.error });
      }
    });

    socket.on('host:start_game', ({ roomId, forceStart }) => {
      const room = getRoom(roomId);
      if (!room) return;
      const res = startGame(room, forceStart);
      if (res.success) {
        io.to(room.roomId).emit('game:started', res);
      } else {
        socket.emit('error:message', { message: res.error });
      }
    });
  });

  const SOCKET_URL = `http://localhost:${TEST_PORT}`;
  const phoneSockets = [];

  try {
    // -------------------------------------------------------------
    // Test 1: Tạo phòng mới & Cấu hình 6 chiến khu 15x15, 6 tàu 21 ô
    // -------------------------------------------------------------
    console.log('📌 Test 1: Tạo phòng mới & Cấu trúc 6 khu vực 15x15 (6 tàu = 21 ô)');
    const room = createRoom();
    assert(room && room.roomId.length === 6, `Phòng được tạo thành công: ${room.roomId}`);
    assert(room.gameState.teams.length === 6, 'Khởi tạo đủ 6 đội');
    assert(room.gameState.status === 'LOBBY', 'Trạng thái ban đầu là LOBBY');

    // Kiểm tra cấu hình hạm đội 6 tàu = 21 ô
    const team1Fleet = room.gameState.teams[0].fleet;
    assert(team1Fleet.length === 6, 'Mỗi đội có đúng 6 tàu bí mật');
    const totalCells = team1Fleet.reduce((sum, s) => sum + s.cells.length, 0);
    assert(totalCells === 21, `Hạm đội gồm đúng 21 ô (Hiện tại: ${totalCells} ô)`);
    assert(room.gameState.teams[0].totalShipCells === 21, 'totalShipCells được đặt là 21');

    // Kiểm tra tọa độ tàu nằm trọn vẹn trong bảng 15x15 (A..O, 1..15)
    let allCoordsValid = true;
    team1Fleet.forEach(ship => {
      ship.cells.forEach(c => {
        const p = engine.parseKey(c);
        if (!p || p.col < 1 || p.col > 15 || p.rowIdx < 0 || p.rowIdx > 14) {
          allCoordsValid = false;
        }
      });
    });
    assert(allCoordsValid, 'Toàn bộ tọa độ hạm đội đều nằm hợp lệ trong dải A1 -> O15');

    // -------------------------------------------------------------
    // Test 2: Bốc thăm vùng ngẫu nhiên (Random Zone Selection)
    // -------------------------------------------------------------
    console.log('\n📌 Test 2: Bốc thăm Vùng Chiến Ngẫu Nhiên (Random Zone Lottery)');
    const randomPick = joinTeam(room, {
      teamId: 'random',
      representative: 'Chiến Hạm Thần Tốc',
      deviceToken: 'device_random_1',
      socketId: 'sock_1',
    });
    assert(randomPick.success, `Bốc thăm ngẫu nhiên thành công: ${randomPick.teamName} (Chiến khu ${randomPick.zoneId})`);
    assert(randomPick.teamId >= 1 && randomPick.teamId <= 6, 'Vùng bốc thăm thuộc 1 trong 6 khu vực');

    // -------------------------------------------------------------
    // Test 3: Kết nối 5 đội còn lại
    // -------------------------------------------------------------
    console.log('\n📌 Test 3: Kết nối đầy đủ các đội còn lại vào phòng');
    for (let i = 1; i <= 6; i++) {
      if (i !== randomPick.teamId) {
        const joinRes = joinTeam(room, {
          teamId: i,
          representative: `Thuyền trưởng Đội ${i}`,
          deviceToken: `device_token_${i}`,
          socketId: `sock_${i}`,
        });
        assert(joinRes.success, `Đội ${i} tham gia thành công`);
      }
    }

    // -------------------------------------------------------------
    // Test 4: Chống chiếm trùng đội
    // -------------------------------------------------------------
    console.log('\n📌 Test 4: Chống thiết bị lạ chiếm trùng đội đã có người');
    const duplicateJoin = joinTeam(room, {
      teamId: randomPick.teamId,
      representative: 'Kẻ xâm nhập',
      deviceToken: 'device_intruder_999',
      socketId: 'sock_intruder',
    });
    assert(!duplicateJoin.success, 'Máy chủ từ chối thiết bị thứ 2 chọn trùng đội đã có người');

    // -------------------------------------------------------------
    // Test 5: Giai đoạn Dàn trận 2 phút (Preparation Phase)
    // -------------------------------------------------------------
    console.log('\n📌 Test 5: Kích hoạt Giai đoạn Dàn Trận 2 Phút (Preparation Phase)');
    let tickedSeconds = null;
    const prepResult = startPreparation(
      room,
      (sec) => { tickedSeconds = sec; },
      () => { /* complete */ }
    );
    assert(prepResult.success, 'Bắt đầu giai đoạn Dàn trận thành công');
    assert(room.gameState.status === 'PREPARATION', 'Trạng thái chuyển sang PREPARATION');
    assert(room.gameState.prepSecondsRemaining === 120, 'Bộ đếm đếm ngược được thiết lập 120 giây (2 phút)');

    // Đổi đội hình ngẫu nhiên
    const oldFleetJson = JSON.stringify(room.gameState.teams[0].fleet);
    const rerollRes = randomizeTeamFleet(room, 1);
    assert(rerollRes.success, 'Đổi đội hình ngẫu nhiên thành công');
    assert(rerollRes.fleet.length === 6, 'Hạm đội mới vẫn đủ 6 tàu');

    // Xác nhận đội hình
    const confirmRes = confirmTeamFleet(room, 1);
    assert(confirmRes.success, 'Xác nhận đội hình thành công');
    assert(room.gameState.teams[0].prepFinished === true, 'Đội 1 đã khóa vị trí đội hình');

    // MC Bỏ qua 2 phút dàn trận để vào chiến đấu ngay
    const skipPrepRes = skipPreparation(room);
    assert(skipPrepRes.success, 'MC bỏ qua thời gian chuẩn bị thành công');
    assert(room.gameState.status === 'PLAYING', 'Trận chiến lập tức chuyển sang PLAYING');

    // -------------------------------------------------------------
    // Test 6: Kiểm tra Bảo mật dữ liệu & Xáo trộn vùng, Ẩn danh đội chơi
    // -------------------------------------------------------------
    console.log('\n📌 Test 6: Kiểm tra Bảo Mật Tàu Ẩn, Xáo Trộn Vùng Chiến & Ẩn Danh Các Đội');
    const screenState = getScreenState(room.gameState);
    let screenHasFleets = false;
    screenState.teams.forEach(t => {
      if (t.fleet) screenHasFleets = true;
    });
    assert(!screenHasFleets, 'Màn hình lớn TUYỆT ĐỐI KHÔNG chứa tàu ẩn của bất kỳ đội nào');

    // Kiểm tra gán bí danh ngẫu nhiên (Vùng A..F)
    const mysteryCodes = room.gameState.teams.map(t => t.mysteryZoneCode);
    const uniqueCodes = new Set(mysteryCodes);
    assert(uniqueCodes.size === 6, 'Toàn bộ 6 đội được gán bí danh Vùng A..F không trùng lặp');
    assert(mysteryCodes.every(c => ['A', 'B', 'C', 'D', 'E', 'F'].includes(c)), 'Mỗi đội đều mang mã vùng từ A đến F');

    // Kiểm tra Màn hình lớn bị xáo trộn thứ tự và ẩn toàn bộ tên, đại diện
    const screenCodes = screenState.teams.map(t => t.mysteryZoneCode);
    assert(screenCodes.join('') === 'ABCDEF', 'Các vùng hiển thị trên màn hình được xáo trộn sắp xếp theo Vùng A -> F');
    assert(screenState.teams.every(t => t.name.startsWith('Vùng ')), 'Toàn bộ tên đội trên màn hình lớn đã được ẩn danh thành Vùng A..F');
    assert(screenState.teams.every(t => t.representative === ''), 'Toàn bộ tên đại diện các đội bị ẩn trên màn hình lớn');
    assert(screenState.teams.every(t => t.realName === undefined), 'Tên thật không bị rò rỉ trong payload màn hình lớn khi đang bắn');

    // Kiểm tra điện thoại người chơi
    const p1State = getPlayerState(room.gameState, 1);
    assert(p1State.myTeam && p1State.myTeam.fleet !== undefined, 'Đội 1 xem được đầy đủ 6 tàu của CHÍNH MÌNH');
    assert(p1State.myTeam && p1State.myTeam.mysteryZoneName !== undefined, 'Đội 1 biết rõ bí danh Vùng chiến bí mật của mình');
    let p1SeesEnemyShips = false;
    p1State.teams.forEach(t => {
      if (t.id !== 1 && t.fleet !== undefined) p1SeesEnemyShips = true;
    });
    assert(!p1SeesEnemyShips, 'Đội 1 TUYỆT ĐỐI KHÔNG nhận được vị trí tàu bí mật của 5 đối thủ');

    // Đội 1 nhìn thấy đối thủ bị ẩn danh thành Vùng A..F
    const enemyTeamsInP1 = p1State.teams.filter(t => t.id !== 1);
    assert(enemyTeamsInP1.every(e => e.name.startsWith('Vùng ')), 'Đội 1 chỉ nhìn thấy 5 đối thủ dưới dạng Vùng A..F bí ẩn');
    assert(enemyTeamsInP1.every(e => e.representative === ''), 'Đội 1 không thấy tên đại diện của đối thủ');

    // -------------------------------------------------------------
    // Test 7: Kiểm tra Luật Khai hỏa giữa 6 Chiến khu 15x15
    // -------------------------------------------------------------
    console.log('\n📌 Test 7: Khai Hỏa Tác Chiến Đối Kháng 6 Khu Vực');
    const firingTeamId = room.gameState.currentTurnTeamId;
    const targetTeam = room.gameState.teams.find(t => t.id !== firingTeamId);

    // Bắn vào chính đội mình -> Thất bại
    const selfShot = handleShot(room, firingTeamId, 'H8', firingTeamId);
    assert(!selfShot.success, 'Từ chối bắn vào chiến khu của chính đội mình');

    // Bắn vào đội đối thủ với tọa độ hợp lệ (A1..O15)
    const validShot = handleShot(room, firingTeamId, 'H8', targetTeam.id);
    assert(validShot.success, `Khai hỏa thành công vào ô H8 của ${targetTeam.name}`);
    const expectedShotKey = `${targetTeam.id}_H8`;
    assert(room.gameState.shots[expectedShotKey] !== undefined, `Phát bắn được lưu trữ dưới key ${expectedShotKey}`);
    assert(room.gameState.currentTurnTeamId !== firingTeamId, 'Lượt bắn tự động chuyển sang đội kế tiếp');

    // Bắn trùng ô cũ trên cùng đội mục tiêu -> Thất bại
    const nextTurnTeamId = room.gameState.currentTurnTeamId;
    const dupShot = handleShot(room, nextTurnTeamId, 'H8', targetTeam.id);
    assert(!dupShot.success, 'Từ chối bắn vào ô đã bị bắn trên cùng đội mục tiêu');

    // -------------------------------------------------------------
    // Test 8: Hoàn tác phát bắn (MC Undo)
    // -------------------------------------------------------------
    console.log('\n📌 Test 8: MC Hoàn Tác phát bắn (Undo)');
    const undoRes = undoLastShot(room);
    assert(undoRes.success, 'MC hoàn tác phát bắn thành công');
    assert(room.gameState.shots[expectedShotKey] === undefined, `Ô ${expectedShotKey} đã được giải phóng`);
    assert(room.gameState.currentTurnTeamId === firingTeamId, 'Lượt bắn được hoàn trả cho đội bắn trước đó');

    // -------------------------------------------------------------
    // Test 9: Luật "Đội sống sót cuối cùng là Quán Quân" & Top 3
    // -------------------------------------------------------------
    console.log('\n📌 Test 9: Luật Sinh Tồn "Đội sống sót cuối cùng thắng" & Xếp hạng Top 3');
    const simState = engine.createInitialGameState();
    simState.status = 'PLAYING';

    // Giả lập 5 đội bị loại theo thứ tự: Đội 1 (đầu tiên) -> Đội 2 -> Đội 3 -> Đội 4 -> Đội 5 (cuối cùng trước quán quân)
    // Đội 6 sống sót duy nhất
    simState.teams[0].isEliminated = true;
    simState.teams[0].score = 150;
    simState.eliminationOrder.push(1);

    simState.teams[1].isEliminated = true;
    simState.teams[1].score = 250;
    simState.eliminationOrder.push(2);

    simState.teams[2].isEliminated = true;
    simState.teams[2].score = 350;
    simState.eliminationOrder.push(3);

    simState.teams[3].isEliminated = true;
    simState.teams[3].score = 450;
    simState.eliminationOrder.push(4);

    simState.teams[4].isEliminated = true;
    simState.teams[4].score = 600;
    simState.eliminationOrder.push(5);

    simState.teams[5].score = 900; // Đội 6 sống sót cuối cùng

    const rankings = engine.calculateRankings(simState);
    assert(rankings.length === 6, 'Bảng xếp hạng đầy đủ 6 đội');
    assert(rankings[0].teamId === 6 && rankings[0].rankTitle === 'Quán Quân', '🥇 Quán Quân là Đội 6 (Đội sống sót cuối cùng)');
    assert(rankings[1].teamId === 5 && rankings[1].rankTitle === 'Á Quân', '🥈 Á Quân là Đội 5 (Đội bị loại thứ 5, sống sót lâu thứ nhì)');
    assert(rankings[2].teamId === 4 && rankings[2].rankTitle === 'Quý Quân', '🥉 Quý Quân là Đội 4 (Đội bị loại thứ 4)');
    assert(rankings[3].teamId === 3, 'Hạng 4 là Đội 3');
    assert(rankings[4].teamId === 2, 'Hạng 5 là Đội 2');
    assert(rankings[5].teamId === 1, 'Hạng 6 là Đội 1');

    // -------------------------------------------------------------
    // Test 10: Chế độ Chơi Thử Solo (Bot AI & Giả lập Top 3 Demo)
    // -------------------------------------------------------------
    console.log('\n📌 Test 10: Chế độ Chơi Thử Solo (1 Người vs 5 Bot AI & Demo Top 3)');
    const demoRoom = createRoom();
    // 1 Người chơi thật tham gia Đội 1
    joinTeam(demoRoom, { teamId: 1, representative: 'Người chơi Test', deviceToken: 'test_dev_1', socketId: 'test_user_sock' });
    toggleTeamReady(demoRoom, 1, true);
    
    // Tự động điền 5 Bot cho 5 đội còn lại
    const botFillRes = fillRemainingBots(demoRoom);
    assert(botFillRes.success, 'Điền Bot AI thành công');
    assert(botFillRes.addedCount === 5, 'Đã điền đủ đúng 5 Bot AI cho 5 vị trí còn trống');
    assert(demoRoom.bots.size === 5, 'Room lưu trữ đúng 5 Bot AI trong danh sách');
    assert(demoRoom.gameState.teams.every(t => t.connected && t.ready), 'Toàn bộ 6 đội (1 Người + 5 Bot) đều đã sẵn sàng');

    // Bắt đầu bắn thử nghiệm
    startGame(demoRoom);
    assert(demoRoom.gameState.status === 'PLAYING', 'Trận đấu demo lập tức chuyển sang PLAYING');

    // Test Giả lập Kịch bản Quán Quân Top 3
    const simWinRes = simulateTestVictory(demoRoom);
    assert(simWinRes.success, 'Kích hoạt kịch bản kết thúc chiến thắng thành công');
    assert(demoRoom.gameState.status === 'FINISHED', 'Trạng thái chuyển sang FINISHED để hiển thị Bục Vinh Danh Top 3');
    const demoRankings = engine.calculateRankings(demoRoom.gameState);
    assert(demoRankings[0].rankTitle === 'Quán Quân', 'Quán quân được xác định chuẩn xác cho màn trao giải');
    // -------------------------------------------------------------
    // Test 11: Chế độ Solo 1v1 (2 Đội) & Thay đổi số đội linh hoạt
    // -------------------------------------------------------------
    console.log('\n📌 Test 11: Chế độ Solo Đối Đầu 1v1 (2 Đội) & Bốc Thăm Vùng A-B');
    const room2p = createRoom(2);
    assert(room2p.gameState.teams.length === 2, 'Khởi tạo phòng 2 đội thành công (Đội 1 & Đội 2)');
    assert(room2p.gameState.turnOrder.length === 2, 'Thứ tự lượt đấu khởi tạo đúng cho 2 đội');

    // Người chơi tham gia Đội 1, Bot tham gia Đội 2
    joinTeam(room2p, { teamId: 1, representative: 'Duelist A', deviceToken: 'dev_duel_a' });
    toggleTeamReady(room2p, 1, true);
    const botFill2p = fillRemainingBots(room2p);
    assert(botFill2p.addedCount === 1, 'Chỉ cần điền thêm đúng 1 Bot AI cho Đội 2 trong chế độ 1v1');
    assert(room2p.gameState.teams.every(t => t.ready), 'Cả 2 đội đều đã sẵn sàng');

    // Bắt đầu trận đấu 1v1
    startGame(room2p);
    assert(room2p.gameState.status === 'PLAYING', 'Trận đấu 1v1 bắt đầu thành công');

    const zones2p = room2p.gameState.teams.map(t => t.mysteryZoneName).sort();
    assert(zones2p[0] === 'Vùng A' && zones2p[1] === 'Vùng B', 'Bí danh bí mật chỉ bốc thăm chính xác Vùng A và Vùng B cho 2 đội');

    // Đội 1 bắn chìm hết tàu của Đội 2 -> Đội 1 Quán Quân, Đội 2 Á Quân
    room2p.gameState.teams[1].isEliminated = true;
    room2p.gameState.teams[1].remainingShipsCount = 0;
    room2p.gameState.eliminationOrder = [2];
    room2p.gameState.teams[0].score = 500;
    room2p.gameState.teams[1].score = 150;
    const rank2p = engine.calculateRankings(room2p.gameState);
    assert(rank2p.length === 2, 'Bảng xếp hạng trận 1v1 có đúng 2 đội');
    assert(rank2p[0].rank === 1 && rank2p[0].rankTitle === 'Quán Quân' && rank2p[0].medal === '🥇', 'Đội 1 là Quán Quân (Top 1)');
    assert(rank2p[1].rank === 2 && rank2p[1].rankTitle === 'Á Quân' && rank2p[1].medal === '🥈', 'Đội 2 là Á Quân (Top 2)');

    // -------------------------------------------------------------
    // Test 12: Chuyển đổi số đội linh hoạt (setRoomPlayerCount) & 4 Đội
    // -------------------------------------------------------------
    console.log('\n📌 Test 12: Chuyển đổi linh hoạt số đội trong phòng chờ (4 Đội)');
    const flexRoom = createRoom(6);
    assert(flexRoom.gameState.teams.length === 6, 'Phòng ban đầu có 6 đội');

    // MC đổi thành 4 đội
    const set4Res = setRoomPlayerCount(flexRoom, 4);
    assert(set4Res.success && flexRoom.gameState.teams.length === 4, 'Đã chuyển đổi số đội thành công từ 6 xuống 4 đội');
    assert(flexRoom.gameState.turnOrder.length === 4, 'Thứ tự lượt đấu cập nhật về 4 đội');

    // MC đổi thành 3 đội rồi quay lại 4 đội
    setRoomPlayerCount(flexRoom, 3);
    assert(flexRoom.gameState.teams.length === 3, 'Chuyển về 3 đội thành công');
    setRoomPlayerCount(flexRoom, 4);
    assert(flexRoom.gameState.teams.length === 4, 'Chuyển lại 4 đội thành công với đầy đủ dữ liệu hạm đội 6 tàu');

    // Điền Bot AI cho 4 đội
    const botFill4p = fillRemainingBots(flexRoom);
    assert(botFill4p.addedCount === 4, 'Điền đúng 4 Bot AI cho 4 đội');

    startGame(flexRoom);
    const zones4p = flexRoom.gameState.teams.map(t => t.mysteryZoneName).sort();
    assert(zones4p.join(',') === 'Vùng A,Vùng B,Vùng C,Vùng D', '4 đội được phân bổ đúng Vùng A, B, C, D');

    // -------------------------------------------------------------
    // Test 13: Bảo vệ an toàn khi trận đấu đang diễn ra
    // -------------------------------------------------------------
    console.log('\n📌 Test 13: Bảo vệ an toàn - Không cho phép đổi số đội khi đang chiến đấu');
    const invalidSetRes = setRoomPlayerCount(flexRoom, 2);
    assert(!invalidSetRes.success, 'Từ chối thay đổi số đội khi trận đấu đang PLAYING');

    // -------------------------------------------------------------
    // Test 14: Nguyên tắc hiển thị vùng chiến (Strict Zero Excess Zones & Reject Invalid Target)
    // -------------------------------------------------------------
    console.log('\n📌 Test 14: Nguyên tắc hiển thị vùng chiến & Chặn bắn vào vùng không tồn tại');
    [2, 3, 4, 5, 6].forEach(count => {
      const roomTest = createRoom(count);
      assert(roomTest.gameState.teams.length === count, `Tạo phòng ${count} đội: gameState.teams có đúng chính xác ${count} đội`);
      assert(getScreenState(roomTest.gameState).teams.length === count, `Màn hình lớn chỉ nhận đúng ${count} vùng chiến, tuyệt đối không có vùng dư`);
    });

    // Thử bắn vào vùng chiến không tồn tại trong phòng 2 đội
    const testRoom2 = createRoom(2);
    joinTeam(testRoom2, { teamId: 1, representative: 'Captain 1', deviceToken: 'dev_1' });
    joinTeam(testRoom2, { teamId: 2, representative: 'Captain 2', deviceToken: 'dev_2' });
    toggleTeamReady(testRoom2, 1, true);
    toggleTeamReady(testRoom2, 2, true);
    startGame(testRoom2);

    // Đảm bảo lượt bắn thuộc về Đội 1 để kiểm tra lỗi chọn mục tiêu
    testRoom2.gameState.currentTurnTeamId = 1;

    // Đội 1 thử bắn vào Đội 3 (không tồn tại trong phòng 2 đội)
    const invalidShotRes = handleShot(testRoom2, 1, 'H8', 3);
    assert(!invalidShotRes.success, 'Chặn thành công: Không cho phép bắn vào vùng chiến không tồn tại (Đội 3 trong phòng 2 đội)');
    assert(invalidShotRes.error === 'Vùng chiến mục tiêu không tồn tại trong trận đấu này!', 'Thông báo lỗi chính xác khi bắn vào vùng không tồn tại');

    // -------------------------------------------------------------
    // Test 15: Kiểm tra Toàn Diện Đoạn Đặt Tàu 2 Phút (Preparation Phase) & MC Reveal
    // -------------------------------------------------------------
    console.log('\n📌 Test 15: Kiểm tra Toàn Diện Đoạn Đặt Tàu 2 Phút & Quyền MC');
    const prepTestRoom = createRoom(6);
    joinTeam(prepTestRoom, { teamId: 1, representative: 'Captain 1', deviceToken: 'dev_1' });
    fillRemainingBots(prepTestRoom);

    // Kích hoạt đoạn đặt tàu
    const startPrepRes = startPreparation(prepTestRoom);
    assert(startPrepRes.success, 'Khởi động thành công đoạn đặt tàu 2 phút');
    assert(prepTestRoom.gameState.status === 'PREPARATION', 'Trạng thái chuyển sang PREPARATION chuẩn');
    assert(prepTestRoom.gameState.prepSecondsRemaining === 120, 'Bộ đếm đếm ngược đặt ở 120 giây');

    // Kiểm tra payload Người chơi (Phone): Thấy đủ 6 tàu 21 ô của mình
    const playerP1State = getPlayerState(prepTestRoom.gameState, 1);
    assert(playerP1State.myTeam && playerP1State.myTeam.fleet.length === 6, 'Điện thoại Đội 1 nhận đủ 6 tàu của mình để dàn trận');
    const p1Cells = playerP1State.myTeam.fleet.reduce((acc, s) => acc + s.cells.length, 0);
    assert(p1Cells === 21, 'Tổng số ô tàu của Đội 1 đúng 21 ô (2 tàu 5, 1 tàu 4, 1 tàu 3, 2 tàu 2)');

    // Đổi đội hình ngẫu nhiên
    const randRes = randomizeTeamFleet(prepTestRoom, 1);
    assert(randRes.success && randRes.fleet.length === 6, 'Đổi đội hình ngẫu nhiên thành công với đủ 6 tàu');

    // Khóa đội hình
    const prepConfirmRes = confirmTeamFleet(prepTestRoom, 1);
    assert(prepConfirmRes.success, 'Khóa đội hình thành công');
    assert(prepTestRoom.gameState.teams.find(t => t.id === 1).prepFinished === true, 'Đội 1 được đánh dấu đã khóa đội hình');

    // Kiểm tra payload MC Host: Có đầy đủ thông tin tàu của tất cả 6 đội
    const prepHostState = getHostState(prepTestRoom.gameState);
    assert(prepHostState.teams.every(t => t.fleet && t.fleet.length === 6), 'MC Host State có đầy đủ 6 tàu của tất cả các đội để kiểm tra');

    // Kiểm tra payload Màn hình lớn (Screen): Tuyệt đối không rò rỉ tàu ẩn của các đội
    const prepScreenState = getScreenState(prepTestRoom.gameState);
    assert(prepScreenState.teams.every(t => t.fleet === undefined), 'Screen State tuyệt đối không rò rỉ vị trí tàu bí mật ra màn hình lớn');

    // Dọn dẹp timer
    if (prepTestRoom.prepInterval) {
      clearInterval(prepTestRoom.prepInterval);
    }

    // -------------------------------------------------------------
    // Test 16: Tự Đặt Tàu Thủ Công & Kiểm Tra Tính Hợp Lệ Của Hạm Đội
    // -------------------------------------------------------------
    console.log('\n📌 Test 16: Tự Đặt Tàu Thủ Công & Xác Thực Hạm Đội 6 Tàu');

    // 1. Hạm đội thủ công chuẩn chỉnh (2 tàu 5, 1 tàu 4, 1 tàu 3, 2 tàu 2)
    const validManualFleet = [
      { type: 'CARRIER_1', size: 5, cells: ['A1', 'A2', 'A3', 'A4', 'A5'] },
      { type: 'CARRIER_2', size: 5, cells: ['C1', 'C2', 'C3', 'C4', 'C5'] },
      { type: 'BATTLESHIP', size: 4, cells: ['E1', 'F1', 'G1', 'H1'] },
      { type: 'CRUISER', size: 3, cells: ['J10', 'K10', 'L10'] },
      { type: 'DESTROYER_1', size: 2, cells: ['M3', 'M4'] },
      { type: 'DESTROYER_2', size: 2, cells: ['O14', 'O15'] },
    ];

    const valResult1 = engine.validateCustomFleet(validManualFleet);
    assert(valResult1.valid === true, 'Hạm đội thủ công hợp lệ được chấp nhận');

    // 2. Kiểm tra lỗi thiếu ô (tàu CARRIER_1 chỉ có 4 ô thay vì 5)
    const invalidSizeFleet = [
      { type: 'CARRIER_1', size: 5, cells: ['A1', 'A2', 'A3', 'A4'] },
      { type: 'CARRIER_2', size: 5, cells: ['C1', 'C2', 'C3', 'C4', 'C5'] },
      { type: 'BATTLESHIP', size: 4, cells: ['E1', 'F1', 'G1', 'H1'] },
      { type: 'CRUISER', size: 3, cells: ['J10', 'K10', 'L10'] },
      { type: 'DESTROYER_1', size: 2, cells: ['M3', 'M4'] },
      { type: 'DESTROYER_2', size: 2, cells: ['O14', 'O15'] },
    ];
    const valResult2 = engine.validateCustomFleet(invalidSizeFleet);
    assert(valResult2.valid === false, 'Từ chối hạm đội khi có tàu chưa đặt đủ kích thước');

    // 3. Kiểm tra lỗi đè tàu (2 tàu cùng đè lên ô A1)
    const overlapFleet = [
      { type: 'CARRIER_1', size: 5, cells: ['A1', 'A2', 'A3', 'A4', 'A5'] },
      { type: 'CARRIER_2', size: 5, cells: ['A1', 'B1', 'C1', 'D1', 'E1'] },
      { type: 'BATTLESHIP', size: 4, cells: ['F1', 'G1', 'H1', 'I1'] },
      { type: 'CRUISER', size: 3, cells: ['J10', 'K10', 'L10'] },
      { type: 'DESTROYER_1', size: 2, cells: ['M3', 'M4'] },
      { type: 'DESTROYER_2', size: 2, cells: ['O14', 'O15'] },
    ];
    const valResult3 = engine.validateCustomFleet(overlapFleet);
    assert(valResult3.valid === false, 'Từ chối hạm đội khi các tàu bị đè vị trí lên nhau');

    // 4. Kiểm tra lỗi đứt đoạn không liền mạch (gap A1, A2, A4, A5, A6 thiếu A3)
    const gapFleet = [
      { type: 'CARRIER_1', size: 5, cells: ['A1', 'A2', 'A4', 'A5', 'A6'] },
      { type: 'CARRIER_2', size: 5, cells: ['C1', 'C2', 'C3', 'C4', 'C5'] },
      { type: 'BATTLESHIP', size: 4, cells: ['E1', 'F1', 'G1', 'H1'] },
      { type: 'CRUISER', size: 3, cells: ['J10', 'K10', 'L10'] },
      { type: 'DESTROYER_1', size: 2, cells: ['M3', 'M4'] },
      { type: 'DESTROYER_2', size: 2, cells: ['O14', 'O15'] },
    ];
    const valResult4 = engine.validateCustomFleet(gapFleet);
    assert(valResult4.valid === false, 'Từ chối tàu bị đứt đoạn không thẳng hàng liên tiếp');

    // 5. Kiểm tra lỗi đặt tàu chéo không hợp lệ (A1, B2, C3)
    const diagonalFleet = [
      { type: 'CARRIER_1', size: 5, cells: ['A1', 'A2', 'A3', 'A4', 'A5'] },
      { type: 'CARRIER_2', size: 5, cells: ['C1', 'C2', 'C3', 'C4', 'C5'] },
      { type: 'BATTLESHIP', size: 4, cells: ['E1', 'F1', 'G1', 'H1'] },
      { type: 'CRUISER', size: 3, cells: ['A1', 'B2', 'C3'] },
      { type: 'DESTROYER_1', size: 2, cells: ['M3', 'M4'] },
      { type: 'DESTROYER_2', size: 2, cells: ['O14', 'O15'] },
    ];
    const valResult5 = engine.validateCustomFleet(diagonalFleet);
    assert(valResult5.valid === false, 'Từ chối tàu đặt theo đường chéo');

    // 6. Kiểm tra đặt đội hình thủ công trong room qua confirmTeamFleet
    const manualTestRoom = createRoom(6);
    joinTeam(manualTestRoom, { teamId: 1, representative: 'Thuyền Trưởng Test', deviceToken: 'dev_manual' });
    startPreparation(manualTestRoom);

    // Xác nhận hạm đội thủ công hợp lệ
    const manualConfirmRes = confirmTeamFleet(manualTestRoom, 1, validManualFleet);
    assert(manualConfirmRes.success === true, 'Xác nhận hạm đội tự đặt thủ công thành công trong phòng');
    const manualTeam1Fleet = manualTestRoom.gameState.teams.find(t => t.id === 1).fleet;
    assert(manualTeam1Fleet[0].cells[0] === 'A1' && manualTeam1Fleet[0].cells[4] === 'A5', 'Hạm đội của đội được cập nhật chính xác theo vị trí tự đặt');

    // -------------------------------------------------------------
    // Test 17: Kiểm Tra Hiển Thị Bắn Trúng (Màu Đỏ), Bắn Trượt (X Đen) & Ưu Tiên Lượt Người Chơi
    // -------------------------------------------------------------
    console.log('\n📌 Test 17: Kiểm Tra Bắn Trúng (Màu Đỏ), Bắn Trượt (X Đen) & Ưu Tiên Lượt Người Chơi');

    const testRoomHitMiss = createRoom(6);
    joinTeam(testRoomHitMiss, { teamId: 1, representative: 'Human Captain', deviceToken: 'dev_human' });
    fillRemainingBots(testRoomHitMiss);

    // Bắt đầu dàn trận
    startPreparation(testRoomHitMiss);

    // Xác nhận hạm đội Đội 1 với tọa độ biết trước
    confirmTeamFleet(testRoomHitMiss, 1, validManualFleet);

    // Bắt đầu bắn
    startGame(testRoomHitMiss);

    // 1. Kiểm tra Người chơi thật (Đội 1) được ưu tiên bắn trước
    assert(testRoomHitMiss.gameState.currentTurnTeamId === 1, 'Người chơi thật Đội 1 được ưu tiên lượt bắn đầu tiên khi thi đấu với Bot');

    // 2. Đội 1 bắn trúng vào 1 ô có tàu của Đội 2
    const team2 = testRoomHitMiss.gameState.teams.find(t => t.id === 2);
    const knownTargetCell = team2.fleet[0].cells[0]; // chắc chắn có tàu
    const hitRes = handleShot(testRoomHitMiss, 1, knownTargetCell, 2);
    assert(hitRes.success === true, 'Khai hỏa trúng đích thành công');
    assert(hitRes.shot.isHit === true, 'Phát bắn xác nhận trúng tàu (isHit = true -> Hiển thị MÀU ĐỎ)');
    assert(testRoomHitMiss.gameState.shots[`2_${knownTargetCell}`].isHit === true, 'Dữ liệu phát bắn lưu trữ trạng thái trúng đích');

    // 3. Cho Đội 1 bắn tiếp 1 ô chắc chắn trượt (không có tàu)
    testRoomHitMiss.gameState.currentTurnTeamId = 1; // đặt lại lượt cho Đội 1 test
    const allOccupiedTeam2 = new Set();
    team2.fleet.forEach(s => s.cells.forEach(c => allOccupiedTeam2.add(c)));
    let emptyCell = 'A1';
    for (const r of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']) {
      for (let c = 1; c <= 15; c++) {
        const k = `${r}${c}`;
        if (!allOccupiedTeam2.has(k) && !testRoomHitMiss.gameState.shots[`2_${k}`]) {
          emptyCell = k;
          break;
        }
      }
    }
    const missRes = handleShot(testRoomHitMiss, 1, emptyCell, 2);
    assert(missRes.success === true, 'Khai hỏa vào ô trống thành công');
    assert(missRes.shot.isHit === false, 'Phát bắn xác nhận trượt vào nước (isHit = false -> Hiển thị X ĐEN)');
    assert(testRoomHitMiss.gameState.shots[`2_${emptyCell}`].isHit === false, 'Dữ liệu phát bắn lưu trữ trạng thái bắn trượt');

    // Dọn dẹp timer
    if (testRoomHitMiss.prepInterval) {
      clearInterval(testRoomHitMiss.prepInterval);
    }

    server.close();

    console.log('\n===============================================================');
    console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} BÀI KIỂM THỬ ĐÃ VƯỢT QUA XUẤT SẮC!`);
    console.log('===============================================================\n');

    process.exit(0);
  } catch (error) {
    server.close();
    console.error('\n❌ Gặp sự cố trong quá trình kiểm thử:', error);
    process.exit(1);
  }
}

runTestSuite();
