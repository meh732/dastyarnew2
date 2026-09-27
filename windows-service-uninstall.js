// Windows Service uninstaller script
const path = require('path');
const fs = require('fs');

let Service;
try {
  Service = require('node-windows').Service;
} catch (e) {
  const { execSync } = require('child_process');
  execSync('npm install node-windows --save', { stdio: 'inherit' });
  Service = require('node-windows').Service;
}

const targetScript = path.join(__dirname, 'service-runner.js');

const svc = new Service({
  name: 'TelegramInventoryBot',
  script: targetScript,
  workingDirectory: __dirname
});

svc.on('uninstall', function() {
  console.log('[OK] Windows Service uninstalled successfully. Background execution stopped.');
});

svc.uninstall();
