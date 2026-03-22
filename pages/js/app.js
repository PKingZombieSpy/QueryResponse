// js/app.js — Main entry: mode switching, initialization

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const btnSend = document.getElementById('btn-send');
  const btnReceive = document.getElementById('btn-receive');
  const panelSend = document.getElementById('panel-send');
  const panelReceive = document.getElementById('panel-receive');

  const sender = new Sender();
  const receiver = new Receiver();

  function setMode(mode) {
    if (mode === 'send') {
      btnSend.classList.add('active');
      btnReceive.classList.remove('active');
      panelSend.classList.add('active');
      panelReceive.classList.remove('active');
      // Stop receiver if scanning
      receiver.stopScanning();
    } else {
      btnReceive.classList.add('active');
      btnSend.classList.remove('active');
      panelReceive.classList.add('active');
      panelSend.classList.remove('active');
      // Stop sender if running
      sender.stop();
    }
  }

  btnSend.addEventListener('click', () => setMode('send'));
  btnReceive.addEventListener('click', () => setMode('receive'));
});
