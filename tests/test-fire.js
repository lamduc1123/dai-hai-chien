const { io } = require('socket.io-client');

async function testFire() {
  const res = await fetch('http://localhost:3000/api/create-room?playerCount=2', { method: 'POST' });
  const data = await res.json();
  console.log('Room created:', data.roomId);

  const socket = io('http://localhost:3000');
  
  socket.on('connect', () => {
    console.log('Socket connected');
    socket.emit('host:register', { roomId: data.roomId, hostToken: data.hostToken });
    socket.emit('screen:register', { roomId: data.roomId });
    socket.emit('player:join', {
      roomId: data.roomId,
      teamId: 1,
      representative: 'User',
      deviceToken: 'test_token',
    });
    
    setTimeout(() => {
      socket.emit('host:fill_bots', { roomId: data.roomId });
      socket.emit('player:ready', { roomId: data.roomId, teamId: 1, isReady: true });
      setTimeout(() => {
        socket.emit('host:start_game', { roomId: data.roomId });
        setTimeout(() => {
          socket.emit('host:skip_prep', { roomId: data.roomId });
        }, 300);
      }, 300);
    }, 300);
  });

  socket.on('game:started', (d) => {
    console.log('Game started! First turn:', d.firstTurnTeamId);
    setTimeout(() => {
      console.log('Emitting player:fire at Team 2 cell M9...');
      socket.emit('player:fire', {
        roomId: data.roomId,
        teamId: 1,
        targetTeamId: 2,
        targetCellKey: 'M9',
      });
    }, 400);
  });

  socket.on('shot:executed', ({ shot }) => {
    console.log('SHOT EXECUTED EVENT RECEIVED:', shot);
  });

  socket.on('game:state_update', (state) => {
    console.log('STATE UPDATE: status =', state.status, 'shots count =', Object.keys(state.shots || {}).length);
    if (Object.keys(state.shots || {}).length > 0) {
      console.log('Shots keys:', Object.keys(state.shots));
      console.log('Shot sample:', state.shots[Object.keys(state.shots)[0]]);
    }
  });

  socket.on('error:message', (err) => {
    console.error('ERROR MESSAGE RECEIVED:', err);
  });

  setTimeout(() => {
    console.log('Test complete, closing...');
    socket.disconnect();
    process.exit(0);
  }, 4000);
}

testFire().catch(console.error);
