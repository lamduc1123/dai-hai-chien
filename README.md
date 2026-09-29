# ⚓ ĐẠI HẢI CHIẾN: TRANH ĐOẠT 6 CHIẾN KHU (MULTIPLAYER 6 ĐỘI)

Hệ thống web game đối kháng chiến thuật thời gian thực dành cho sự kiện / team-building. Sáu đội chơi sử dụng **6 điện thoại riêng biệt** quét mã QR để tham gia, chọn vùng và tự bấm khai hỏa trên màn hình di động, đồng bộ trực tiếp lên **Màn hình lớn (TV / Máy chiếu)** dưới sự điều phối của **MC Host**.

---

## 🏗️ 1. KIẾN TRÚC HỆ THỐNG VÀ 3 GIAO DIỆN CHÍNH

- **Màn hình MC (`/host`)**: Trung tâm chỉ huy dành cho MC/Host. Tạo phòng, hiển thị QR code chung & 6 QR riêng, theo dõi kết nối, quản lý điểm, hoàn tác phát bắn, chuyển lượt thủ công, chế độ **"Ẩn thông tin bí mật"** (Privacy Mode).
- **Màn hình Lớn (`/screen`)**: Giao diện trình chiếu Full HD 16:9 dành cho máy chiếu/TV. Hiển thị Đại bản đồ 24×16, 6 chiến khu 8×8, bảng điểm, sinh lực hạm đội, hiệu ứng khai hỏa điện ảnh khi có phát bắn, vinh danh đội vô địch.
- **Điện thoại Đội (`/join`)**: Giao diện tối ưu màn hình dọc cho di động. Mỗi đội 1 điện thoại đại diện, tự bấm sẵn sàng, tự khám phá bản đồ (zoom/pan), nhận cảnh báo rung khi đến lượt, chạm chọn ô và nhấn **KHAI HỎA**.

---

## 🛡️ 2. BẢO MẬT DỮ LIỆU & ZERO-LEAK ARCHITECTURE

- **Xử lý toàn bộ tại Server**: Máy chủ Node.js là nguồn quyết định duy nhất về vị trí tàu bí mật, tính hợp lệ của phát bắn, lượt chơi và điểm số.
- **Lọc dữ liệu theo Socket (Role-Based State Projection)**:
  - Màn hình lớn (`/screen`): Tuyệt đối không nhận tọa độ tàu ẩn của bất kỳ đội nào.
  - Điện thoại Đội X (`/join`): Chỉ nhận được vị trí tàu của chính Đội X. Tàu của 5 đội đối thủ hoàn toàn bị xóa khỏi payload WebSocket.
- **Chống gian lận / Hack**: Chặn bắn khi chưa tới lượt, chặn tự bắn vào chiến khu của mình, chặn bắn trùng ô, khóa nút chống double-tap.
- **Reconnection Grace Period (3 phút)**: Khi điện thoại mất sóng hoặc tải lại trang, hệ thống giữ vị trí trong 3 phút và tự động đưa người chơi trở lại đúng đội cũ nhờ `deviceToken`.

---

## 🚀 3. HƯỚNG DẪN KHỞI CHẠY TẠI SỰ KIỆN (MẠNG LAN WI-FI)

### Bước 1: Chuẩn bị máy tính của MC
1. Kết nối máy tính MC vào mạng Wi-Fi tại địa điểm tổ chức.
2. Mở Terminal / PowerShell, di chuyển vào thư mục:
   ```bash
   cd "c:\Users\admin\OneDrive\Marekting\dai-hai-chien"
   ```
3. Cài đặt thư viện (nếu mới tải lần đầu):
   ```bash
   npm install
   ```
4. Khởi động máy chủ:
   ```bash
   npm start
   ```
5. Màn hình console sẽ tự động phát hiện IP LAN nội bộ và hiển thị:
   ```
   ====================================================
   🚀 MÁY CHỦ ĐẠI HẢI CHIẾN MULTIPLAYER ĐANG CHẠY!
   📡 Mạng LAN / Local: http://192.168.1.15:3000
   🖥️  Màn hình MC:     http://192.168.1.15:3000/host
   📺 Màn hình Lớn:    http://192.168.1.15:3000/screen
   📱 Điện thoại Đội:  http://192.168.1.15:3000/join
   ====================================================
   ```

### Bước 2: Thiết lập trình chiếu và điều khiển
- Trên máy tính MC, mở trình duyệt Chrome:
  - Cửa sổ 1 (Kéo sang Màn hình phụ / Máy chiếu): Truy cập `http://localhost:3000/screen` và bấm nút **"Toàn Màn Hình" (F11)**.
  - Cửa sổ 2 (Màn hình laptop của MC): Truy cập `http://localhost:3000/host` để điều khiển.

### Bước 3: Cho 6 đội quét mã tham gia
1. Tất cả 6 điện thoại của 6 đội cùng kết nối vào **mạng Wi-Fi chung** với máy tính MC.
2. Các đội mở Camera quét mã QR hiển thị ở giữa màn hình lớn hoặc MC bấm nút **"Mã QR Tham Gia"** để chiếu 6 mã QR riêng cho từng đội.
3. Người chơi nhập tên đại diện -> Bấm **"Tham gia đội"** -> Bấm **"✓ BẤM SẴN SÀNG"**.

### Bước 4: MC Bắt đầu trận đấu
- Khi thanh tiến độ trên MC đạt **6/6 Đội Sẵn Sàng**, nút **"🚀 BẮT ĐẦU TRẬN ĐẤU"** sẽ sáng lên.
- MC bấm nút bắt đầu -> Hệ thống khóa phòng, server tự động random thứ tự bắn độc lập và chuyển sang giao diện chiến đấu.

---

## 🌐 4. HƯỚNG DẪN TRIỂN KHAI LÊN INTERNET (RENDER / RAILWAY / FLY.IO)

Game được thiết kế độc lập, tự động nhận diện domain hiện tại thông qua HTTP headers (`req.get('host')`). Do đó, QR code sẽ tự động trỏ đến đúng domain internet mà không cần cấu hình lại code!

### Triển khai trên Render.com (Khuyến nghị - Miễn phí)
1. Đẩy mã nguồn lên GitHub.
2. Đăng nhập [Render.com](https://render.com), chọn **New Web Service**.
3. Kết nối với repository GitHub của bạn.
4. Cấu hình:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Bấm **Deploy**. Sau 1-2 phút, bạn sẽ nhận được đường link dạng:
   `https://dai-hai-chien.onrender.com`
6. MC truy cập `https://dai-hai-chien.onrender.com/host`, mã QR tạo ra sẽ tự động mang domain này để các đội quét từ bất kỳ mạng 4G/5G nào!

---

## 📋 5. KỊCH BẢN ĐIỀU PHỐI GAMESHOW DÀNH CHO MC

- **Nút "Ẩn Thông Tin Bí Mật" (Privacy Toggle)**: Luôn bật chế độ này nếu màn hình laptop của MC có nguy cơ bị người chơi xung quanh nhìn thấy. Tọa độ hạm đội sẽ tự động làm mờ thành `•••••`.
- **Nếu người chơi bấm nhầm**: Bấm nút **"⏪ Hoàn Tác Lượt Bắn (Undo)"** trên thanh điều khiển. Phát bắn vừa rồi sẽ bị hủy, điểm số khôi phục và lượt bắn quay lại cho đội đó.
- **Nếu một điện thoại rớt mạng**: Hệ thống sẽ hiển thị trạng thái `Offline`. MC có thể dùng nút **"Chuyển lượt thủ công"** để nhường lượt cho đội khác trong khi chờ đội kia vào lại.
- **Nút "Test Simulator"**: Tự động sinh 6 kết nối Socket ảo đại diện cho 6 đội để MC chạy thử nghiệm tổng duyệt toàn bộ hiệu ứng trước giờ diễn ra chương trình.

---

## 🧪 6. CHẠY KIỂM THỬ TỰ ĐỘNG

Dự án tích hợp sẵn bộ kiểm thử tự động mô phỏng 6 điện thoại kết nối đồng thời:
```bash
npm run test:sim
```
Kiểm tra tự động 22/22 kịch bản:
- Kết nối đồng thời 6 đội.
- Chặn chọn trùng đội.
- Bảo mật vị trí tàu Zero-Leak.
- Khóa điều kiện bắt đầu 6/6.
- Chặn bắn sai lượt / tự bắn vào mình.
- Bắn trúng / trượt / hạ tàu / tính điểm.
- Chống double-click.
- Khôi phục kết nối Reconnection.
