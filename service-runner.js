// Windows Service Runner entry point
const path = require('path');
const fs = require('fs');

process.chdir(__dirname);

const distServer = path.join(__dirname, 'dist', 'server.cjs');
if (fs.existsSync(distServer)) {
  require(distServer);
} else {
  const { spawn } = require('child_process');
  spawn('npx', ['tsx', 'server.ts'], { stdio: 'inherit', shell: true });
}
