// public/js/firebase-sync.js
// Lớp đồng bộ thời gian thực chuẩn Google Firebase Realtime Database
// Hoạt động độc lập 100% trên Cloud, không cần mở cổng, không bị chặn bởi Wi-Fi công ty

class FirebaseSyncManager {
  constructor() {
    this.app = null;
    this.db = null;
    this.isReady = false;
    this.activeRoomId = null;
    this.listeners = [];
  }

  init() {
    if (!window.firebase) {
      console.warn('Thư viện Firebase SDK chưa được nạp.');
      return false;
    }

    if (!isFirebaseConfigured()) {
      console.info('Chưa có cấu hình Firebase. Game sẽ tiếp tục chạy ở chế độ Mạng Nội Bộ (Socket.IO).');
      return false;
    }

    try {
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(window.FIREBASE_CONFIG);
      } else {
        this.app = firebase.app();
      }
      this.db = firebase.database();
      this.isReady = true;
      console.log('⚡ Firebase Realtime Database đã kết nối thành công!');
      return true;
    } catch (err) {
      console.error('Lỗi khởi tạo Firebase:', err);
      return false;
    }
  }

  /**
   * HOST: Đăng ký phòng và lắng nghe hành động từ các người chơi
   */
  hostListenActions(roomId, onActionReceived) {
    if (!this.isReady) return;
    this.activeRoomId = roomId;

    const actionsRef = this.db.ref(`rooms/${roomId}/actions`);
    // Lắng nghe khi có người chơi gửi hành động lên (Join, Ready, Fire, LockFleet)
    const listener = actionsRef.on('child_added', (snapshot) => {
      const action = snapshot.val();
      const actionKey = snapshot.key;
      if (action && onActionReceived) {
        onActionReceived(action);
        // Xóa hành động sau khi đã xử lý để tránh tích tụ dữ liệu
        snapshot.ref.remove().catch(() => {});
      }
    });

    this.listeners.push({ ref: actionsRef, event: 'child_added', fn: listener });
  }

  /**
   * HOST: Cập nhật toàn bộ trạng thái phòng lên Firebase
   */
  hostPublishState(roomId, state) {
    if (!this.isReady || !state) return;
    try {
      // Chuẩn hóa state để không chứa undefined (Firebase cấm undefined)
      const cleanState = JSON.parse(JSON.stringify(state));
      this.db.ref(`rooms/${roomId}/state`).set(cleanState);
    } catch (err) {
      console.error('Lỗi đẩy trạng thái lên Firebase:', err);
    }
  }

  /**
   * HOST: Bắn hiệu ứng tên lửa tới toàn bộ các màn hình
   */
  hostPublishShotEffect(roomId, shotRecord) {
    if (!this.isReady || !shotRecord) return;
    try {
      this.db.ref(`rooms/${roomId}/effects/lastShot`).set({
        ...shotRecord,
        effectId: Date.now(),
      });
    } catch (err) {
      console.error('Lỗi phát hiệu ứng tên lửa lên Firebase:', err);
    }
  }

  /**
   * CLIENT (Mobile): Lắng nghe trạng thái phòng từ Firebase
   */
  clientSubscribeState(roomId, onStateUpdate) {
    if (!this.isReady) return;
    this.activeRoomId = roomId;

    const stateRef = this.db.ref(`rooms/${roomId}/state`);
    const listener = stateRef.on('value', (snapshot) => {
      const state = snapshot.val();
      if (state && onStateUpdate) {
        onStateUpdate(state);
      }
    });

    this.listeners.push({ ref: stateRef, event: 'value', fn: listener });
  }

  /**
   * CLIENT (Mobile): Lắng nghe hiệu ứng bắn tên lửa
   */
  clientSubscribeShotEffect(roomId, onShotEffect) {
    if (!this.isReady) return;

    const shotRef = this.db.ref(`rooms/${roomId}/effects/lastShot`);
    let lastSeenId = 0;

    const listener = shotRef.on('value', (snapshot) => {
      const effect = snapshot.val();
      if (effect && effect.effectId && effect.effectId > lastSeenId) {
        lastSeenId = effect.effectId;
        if (onShotEffect) onShotEffect(effect);
      }
    });

    this.listeners.push({ ref: shotRef, event: 'value', fn: listener });
  }

  /**
   * CLIENT (Mobile): Gửi hành động lên cho Host xử lý
   */
  clientSendAction(roomId, action) {
    if (!this.isReady || !action) return;
    try {
      this.db.ref(`rooms/${roomId}/actions`).push({
        ...action,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Lỗi gửi hành động lên Firebase:', err);
    }
  }

  /**
   * Dọn dẹp tất cả listeners khi thoát
   */
  destroy() {
    this.listeners.forEach(l => {
      if (l.ref && l.fn) {
        l.ref.off(l.event, l.fn);
      }
    });
    this.listeners = [];
  }
}

window.firebaseSync = new FirebaseSyncManager();
