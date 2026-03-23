// js/receiver.js — Receive mode: camera scanning, LT decoding, file save

'use strict';

class Receiver {
  constructor() {
    this.decoder = null;
    this.sessionId = null;
    this.filename = null;
    this.scanner = null;
    this.scanning = false;
    this.blocksReceived = 0;
    this.startTime = 0;
    this.fileBlob = null;
    this._qrScannerReady = false;
    this._uiUpdatePending = false;

    // Listen for QrScanner load early to avoid race condition
    if (window.QrScanner) {
      this._qrScannerReady = true;
    } else {
      window.addEventListener('qrscanner-ready', () => { this._qrScannerReady = true; }, { once: true });
    }

    // DOM elements
    this.cameraArea = document.getElementById('camera-area');
    this.video = document.getElementById('camera-video');
    this.progressArea = document.getElementById('receive-progress-area');
    this.progressFill = document.getElementById('receive-progress-fill');
    this.statusText = document.getElementById('receive-status');
    this.detailText = document.getElementById('receive-detail');
    this.btnScan = document.getElementById('btn-scan');
    this.btnScanStop = document.getElementById('btn-scan-stop');
    this.completePanel = document.getElementById('receive-complete');
    this.receivedFileName = document.getElementById('received-file-name');
    this.receivedFileDetails = document.getElementById('received-file-details');
    this.btnSave = document.getElementById('btn-save');

    this._bindEvents();
  }

  _bindEvents() {
    this.btnScan.addEventListener('click', () => this.startScanning());
    this.btnScanStop.addEventListener('click', () => this.stopScanning());
    this.btnSave.addEventListener('click', () => this._saveFile());
  }

  async startScanning() {
    // Reset state
    this.decoder = null;
    this.sessionId = null;
    this.filename = null;
    this.blocksReceived = 0;
    this.fileBlob = null;
    this._uiUpdatePending = false;
    this.completePanel.classList.remove('visible');
    this.progressArea.classList.remove('visible');
    this.progressFill.style.width = '0%';
    this.detailText.textContent = '';

    // Wait for QrScanner to be available
    if (!window.QrScanner) {
      this.statusText.textContent = 'Loading scanner…';
      if (!this._qrScannerReady) {
        await new Promise((resolve) => {
          const check = () => { if (this._qrScannerReady || window.QrScanner) resolve(); else setTimeout(check, 100); };
          check();
          setTimeout(resolve, 5000); // hard timeout
        });
      }
    }

    if (!window.QrScanner) {
      this.statusText.textContent = 'Error: QR scanner library failed to load.';
      return;
    }

    try {
      this.scanner = new QrScanner(
        this.video,
        (result) => this._onScan(result),
        {
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: 'environment', // rear camera on mobile
        }
      );

      await this.scanner.start();
      this.scanning = true;
      this.startTime = performance.now();

      // Update UI
      this.btnScan.classList.add('hidden');
      this.btnScanStop.classList.remove('hidden');
      this.progressArea.classList.add('visible');
      this.statusText.textContent = 'Scanning… Point camera at the QR code display.';
    } catch (err) {
      console.error('Camera error:', err);
      this.statusText.textContent = 'Camera error: ' + (err.message || err);
    }
  }

  stopScanning() {
    this.scanning = false;
    if (this.scanner) {
      this.scanner.stop();
      this.scanner.destroy();
      this.scanner = null;
    }

    // Update UI
    this.btnScan.classList.remove('hidden');
    this.btnScanStop.classList.add('hidden');
    if (!this.fileBlob) {
      this.progressArea.classList.remove('visible');
      this.statusText.textContent = 'Scanning stopped.';
    }
  }

  _onScan(result) {
    if (!this.scanning) return;

    try {
      // Base45 decode the scanned string, then parse the binary frame
      const frameBytes = QRFrame.base45Decode(result.data);
      if (!frameBytes) return; // not a valid base45 string (unrelated QR code)
      const frame = QRFrame.decodeFrame(frameBytes);
      if (!frame) return;
      this._handleFrame(frame);
    } catch (e) {
      console.error('Scan processing error:', e);
    }
  }

  _handleFrame(frame) {
    // Lock to the first session we see
    if (this.sessionId === null) {
      this.sessionId = frame.sessionId;
    }
    if (frame.sessionId !== this.sessionId) return;

    // Initialize decoder on first frame (block size inferred from payload)
    if (!this.decoder) {
      const blockSize = frame.payload.length;
      this.decoder = new Fountain.LTDecoder(frame.K, blockSize);
      this._expectedK = frame.K;
      this._expectedBlockSize = blockSize;
      this.statusText.textContent = 'Receiving…';
    }

    // Reject frames with mismatched parameters
    if (frame.K !== this._expectedK || frame.payload.length !== this._expectedBlockSize) return;

    // Feed block to decoder
    const complete = this.decoder.addBlock(frame.blockId, frame.payload);
    if (this.decoder.seenBlockIds.size > this.blocksReceived) {
      this.blocksReceived = this.decoder.seenBlockIds.size;
    }

    // Throttle UI updates to one per animation frame
    if (!this._uiUpdatePending) {
      this._uiUpdatePending = true;
      requestAnimationFrame(() => {
        this._updateProgressUI();
        this._uiUpdatePending = false;
      });
    }

    if (complete) {
      this._onComplete();
    }
  }

  _updateProgressUI() {
    if (!this.decoder) return;

    const received = this.blocksReceived;
    const decoded = this.decoder.decodedCount;
    const K = this.decoder.K;

    // Progress bar based on actual decoded source blocks (exact, not estimated)
    const pct = Math.min(100, (decoded / K) * 100).toFixed(1);
    this.progressFill.style.width = pct + '%';

    const elapsed = ((performance.now() - this.startTime) / 1000).toFixed(1);
    this.detailText.textContent =
      `${decoded}/${K} decoded · ${received} received · ${elapsed}s`;
  }

  _onComplete() {
    const rawData = this.decoder.getData();
    if (!rawData) return;

    // Parse forematter to extract filename and file content
    const parsed = QRFrame.parseForemattedData(rawData);
    if (!parsed) {
      this.statusText.textContent = 'Error: failed to parse received data.';
      return;
    }

    const elapsed = ((performance.now() - this.startTime) / 1000).toFixed(1);
    const { filename, content } = parsed;

    // Determine MIME type from filename extension
    const mime = guessMime(filename);
    this.fileBlob = new Blob([content], { type: mime });
    this.filename = filename;

    // Stop scanning
    this.stopScanning();

    // Show completion UI
    this.statusText.textContent = 'Transfer complete!';
    this.receivedFileName.textContent = filename;
    this.receivedFileDetails.textContent =
      `${formatSize(content.length)} · ${this.blocksReceived} blocks received · ${elapsed}s`;
    this.completePanel.classList.add('visible');
    this.progressFill.style.width = '100%';
    this.progressArea.classList.add('visible');
  }

  _saveFile() {
    if (!this.fileBlob) return;

    const name = this.filename || 'received_file';
    const url = URL.createObjectURL(this.fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ── MIME type helper ──────────────────────────────────────────────────────

function guessMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mimes = {
    txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript',
    json: 'application/json', xml: 'application/xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
    pdf: 'application/pdf', zip: 'application/zip',
    mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
    woff: 'font/woff', woff2: 'font/woff2',
  };
  return mimes[ext] || 'application/octet-stream';
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.Receiver = Receiver;
}
