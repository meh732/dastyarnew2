// Windows Service installer script using node-windows
const path = require('path');
const fs = require('fs');

let Service;
try {
  Service = require('node-windows').Service;
} catch (e) {
  console.log('[*] Installing node-windows dependency...');
  const { execSync } = require('child_process');
  execSync('npm install node-windows --save', { stdio: 'inherit' });
  Service = require('node-windows').Service;
}

const targetScript = fs.existsSync(path.join(__dirname, 'dist', 'server.cjs'))
  ? path.join(__dirname, 'dist', 'server.cjs')
  : path.join(__dirname, 'server.ts');

const svc = new Service({
  name: 'TelegramInventoryBot',
  description: 'Telegram Inventory Bot Background Windows Service',
  script: targetScript,
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=512'
  ]
});

svc.on('install', function() {
  console.log('[OK] Windows Service installed successfully.');
  console.log('[*] Starting service in background...');
  svc.start();
  console.log('================================================================');
  console.log(' Telegram Inventory Bot is now running as a Windows Service!');
  console.log(' It will stay active in the background even if CMD is closed');
  console.log(' or after Windows restarts.');
  console.log('================================================================');
});

svc.on('alreadyinstalled', function() {
  console.log('[!] Service is already installed. Restarting...');
  svc.start();
});

svc.on('start', function() {
  console.log('[RUNNING] Windows Service is active.');
});

svc.install();
