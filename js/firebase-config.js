// public/js/firebase-config.js
// Cấu hình Firebase Realtime Database chính thức cho Đại Hải Chiến

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBbvH3Onnh1fvj01Y-KTGxBRZXIucjkq3c",
  authDomain: "dai-hai-chien.firebaseapp.com",
  databaseURL: "https://dai-hai-chien-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "dai-hai-chien",
  storageBucket: "dai-hai-chien.firebasestorage.app",
  messagingSenderId: "84769081740",
  appId: "1:84769081740:web:2e0c73ca81705b5e372ea9"
};

// Tự động khôi phục cấu hình lưu trong LocalStorage nếu có
try {
  const savedCfg = localStorage.getItem('dai_hai_chien_firebase_config');
  if (savedCfg) {
    const parsed = JSON.parse(savedCfg);
    if (parsed && parsed.databaseURL) {
      window.FIREBASE_CONFIG = { ...window.FIREBASE_CONFIG, ...parsed };
    }
  }
} catch (e) {
  console.warn('Không thể đọc cấu hình Firebase từ localStorage:', e);
}

// Hỗ trợ truyền databaseURL qua tham số URL (vd: ?db=https://...)
try {
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const params = new URLSearchParams(window.location.search);
    const dbParam = params.get('db') || params.get('firebase_url');
    if (dbParam && dbParam.startsWith('http')) {
      window.FIREBASE_CONFIG.databaseURL = dbParam;
    }
  }
} catch (e) {}

/**
 * Kiểm tra xem Firebase đã được thiết lập đầy đủ hay chưa
 */
function isFirebaseConfigured() {
  return !!(
    window.FIREBASE_CONFIG &&
    window.FIREBASE_CONFIG.databaseURL &&
    window.FIREBASE_CONFIG.databaseURL.trim().length > 0
  );
}

/**
 * Lưu cấu hình Firebase mới vào bộ nhớ nếu cần ghi đè
 */
function saveFirebaseConfig(config) {
  if (!config || !config.databaseURL) return false;
  window.FIREBASE_CONFIG = { ...window.FIREBASE_CONFIG, ...config };
  localStorage.setItem('dai_hai_chien_firebase_config', JSON.stringify(window.FIREBASE_CONFIG));
  return true;
}
