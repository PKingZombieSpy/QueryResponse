// js/sender.js — Send mode: file input, LT encoding, animated QR display

'use strict';

class Sender {
  constructor() {
    this.file = null;
    this.fileData = null;
    this.encoder = null;
    this.sessionId = 0;
    this.animationId = null;
    this.running = false;
    this.frameCount = 0;
    this.startTime = 0;
    this._qrCodegenReady = false;

    // Defaults
    this.fps = 5;
    this.blockSize = 900;

    // Wait for qrcodegen module to load
    if (window.qrcodegen) {
      this._qrCodegenReady = true;
    } else {
      window.addEventListener('qrcodegen-ready', () => { this._qrCodegenReady = true; }, { once: true });
    }

    // DOM elements
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('file-input');
    this.fileInfo = document.getElementById('file-info');
    this.fileName = document.getElementById('file-name');
    this.fileDetails = document.getElementById('file-details');
    this.settings = document.getElementById('send-settings');
    this.btnStart = document.getElementById('btn-start');
    this.btnStop = document.getElementById('btn-stop');
    this.qrArea = document.getElementById('qr-area');
    this.qrCanvas = document.getElementById('qr-canvas');
    this.statusText = document.getElementById('send-status');
    this.fpsInput = document.getElementById('setting-fps');
    this.fpsDisplay = document.getElementById('fps-display');
    this.qrSizeInput = document.getElementById('setting-qr-size');
    this.qrSizeDisplay = document.getElementById('qr-size-display');
    this.qrSizeControl = document.getElementById('qr-size-control');

    this._bindEvents();
  }

  _bindEvents() {
    // File input via click
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this._loadFile(e.target.files[0]);
    });

    // FPS slider — update display in real time
    this.fpsInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.fpsDisplay.textContent = val < 1 ? val.toFixed(1) : Math.round(val);
    });

    // QR Size slider — update display
    this.qrSizeInput.addEventListener('input', (e) => {
      const sizes = ['Small', 'Medium', 'Large'];
      this.qrSizeDisplay.textContent = sizes[parseInt(e.target.value) - 1];
    });

    // Drag & drop
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('dragover');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('dragover');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) this._loadFile(e.dataTransfer.files[0]);
    });

    // Start / stop
    this.btnStart.addEventListener('click', () => this.start());
    this.btnStop.addEventListener('click', () => this.stop());
  }

  async _loadFile(file) {
    this.file = file;
    const buffer = await file.arrayBuffer();
    this.fileData = new Uint8Array(buffer);

    // Update UI
    this.fileName.textContent = file.name;
    this.fileDetails.textContent = `${formatSize(file.size)}`;
    this.fileInfo.classList.add('visible');
    this.settings.classList.add('visible');
    this.btnStart.disabled = false;

    // Reset any previous session and generate new session ID for this file
    this.stop();
    this.sessionId = 0;
  }

  async start() {
    if (!this.fileData) return;

    // Wait for qrcodegen to be available
    if (!window.qrcodegen) {
      this.statusText.textContent = 'Loading QR library…';
      this.qrArea.classList.add('visible');
      if (!this._qrCodegenReady) {
        await new Promise((resolve) => {
          const check = () => { if (this._qrCodegenReady || window.qrcodegen) resolve(); else setTimeout(check, 100); };
          check();
          setTimeout(resolve, 5000);
        });
      }
      if (!window.qrcodegen) {
        this.statusText.textContent = 'Error: QR code library failed to load.';
        return;
      }
    }

    // Map QR size to block size (binary byte mode — no base64 overhead)
    const qrSizeMap = { 1: 470, 2: 900, 3: 2000 };
    this.blockSize = qrSizeMap[parseInt(this.qrSizeInput.value)] || 900;

    // Validate: base45-encoded frame must fit in QR alphanumeric mode
    // QR v40 level L holds 4296 alphanumeric characters
    const frameLen = 8 + this.blockSize;
    const base45Len = Math.ceil(frameLen / 2) * 3;
    if (base45Len > 4296) {
      this.statusText.textContent = `QR size too large. Please select a smaller size.`;
      this.qrArea.classList.add('visible');
      return;
    }

    // Build foremattered data: [fileSize(4)][nameLen(2)][name][content]
    const foremattedData = QRFrame.buildForemattedData(this.file.name, this.fileData);

    // Create encoder
    this.encoder = new Fountain.LTEncoder(foremattedData, this.blockSize);

    // Generate session ID only on first start (for this file)
    if (!this.sessionId) {
      this.sessionId = (Math.random() * 0xFFFF) >>> 0;
    }
    this.frameCount = 0;
    this.startTime = performance.now();
    this.running = true;

    // Update UI
    this.dropZone.style.display = 'none';
    this.btnStart.style.display = 'none';
    this.qrArea.classList.add('visible');

    // Hide QR size during sending (block size is locked), keep FPS visible
    this.qrSizeControl.style.display = 'none';

    const K = this.encoder.K;
    const currentFps = parseFloat(this.fpsInput.value) || 5;
    this.fileDetails.textContent = `${formatSize(this.file.size)} · ${K} blocks`;

    this._scheduleFrame();
  }

  stop() {
    this.running = false;
    if (this.animationId) {
      clearTimeout(this.animationId);
      this.animationId = null;
    }

    // Restore UI
    this.dropZone.style.display = '';
    this.settings.classList.add('visible');
    this.btnStart.style.display = '';
    this.btnStart.disabled = !this.fileData;
    this.qrArea.classList.remove('visible');
    this.statusText.textContent = '';

    // Restore QR size control
    this.qrSizeControl.style.display = '';
  }

  _scheduleFrame() {
    if (!this.running) return;
    // Read FPS from slider on each frame (allows live adjustment)
    const currentFps = parseFloat(this.fpsInput.value) || 5;
    const interval = 1000 / currentFps;
    this.animationId = setTimeout(() => {
      this._renderFrame();
      this._scheduleFrame();
    }, interval);
  }

  _renderFrame() {
    const enc = this.encoder;

    // Generate next encoded block
    const block = enc.encode();
    const frameBytes = QRFrame.encodeFrame(
      this.sessionId,
      enc.K,
      block.blockId,
      block.payload
    );

    this._renderQR(QRFrame.base45Encode(frameBytes));
    this.frameCount++;

    // Update status — show elapsed time and frame count
    const elapsed = ((performance.now() - this.startTime) / 1000).toFixed(1);
    this.statusText.textContent = `Frame ${this.frameCount} · ${elapsed}s elapsed`;
  }

  _renderQR(text) {
    // Encode base45 text into QR using Nayuki's qrcodegen (alphanumeric mode)
    try {
      const QRC = qrcodegen.QrCode;
      const qr = QRC.encodeText(text, QRC.Ecc.LOW);

      const moduleCount = qr.size;
      const quietZone = 4; // QR standard quiet zone (modules)
      const cellSize = Math.max(2, Math.floor(250 / (moduleCount + quietZone * 2)));
      const qrSize = moduleCount * cellSize;
      const padding = quietZone * cellSize;
      const size = qrSize + padding * 2;

      const canvas = this.qrCanvas;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Read QR colors from CSS custom properties (follows light/dark theme)
      const styles = getComputedStyle(document.documentElement);
      const moduleColor = styles.getPropertyValue('--qr-module').trim() || '#000000';
      const bgColor = styles.getPropertyValue('--qr-bg').trim() || '#ffffff';

      // Background (including quiet zone)
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = moduleColor;

      // Draw QR modules
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.getModule(col, row)) {
            ctx.fillRect(
              padding + col * cellSize,
              padding + row * cellSize,
              cellSize,
              cellSize
            );
          }
        }
      }
    } catch (e) {
      console.error('QR generation error:', e);
      this.statusText.textContent = 'Error: data too large for QR code. Try smaller block size.';
      this.stop();
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.Sender = Sender;
  globalThis.formatSize = formatSize;
}
