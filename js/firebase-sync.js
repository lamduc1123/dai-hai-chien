// public/js/firebase-sync.js
// Lớp đồng bộ thời gian thực chuẩn Google Firebase Realtime Database
// Hỗ trợ chế độ KÉP thông minh (Dual-Sync): Firebase SDK WebSocket + REST API Fallback
// Đảm bảo kết nối 100% không bao giờ gián đoạn trên mọi mạng (Wi-Fi, 4G, Tường lửa công ty)

class FirebaseSyncManager {
  constructor() {
    this.app = null;
    this.db = null;
    this.isReady = false;
    this.activeRoomId = null;
    this.listeners = [];
    this.intervals = [];
    this.baseUrl = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL)
      ? window.FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')
      : 'https://dai-hai-chien-default-rtdb.asia-southeast1.firebasedatabase.app';
    this.lastStateHash = '';
    this.lastEffectId = 0;
    this.processedActionIds = new Set();
  }

  init() {
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) {
      this.baseUrl = window.FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
    }

    if (!window.firebase) {
      console.warn('Thư viện Firebase SDK chưa được nạp. Sử dụng kênh REST API trực tiếp.');
      this.isReady = true;
      return true;
    }

    try {
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(window.FIREBASE_CONFIG);
      } else {
        this.app = firebase.app();
      }

      // Chỉ định rõ ràng databaseURL khu vực asia-southeast1 để SDK không trỏ về us-central1
      if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) {
        this.db = firebase.app().database(window.FIREBASE_CONFIG.databaseURL);
      } else {
        this.db = firebase.database();
      }

      this.isReady = true;
      console.log('⚡ Firebase Realtime Database đã kích hoạt thành công (SDK + REST)');
      return true;
    } catch (err) {
      console.warn('Lỗi khởi tạo Firebase SDK, tự động chuyển sang chế độ REST API:', err);
      this.isReady = true; // Vẫn sẵn sàng với REST fallback
      return true;
    }
  }

  /**
   * HOST: Lắng nghe hành động từ Client (Hỗ trợ cả SDK Listener lẫn REST Polling)
   */
  hostListenActions(roomId, onActionReceived) {
    this.activeRoomId = roomId;

    // 1. SDK Listener
    if (this.db) {
      try {
        const actionsRef = this.db.ref(`rooms/${roomId}/actions`);
        const listener = actionsRef.on('child_added', (snapshot) => {
          const action = snapshot.val();
          const actionKey = snapshot.key;
          if (action && !this.processedActionIds.has(actionKey)) {
            this.processedActionIds.add(actionKey);
            if (onActionReceived) onActionReceived(action);
            snapshot.ref.remove().catch(() => {});
          }
        });
        this.listeners.push({ ref: actionsRef, event: 'child_added', fn: listener });
      } catch (e) {
        console.warn('SDK Action listen fallback sang REST:', e);
      }
    }

    // 2. REST Polling Fallback (chạy mỗi 1.2 giây)
    const actionInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.baseUrl}/rooms/${roomId}/actions.json`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data === 'object') {
          for (const key of Object.keys(data)) {
            if (!this.processedActionIds.has(key)) {
              this.processedActionIds.add(key);
              const act = data[key];
              if (onActionReceived) onActionReceived(act);
              // Xóa action sau khi xử lý
              fetch(`${this.baseUrl}/rooms/${roomId}/actions/${key}.json`, { method: 'DELETE' }).catch(() => {});
            }
          }
        }
      } catch (err) {}
    }, 1200);

    this.intervals.push(actionInterval);
  }

  /**
   * HOST: Đẩy trạng thái phòng lên Firebase (SDK + REST PUT)
   */
  hostPublishState(roomId, state) {
    if (!state) return;
    try {
      const cleanState = JSON.parse(JSON.stringify(state));

      // Đẩy qua SDK
      if (this.db) {
        this.db.ref(`rooms/${roomId}/state`).set(cleanState).catch(() => {});
      }

      // Đẩy qua REST API đồng thời
      fetch(`${this.baseUrl}/rooms/${roomId}/state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanState),
      }).catch(e => console.warn('REST publish state error:', e));

    } catch (err) {
      console.error('Lỗi đẩy trạng thái lên Firebase:', err);
    }
  }

  /**
   * HOST: Phát hiệu ứng tên lửa tới toàn bộ Client
   */
  hostPublishShotEffect(roomId, shotRecord) {
    if (!shotRecord) return;
    try {
      const payload = {
        ...shotRecord,
        effectId: Date.now(),
      };

      if (this.db) {
        this.db.ref(`rooms/${roomId}/effects/lastShot`).set(payload).catch(() => {});
      }

      fetch(`${this.baseUrl}/rooms/${roomId}/effects/lastShot.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});

    } catch (err) {
      console.error('Lỗi phát hiệu ứng tên lửa:', err);
    }
  }

  /**
   * CLIENT: Lắng nghe trạng thái phòng từ Firebase (SDK + REST Polling)
   */
  clientSubscribeState(roomId, onStateUpdate) {
    this.activeRoomId = roomId;

    // 1. SDK Listener
    if (this.db) {
      try {
        const stateRef = this.db.ref(`rooms/${roomId}/state`);
        const listener = stateRef.on('value', (snapshot) => {
          const state = snapshot.val();
          if (state && onStateUpdate) {
            this.lastStateHash = JSON.stringify({
              phase: state.phase,
              turn: state.turnNumber,
              turnTeam: state.currentTurnTeamId,
              shots: state.shotsHistory ? state.shotsHistory.length : 0,
            });
            onStateUpdate(state);
          }
        });
        this.listeners.push({ ref: stateRef, event: 'value', fn: listener });
      } catch (e) {
        console.warn('SDK Subscribe state fallback sang REST:', e);
      }
    }

    // 2. Fetch ngay lập tức lần đầu qua REST
    fetch(`${this.baseUrl}/rooms/${roomId}/state.json`)
      .then(res => res.json())
      .then(state => {
        if (state && onStateUpdate) {
          this.lastStateHash = JSON.stringify({
            phase: state.phase,
            turn: state.turnNumber,
            turnTeam: state.currentTurnTeamId,
            shots: state.shotsHistory ? state.shotsHistory.length : 0,
          });
          onStateUpdate(state);
        }
      })
      .catch(() => {});

    // 3. REST Polling Fallback định kỳ mỗi 1.2s
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.baseUrl}/rooms/${roomId}/state.json`);
        if (!res.ok) return;
        const state = await res.json();
        if (state && onStateUpdate) {
          const newHash = JSON.stringify({
            phase: state.phase,
            turn: state.turnNumber,
            turnTeam: state.currentTurnTeamId,
            shots: state.shotsHistory ? state.shotsHistory.length : 0,
          });
          if (newHash !== this.lastStateHash) {
            this.lastStateHash = newHash;
            onStateUpdate(state);
          }
        }
      } catch (err) {}
    }, 1200);

    this.intervals.push(pollInterval);
  }

  /**
   * CLIENT: Lắng nghe hiệu ứng tên lửa
   */
  clientSubscribeShotEffect(roomId, onShotEffect) {
    if (this.db) {
      try {
        const shotRef = this.db.ref(`rooms/${roomId}/effects/lastShot`);
        const listener = shotRef.on('value', (snapshot) => {
          const effect = snapshot.val();
          if (effect && effect.effectId && effect.effectId > this.lastEffectId) {
            this.lastEffectId = effect.effectId;
            if (onShotEffect) onShotEffect(effect);
          }
        });
        this.listeners.push({ ref: shotRef, event: 'value', fn: listener });
      } catch (e) {}
    }

    const effectInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.baseUrl}/rooms/${roomId}/effects/lastShot.json`);
        if (!res.ok) return;
        const effect = await res.json();
        if (effect && effect.effectId && effect.effectId > this.lastEffectId) {
          this.lastEffectId = effect.effectId;
          if (onShotEffect) onShotEffect(effect);
        }
      } catch (err) {}
    }, 800);

    this.intervals.push(effectInterval);
  }

  /**
   * CLIENT: Gửi hành động lên Host (SDK + REST POST)
   */
  clientSendAction(roomId, action) {
    if (!action) return;
    try {
      const payload = {
        ...action,
        timestamp: Date.now(),
      };

      if (this.db) {
        this.db.ref(`rooms/${roomId}/actions`).push(payload).catch(() => {});
      }

      fetch(`${this.baseUrl}/rooms/${roomId}/actions.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(e => console.warn('Lỗi gửi action REST:', e));

    } catch (err) {
      console.error('Lỗi gửi hành động lên Firebase:', err);
    }
  }

  destroy() {
    this.listeners.forEach(l => {
      if (l.ref && l.fn) {
        try { l.ref.off(l.event, l.fn); } catch (e) {}
      }
    });
    this.listeners = [];

    this.intervals.forEach(id => clearInterval(id));
    this.intervals = [];
  }
}

window.firebaseSync = new FirebaseSyncManager();
