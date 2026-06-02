const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

let sock = null;
let isConnected = false;
let qrCodeData = null;
let connectionStatus = 'disconnected';
const authDir = path.join(__dirname, 'whatsapp_auth');

let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

async function connectWhatsApp() {
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['MediTrack', 'Chrome', '1.0'],
    connectTimeoutMs: 30000,
    retryRequestDelayMs: 500,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = qr;
      connectionStatus = 'qr_ready';
      qrcode.generate(qr, { small: true });
      console.log('\n📱 Scan QR code above with WhatsApp to connect!\n');
      if (ioInstance) ioInstance.emit('whatsapp_qr', { qr });
    }

    if (connection === 'close') {
      isConnected = false;
      connectionStatus = 'disconnected';
      qrCodeData = null;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('WhatsApp disconnected. Reconnecting:', shouldReconnect);
      if (ioInstance) ioInstance.emit('whatsapp_status', { status: 'disconnected' });
      if (shouldReconnect) {
        setTimeout(connectWhatsApp, 5000);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      connectionStatus = 'connected';
      qrCodeData = null;
      console.log('✅ WhatsApp connected successfully!');
      if (ioInstance) ioInstance.emit('whatsapp_status', { status: 'connected' });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    // Handle incoming messages if needed
    for (const msg of messages) {
      if (!msg.key.fromMe && msg.message) {
        console.log('Received WhatsApp message from:', msg.key.remoteJid);
      }
    }
  });
}

async function sendWhatsAppMessage(phoneNumber, message) {
  if (!isConnected || !sock) {
    console.log('WhatsApp not connected. Message queued for:', phoneNumber);
    return { success: false, error: 'WhatsApp not connected' };
  }

  try {
    // Format phone number (Indian numbers: add 91 prefix)
    let formatted = phoneNumber.replace(/\D/g, '');
    if (formatted.startsWith('0')) formatted = formatted.slice(1);
    if (formatted.length === 10) formatted = '91' + formatted;
    const jid = formatted + '@s.whatsapp.net';

    await sock.sendMessage(jid, { text: message });
    console.log(`✅ WhatsApp message sent to ${formatted}`);
    return { success: true };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    return { success: false, error: err.message };
  }
}

// Message templates
function tokenConfirmationMsg(patientName, tokenNumber, department, hospitalName, estimatedWait) {
  return `🏥 *${hospitalName} - MediTrack*\n\nHello *${patientName}*!\n\nYour token has been registered.\n\n📋 *Token Number:* #${tokenNumber}\n🏥 *Department:* ${department}\n⏱️ *Estimated Wait:* ~${estimatedWait} mins\n\n_Please stay nearby and wait for your turn. You'll get a reminder when your turn is near._\n\n_MediTrack — Smart Queue Management_`;
}

function reminderMsg(patientName, tokenNumber, tokensAhead, hospitalName) {
  return `⚠️ *${hospitalName} - Your Turn is Near!*\n\nHello *${patientName}*,\n\nYour token *#${tokenNumber}* is coming up soon!\n\n👥 *Patients ahead of you:* ${tokensAhead}\n\n⏰ Please proceed to the waiting area now.\n\n_MediTrack — Smart Queue Management_`;
}

function callNowMsg(patientName, tokenNumber, department, hospitalName) {
  return `🔔 *${hospitalName} - YOUR TURN NOW!*\n\nHello *${patientName}*,\n\n✅ Token *#${tokenNumber}* is being called!\n\n🚪 Please report to the *${department}* counter immediately.\n\n_MediTrack — Smart Queue Management_`;
}

function getStatus() {
  return { isConnected, connectionStatus, hasQR: !!qrCodeData };
}

function getQR() {
  return qrCodeData;
}

module.exports = {
  connectWhatsApp,
  sendWhatsAppMessage,
  setIO,
  getStatus,
  getQR,
  templates: { tokenConfirmationMsg, reminderMsg, callNowMsg }
};
