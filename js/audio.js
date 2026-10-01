// public/js/audio.js
// Bộ tổng hợp âm thanh Web Audio API chuẩn Gameshow Hải Quân chuyên nghiệp
// Tự tạo 100% âm thanh chuẩn phòng thu bằng dao động sóng & bộ lọc âm học, không phụ thuộc file mp3

class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bgmEnabled = false;
    this.bgmVolume = 0.35;
    this.sfxVolume = 0.8;
    this.bgmNode = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.noiseBuffer = null;
    this.bgmTimer = null;
    this.bgmStep = 0;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
        this.sfxGain.connect(this.masterGain);

        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
        this.bgmGain.connect(this.masterGain);

        this.buildNoiseBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  buildNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2.5; // 2.5s noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  setEnabled(val) {
    this.enabled = !!val;
    if (!this.enabled) {
      this.stopBgm();
    }
  }

  isEnabled() {
    return this.enabled;
  }

  setSfxVolume(val) {
    this.sfxVolume = Math.max(0, Math.min(1, val));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  setBgmVolume(val) {
    this.bgmVolume = Math.max(0, Math.min(1, val));
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
    }
  }

  // 1. TIẾNG TÊN LỬA RƠI XUỐNG BIỂN / BẮN TRƯỢT (Missile Whistle & Ocean Water Splash)
  playMiss() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Giai đoạn 1: Tiếng tên lửa lao xuống rít gió
    const whistle = this.ctx.createOscillator();
    const whistleGain = this.ctx.createGain();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(680, now);
    whistle.frequency.exponentialRampToValueAtTime(140, now + 0.32);

    whistleGain.gain.setValueAtTime(0.28, now);
    whistleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);

    whistle.connect(whistleGain);
    whistleGain.connect(this.sfxGain);
    whistle.start(now);
    whistle.stop(now + 0.34);

    // Giai đoạn 2: Tiếng cắm nước "Ùm - Tóe nước biển" (Sub-bass impact + splash noise)
    const splashTime = now + 0.28;

    // Bọt nước sủi bọt (Noise bandpass)
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320, splashTime);
      filter.frequency.exponentialRampToValueAtTime(160, splashTime + 0.7);
      filter.Q.value = 2.2;

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.45, splashTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, splashTime + 0.75);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.sfxGain);

      noise.start(splashTime);
      noise.stop(splashTime + 0.8);
    }

    // Tiếng cắm nước trầm (Deep water plop)
    const plop = this.ctx.createOscillator();
    const plopGain = this.ctx.createGain();
    plop.type = 'triangle';
    plop.frequency.setValueAtTime(150, splashTime);
    plop.frequency.exponentialRampToValueAtTime(50, splashTime + 0.45);

    plopGain.gain.setValueAtTime(0.4, splashTime);
    plopGain.gain.exponentialRampToValueAtTime(0.001, splashTime + 0.5);

    plop.connect(plopGain);
    plopGain.connect(this.sfxGain);
    plop.start(splashTime);
    plop.stop(splashTime + 0.52);
  }

  // 2. TIẾNG NỔ + LỬA CHÁY KHI BẮN TRÚNG 1 Ô (Hit Explosion + Armor Crack + Flame Crackle)
  playHit() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // A. Tiếng kim loại giáp vỡ (Metallic armor pierce)
    const crack = this.ctx.createOscillator();
    const crackGain = this.ctx.createGain();
    crack.type = 'sawtooth';
    crack.frequency.setValueAtTime(950, now);
    crack.frequency.exponentialRampToValueAtTime(180, now + 0.08);

    crackGain.gain.setValueAtTime(0.5, now);
    crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    crack.connect(crackGain);
    crackGain.connect(this.sfxGain);
    crack.start(now);
    crack.stop(now + 0.1);

    // B. Vụ nổ đanh thép (Explosion boom)
    if (this.noiseBuffer) {
      const boomNoise = this.ctx.createBufferSource();
      boomNoise.buffer = this.noiseBuffer;

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(900, now);
      lowpass.frequency.exponentialRampToValueAtTime(90, now + 0.9);

      const boomGain = this.ctx.createGain();
      boomGain.gain.setValueAtTime(0.65, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

      boomNoise.connect(lowpass);
      lowpass.connect(boomGain);
      boomGain.connect(this.sfxGain);

      boomNoise.start(now);
      boomNoise.stop(now + 1.0);
    }

    // Sub-bass thud
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.6);

    subGain.gain.setValueAtTime(0.55, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.7);

    // C. Tiếng lửa bốc cháy ngùn ngụt & tàn lửa nổ lách tách (Fire sizzle & crackle)
    for (let i = 0; i < 6; i++) {
      const crackleTime = now + 0.15 + Math.random() * 0.7;
      const p = this.ctx.createOscillator();
      const pg = this.ctx.createGain();
      p.type = 'square';
      p.frequency.setValueAtTime(1200 + Math.random() * 1800, crackleTime);

      pg.gain.setValueAtTime(0.12, crackleTime);
      pg.gain.exponentialRampToValueAtTime(0.001, crackleTime + 0.04);

      p.connect(pg);
      pg.connect(this.sfxGain);
      p.start(crackleTime);
      p.stop(crackleTime + 0.05);
    }
  }

  // 3. TIẾNG NỔ CỰC ĐẠI KHI TÀU BỊ PHÁ HỦY HOÀN TOÀN (Catastrophic Sunk Explosion)
  playSunk() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Vụ nổ 1: Đạn hầm phát nổ dữ dội
    this.playHit();

    // Vụ nổ 2: Vỡ đôi thân tàu sau 160ms (Catastrophic secondary blast)
    const t2 = now + 0.16;

    if (this.noiseBuffer) {
      const bigBoom = this.ctx.createBufferSource();
      bigBoom.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, t2);
      filter.frequency.exponentialRampToValueAtTime(60, t2 + 2.0);

      const bigGain = this.ctx.createGain();
      bigGain.gain.setValueAtTime(0.95, t2);
      bigGain.gain.exponentialRampToValueAtTime(0.001, t2 + 2.4);

      bigBoom.connect(filter);
      filter.connect(bigGain);
      bigGain.connect(this.sfxGain);

      bigBoom.start(t2);
      bigBoom.stop(t2 + 2.5);
    }

    // Tiếng rung chấn cực trầm (Massive Sub-bass Shockwave 38Hz)
    const seismic = this.ctx.createOscillator();
    const seismicGain = this.ctx.createGain();
    seismic.type = 'sine';
    seismic.frequency.setValueAtTime(95, t2);
    seismic.frequency.exponentialRampToValueAtTime(28, t2 + 1.8);

    seismicGain.gain.setValueAtTime(0.85, t2);
    seismicGain.gain.exponentialRampToValueAtTime(0.001, t2 + 2.0);

    seismic.connect(seismicGain);
    seismicGain.connect(this.sfxGain);
    seismic.start(t2);
    seismic.stop(t2 + 2.1);

    // Tiếng kim loại gãy đôi vặn xoắn (Creaking tearing steel)
    const steel = this.ctx.createOscillator();
    const steelGain = this.ctx.createGain();
    steel.type = 'sawtooth';
    steel.frequency.setValueAtTime(220, t2 + 0.1);
    steel.frequency.linearRampToValueAtTime(70, t2 + 1.2);

    steelGain.gain.setValueAtTime(0.28, t2 + 0.1);
    steelGain.gain.exponentialRampToValueAtTime(0.001, t2 + 1.3);

    steel.connect(steelGain);
    steelGain.connect(this.sfxGain);
    steel.start(t2 + 0.1);
    steel.stop(t2 + 1.35);

    // Báo động chìm tàu sau đó
    setTimeout(() => {
      this.playAlarm();
    }, 450);
  }

  // Tiếng Sonar Ping tàu ngầm
  playSonar() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.4);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 1.2);
  }

  // Tiếng tên lửa phóng đi
  playMissile() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.45);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.6);
  }

  // Tiếng Chuông báo động
  playAlarm() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = now + i * 0.24;

      osc.type = 'square';
      osc.frequency.setValueAtTime(920, startTime);
      osc.frequency.setValueAtTime(720, startTime + 0.11);

      gain.gain.setValueAtTime(0.25, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.22);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(startTime);
      osc.stop(startTime + 0.23);
    }
  }

  // 4. NHẠC NỀN HẢO HÙNG ĐẠI HẢI CHIẾN (Procedural Epic Naval War Orchestral BGM)
  toggleBgm() {
    if (this.bgmEnabled) {
      this.stopBgm();
      return false;
    } else {
      this.startBgm();
      return true;
    }
  }

  startBgm() {
    this.init();
    if (!this.ctx) return;
    this.bgmEnabled = true;
    if (this.bgmTimer) clearInterval(this.bgmTimer);

    // Tiến trình hợp âm hào hùng hải quân (D minor -> F -> C -> Bb -> Gm -> A)
    const chordProgression = [
      { root: 146.83, name: 'Dm', chords: [220.00, 261.63, 349.23, 440.00] }, // D3, A3, C4, F4, A4
      { root: 174.61, name: 'F',  chords: [261.63, 349.23, 440.00, 523.25] }, // F3, C4, F4, A4, C5
      { root: 130.81, name: 'C',  chords: [196.00, 261.63, 329.63, 392.00] }, // C3, G3, C4, E4, G4
      { root: 116.54, name: 'Bb', chords: [174.61, 233.08, 293.66, 349.23] }, // Bb2, F3, Bb3, D4, F4
      { root: 98.00,  name: 'G',  chords: [146.83, 196.00, 293.66, 392.00] }, // G2, D3, G3, D4, G4
      { root: 110.00, name: 'A',  chords: [164.81, 220.00, 277.18, 440.00] }  // A2, E3, A3, C#4, A4
    ];

    const bpm = 112;
    const stepDuration = 60 / bpm / 2; // 8th note duration (~0.267s)
    let currentStep = 0;

    const playStep = () => {
      if (!this.bgmEnabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const barIndex = Math.floor(currentStep / 8) % chordProgression.length;
      const beatInBar = currentStep % 8;
      const currentChord = chordProgression[barIndex];

      // 1. Trống trận Timpani (Timpani War Drum - downbeats)
      if (beatInBar === 0 || beatInBar === 3 || beatInBar === 6) {
        const drum = this.ctx.createOscillator();
        const drumGain = this.ctx.createGain();
        drum.type = 'triangle';
        const baseFreq = beatInBar === 0 ? 82 : 72;
        drum.frequency.setValueAtTime(baseFreq, now);
        drum.frequency.exponentialRampToValueAtTime(36, now + 0.35);

        const vol = beatInBar === 0 ? 0.6 : 0.45;
        drumGain.gain.setValueAtTime(vol, now);
        drumGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

        drum.connect(drumGain);
        drumGain.connect(this.bgmGain);
        drum.start(now);
        drum.stop(now + 0.4);
      }

      // 2. Nhịp hành quân dồn dập (Marching snare rattle)
      if (this.noiseBuffer && (beatInBar === 2 || beatInBar === 4 || beatInBar === 7)) {
        const snare = this.ctx.createBufferSource();
        snare.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1600;

        const snareGain = this.ctx.createGain();
        snareGain.gain.setValueAtTime(0.18, now);
        snareGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        snare.connect(filter);
        filter.connect(snareGain);
        snareGain.connect(this.bgmGain);

        snare.start(now);
        snare.stop(now + 0.14);
      }

      // 3. Bassline xung lực tàu chiến (Pulsing Naval Bass)
      const bass = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bass.type = 'sawtooth';
      bass.frequency.setValueAtTime(currentChord.root, now);

      const bassFilter = this.ctx.createBiquadFilter();
      bassFilter.type = 'lowpass';
      bassFilter.frequency.setValueAtTime(280, now);

      bassGain.gain.setValueAtTime(0.22, now);
      bassGain.gain.exponentialRampToValueAtTime(0.01, now + stepDuration * 0.9);

      bass.connect(bassFilter);
      bassFilter.connect(bassGain);
      bassGain.connect(this.bgmGain);

      bass.start(now);
      bass.stop(now + stepDuration);

      // 4. Kèn đồng Brass Hải Quân Hào Hùng (Epic Naval Brass Chords - on beat 0 and 4)
      if (beatInBar === 0 || beatInBar === 4) {
        currentChord.chords.forEach((freq, idx) => {
          const brass = this.ctx.createOscillator();
          const brassGain = this.ctx.createGain();
          const brassFilter = this.ctx.createBiquadFilter();

          brass.type = 'sawtooth';
          brass.frequency.setValueAtTime(freq, now);

          brassFilter.type = 'lowpass';
          brassFilter.frequency.setValueAtTime(1400, now);
          brassFilter.frequency.exponentialRampToValueAtTime(500, now + stepDuration * 3.5);

          const bVol = (0.09 / (idx + 1)) + 0.03;
          brassGain.gain.setValueAtTime(bVol, now);
          brassGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 3.8);

          brass.connect(brassFilter);
          brassFilter.connect(brassGain);
          brassGain.connect(this.bgmGain);

          brass.start(now);
          brass.stop(now + stepDuration * 4);
        });
      }

      currentStep++;
    };

    // Khởi chạy ngay nốt đầu
    playStep();
    this.bgmTimer = setInterval(playStep, stepDuration * 1000);
  }

  stopBgm() {
    this.bgmEnabled = false;
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  // Tương thích ngược
  playExplosion() { this.playHit(); }
  playSplash() { this.playMiss(); }
  playTurnChime() { this.playSonar(); }
  playVictory() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const st = now + idx * 0.14;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, st);

      gain.gain.setValueAtTime(0.35, st);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.8);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(st);
      osc.stop(st + 0.85);
    });
  }
}

window.soundManager = new SoundManager();
