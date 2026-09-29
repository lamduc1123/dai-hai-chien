// public/js/firebase-config.js
// Cấu hình Firebase Realtime Database cho Đại Hải Chiến
// Bạn có thể dán thông tin cấu hình từ Firebase Console của bạn vào đây, 
// hoặc nhập trực tiếp từ giao diện cài đặt trên màn hình MC!

window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "",
  authDomain: "",
  databaseURL: "", // Ví dụ: "https://dai-hai-chien-default-rtdb.asia-southeast1.firebasedatabase.app"
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Đọc cấu hình đã lưu trong localStorage nếu có
try {
  const savedConfig = localStorage.getItem('dai_hai_chien_firebase_config');
  if (savedConfig) {
    const parsed = JSON.parse(savedConfig);
    if (parsed && parsed.databaseURL) {
      window.FIREBASE_CONFIG = parsed;
    }
  }
} catch (e) {
  console.warn('Chưa thể nạp cấu hình Firebase từ bộ nhớ cục bộ:', e);
}

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
 * Lưu cấu hình Firebase mới vào bộ nhớ
 */
function saveFirebaseConfig(config) {
  if (!config || !config.databaseURL) return false;
  window.FIREBASE_CONFIG = config;
  localStorage.setItem('dai_hai_chien_firebase_config', JSON.stringify(config));
  return true;
}
