#!/usr/bin/env node

/**
 * =====================================================================
 * Telegram Inventory Assistant - PC Management & Install Console
 * Interactive Windows, Linux & macOS Console (100% Clean English ASCII)
 * =====================================================================
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');

// ANSI color styling
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
};

const DEFAULT_REPO = 'https://github.com/meh732/-.git';

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(query) {
  const rl = createRl();
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            env[key] = val;
          }
        }
      });
    } catch (e) {
      // ignore
    }
  }
  return env;
}

function saveEnv(data) {
  const envPath = path.join(process.cwd(), '.env');
  let currentContent = '';
  if (fs.existsSync(envPath)) {
    currentContent = fs.readFileSync(envPath, 'utf8');
  }

  const keys = Object.keys(data);
  const updatedLines = [];
  const handledKeys = new Set();

  if (currentContent) {
    const lines = currentContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        updatedLines.push(line);
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        if (key in data) {
          updatedLines.push(`${key}=${data[key]}`);
          handledKeys.add(key);
        } else {
          updatedLines.push(line);
        }
      } else {
        updatedLines.push(line);
      }
    }
  }

  for (const key of keys) {
    if (!handledKeys.has(key)) {
      updatedLines.push(`${key}=${data[key]}`);
    }
  }

  fs.writeFileSync(envPath, updatedLines.join('\n').trim() + '\n', 'utf8');
}

function getGitRepoUrl() {
  const env = loadEnv();
  if (env.GITHUB_REPO_URL && env.GITHUB_REPO_URL.trim()) {
    return env.GITHUB_REPO_URL.trim();
  }
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (remoteUrl) return remoteUrl;
  } catch (e) {
    // Git might not be initialized
  }
  return DEFAULT_REPO;
}

function setGitRepoUrl(url) {
  const cleanUrl = url.trim();
  if (!cleanUrl) return;
  saveEnv({ GITHUB_REPO_URL: cleanUrl });
  try {
    execSync(`git remote set-url origin "${cleanUrl}"`, { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (e) {
    try {
      execSync(`git remote add origin "${cleanUrl}"`, { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      // ignore
    }
  }
}

function getGitCommitInfo() {
  try {
    const hash = execSync('git log -1 --format="%h - %s (%cr)"', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    return hash || 'No git commit history';
  } catch (e) {
    return 'Git repository not found or git not available';
  }
}

async function testProxy(proxyUrl) {
  if (!proxyUrl || !proxyUrl.trim()) return { success: true, direct: true };
  const clean = proxyUrl.trim();

  try {
    let agent;
    if (clean.startsWith('socks')) {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      agent = new SocksProxyAgent(clean);
    } else {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      agent = new HttpsProxyAgent(clean.includes('://') ? clean : `http://${clean}`);
    }

    const start = Date.now();
    return await new Promise((resolve) => {
      const req = https.get('https://api.telegram.org', { agent, timeout: 6000 }, (res) => {
        const latency = Date.now() - start;
        resolve({ success: true, latency });
      });
      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Connection timed out (Timeout)' });
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function checkPortListening(port) {
  return new Promise((resolve) => {
    const tester = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 }, (res) => {
      resolve(true);
    });
    tester.on('error', () => {
      const rootTest = http.get(`http://127.0.0.1:${port}`, { timeout: 1500 }, (res) => {
        resolve(true);
      });
      rootTest.on('error', () => resolve(false));
      rootTest.on('timeout', () => { rootTest.destroy(); resolve(false); });
    });
    tester.on('timeout', () => { tester.destroy(); resolve(false); });
  });
}

function showBanner() {
  console.clear();
  console.log(`${colors.cyan}======================================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright}    ___                      _                      ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}   |_ _|_ ____   _____ _ __ | |_ ___  _ __ _   _    ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}    | || '_ \\ \\ / / _ \\ '_ \\| __/ _ \\| '__| | | |   ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}    | || | | \\ V /  __/ | | | || (_) | |  | |_| |   ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}   |___|_| |_|\\_/ \\___|_| |_|\\__\\___/|_|   \\__, |   ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}                                           |___/    ${colors.reset}`);
  console.log(`${colors.cyan}    Telegram Inventory Assistant - PC Management & Install Console    ${colors.reset}`);
  console.log(`${colors.yellow}      Fast Setup, GitHub Auto-Updater & Windows Service Manager       ${colors.reset}`);
  console.log(`${colors.cyan}======================================================================${colors.reset}`);
}

async function showHeaderStatus() {
  const env = loadEnv();
  const repoUrl = getGitRepoUrl();
  const port = env.PORT || '3000';
  const proxy = env.PROXY_URL || 'Direct (No Proxy)';
  const isRunning = await checkPortListening(port);

  console.log(` GitHub Repo:   ${colors.yellow}${repoUrl}${colors.reset}`);
  console.log(` Service State: ${isRunning ? colors.green + '[RUNNING] on Port ' + port : colors.red + '[STOPPED]'}${colors.reset}`);
  console.log(` Proxy:         ${colors.cyan}${proxy}${colors.reset}`);
  console.log(`${colors.cyan}----------------------------------------------------------------------${colors.reset}`);
}

// 1. Full Install / Reinstall
async function fullInstall() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [1] Full Installation & Setup from GitHub${colors.reset}\n`);

  const currentRepo = getGitRepoUrl();
  console.log(`Current GitHub Repository: ${colors.cyan}${currentRepo}${colors.reset}`);
  const inputRepo = await ask(`Enter GitHub Repository URL [Press Enter for default: ${currentRepo}]: `);
  const finalRepo = inputRepo || currentRepo;
  setGitRepoUrl(finalRepo);

  console.log(`\n${colors.blue}[1/4] Fetching latest source code from GitHub...${colors.reset}`);
  try {
    if (fs.existsSync(path.join(process.cwd(), '.git'))) {
      try {
        execSync(`git remote set-url origin "${finalRepo}"`, { stdio: 'inherit' });
        execSync('git fetch --all', { stdio: 'inherit' });
        execSync('git reset --hard origin/main || git reset --hard origin/master || git pull', { 
          stdio: 'inherit', 
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' 
        });
        console.log(`${colors.green}[OK] Source code synced with GitHub successfully.${colors.reset}`);
      } catch (ge) {
        console.log(`${colors.yellow}[!] Git sync note: ${ge.message}. Continuing with local files...${colors.reset}`);
      }
    } else {
      console.log(`[INFO] .git directory not found. Proceeding with current folder.`);
    }
  } catch (e) {
    console.log(`${colors.yellow}[!] Git verification completed.${colors.reset}`);
  }

  // Install dependencies
  console.log(`\n${colors.blue}[2/4] Installing project dependencies (npm install)...${colors.reset}`);
  try {
    execSync('npm install --no-audit', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] Dependencies installed successfully.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.red}[ERROR] npm install error: ${e.message}${colors.reset}`);
  }

  // Build
  console.log(`\n${colors.blue}[3/4] Compiling and building production assets (npm run build)...${colors.reset}`);
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] Production build created successfully.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}[!] Build note: ${e.message}${colors.reset}`);
  }

  // Environment setup
  console.log(`\n${colors.blue}[4/4] Configuring Environment Variables (.env)...${colors.reset}`);
  await configureEnvironmentInteractive();

  console.log(`\n${colors.green}${colors.bright}======================================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright} 🎉 Installation & Setup Completed Successfully!                      ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}======================================================================${colors.reset}`);
  const env = loadEnv();
  const port = env.PORT || '3000';
  console.log(`Web Management Panel: ${colors.cyan}http://localhost:${port}${colors.reset}`);

  console.log(`\nChoose execution mode:`);
  console.log(` 1. Install & Run as Permanent 24/7 Windows Background Service (Recommended)`);
  console.log(` 2. Start now in current terminal window`);
  console.log(` 0. Return to Main Menu`);
  const startMode = await ask(`\nSelect [Default: 1]: `);

  if (startMode === '1' || startMode === '') {
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      if (process.platform === 'win32') execSync(`start "" "http://localhost:${port}"`);
      console.log(`\n${colors.green}[OK] Windows Service installed and active. Browser opened.${colors.reset}`);
    } catch (err) {
      console.log(`${colors.yellow}Note: To install Windows Service with administrator rights, run install-windows-service.bat as Administrator.${colors.reset}`);
    }
  } else if (startMode === '2') {
    startInteractiveProcess(port);
    return;
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 2. Update from GitHub
async function updateFromGithub() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [2] Update Bot to Latest GitHub Version${colors.reset}\n`);

  const currentRepo = getGitRepoUrl();
  console.log(`Target Repository: ${colors.yellow}${currentRepo}${colors.reset}`);
  const repoInput = await ask(`Press [Enter] to confirm repository URL: `);
  const repoToUse = repoInput || currentRepo;
  setGitRepoUrl(repoToUse);

  console.log(`\n${colors.blue}[1/3] Pulling latest commits from GitHub...${colors.reset}`);
  try {
    try {
      execSync(`git remote set-url origin "${repoToUse}"`, { stdio: 'inherit' });
    } catch (e) {
      try {
        execSync(`git remote add origin "${repoToUse}"`, { stdio: 'inherit' });
      } catch (err) {}
    }
    execSync('git fetch --all', { stdio: 'inherit' });
    execSync('git pull origin main || git pull origin master || git pull', { 
      stdio: 'inherit', 
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' 
    });
    console.log(`${colors.green}[OK] Latest code pulled from GitHub.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}[!] Syncing with git reset...${colors.reset}`);
    try {
      execSync('git reset --hard origin/main || git reset --hard origin/master', { 
        stdio: 'inherit', 
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' 
      });
    } catch (err) {
      console.log(`${colors.red}[ERROR] Git pull error: ${err.message}${colors.reset}`);
    }
  }

  console.log(`\n${colors.blue}[2/3] Updating npm packages (npm install)...${colors.reset}`);
  try {
    execSync('npm install --no-audit', { stdio: 'inherit' });
  } catch (e) {
    console.log(`${colors.yellow}npm note: ${e.message}${colors.reset}`);
  }

  console.log(`\n${colors.blue}[3/3] Rebuilding production bundle (npm run build)...${colors.reset}`);
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] Project successfully rebuilt.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}Build note: ${e.message}${colors.reset}`);
  }

  console.log(`\n${colors.green}${colors.bright}======================================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright} ✅ Update from GitHub Completed Successfully!                        ${colors.reset}`);
  console.log(`${colors.green}${colors.bright}======================================================================${colors.reset}`);
  
  // Restart service if installed
  console.log(`Restarting service...`);
  try {
    if (process.platform === 'win32') {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
    }
  } catch (e) {}

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 3. Set/Change Git Repo URL
async function changeGitRepo() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [3] Change GitHub Repository URL${colors.reset}\n`);

  const current = getGitRepoUrl();
  console.log(`Current URL: ${colors.yellow}${current}${colors.reset}\n`);
  const newUrl = await ask(`Enter new GitHub Repository URL (e.g. https://github.com/user/repo.git): `);

  if (newUrl) {
    setGitRepoUrl(newUrl);
    console.log(`\n${colors.green}[OK] GitHub Repository URL updated to ${newUrl} and saved in .env.${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}No changes made.${colors.reset}`);
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 4. Start / Restart Service
async function restartService() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [4] Restart Bot Service & Web Panel${colors.reset}\n`);
  const env = loadEnv();
  const port = env.PORT || '3000';

  if (process.platform === 'win32') {
    console.log(`Stopping previous processes on port ${port}...`);
    try {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`, { 
        stdio: 'ignore', 
        shell: 'cmd.exe' 
      });
    } catch (e) {}

    console.log(`Starting Windows Background Service...`);
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      console.log(`\n${colors.green}[OK] Service started successfully.${colors.reset}`);
      execSync(`start "" "http://localhost:${port}"`);
    } catch (e) {
      console.log(`${colors.yellow}To run interactively, you can run start.bat.${colors.reset}`);
    }
  } else {
    console.log(`Non-Windows system. Run npm start to launch.`);
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 5. Stop Service
async function stopService() {
  showBanner();
  console.log(`\n${colors.bright}${colors.red}>>> [5] Stop Bot Service${colors.reset}\n`);
  const env = loadEnv();
  const port = env.PORT || '3000';

  if (process.platform === 'win32') {
    try {
      execSync('node windows-service-uninstall.js', { stdio: 'inherit' });
    } catch (e) {}

    try {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`, { 
        stdio: 'ignore', 
        shell: 'cmd.exe' 
      });
      console.log(`${colors.green}[OK] Active processes on port ${port} terminated.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.yellow}No active process found on port ${port}.${colors.reset}`);
    }
  }

  console.log(`\n${colors.green}Service stopped successfully.${colors.reset}`);
  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 6. Check Status
async function checkStatus() {
  showBanner();
  console.log(`\n${colors.bright}${colors.cyan}>>> [6] Service Status & System Diagnostics${colors.reset}\n`);

  const env = loadEnv();
  const port = env.PORT || '3000';
  const proxy = env.PROXY_URL || '';
  const repo = getGitRepoUrl();
  const gitInfo = getGitCommitInfo();

  console.log(` OS Platform:       ${process.platform} (${process.arch})`);
  console.log(` Node.js Version:   ${process.version}`);
  console.log(` GitHub Repo:       ${colors.yellow}${repo}${colors.reset}`);
  console.log(` Latest Git Commit: ${colors.white}${gitInfo}${colors.reset}`);
  console.log(` Server Port:       ${port}`);
  console.log(` Proxy URL:         ${proxy ? colors.cyan + proxy : colors.yellow + 'Disabled (Direct Connection)'}${colors.reset}`);
  console.log(` Bot Token:         ${env.BOT_TOKEN ? colors.green + 'Configured' : colors.yellow + 'Not set'}${colors.reset}`);

  process.stdout.write(`\nChecking Web Server on port ${port}... `);
  const isListening = await checkPortListening(port);
  if (isListening) {
    console.log(`${colors.green}[ONLINE - ACTIVE]${colors.reset}`);
    console.log(` Web Panel URL: ${colors.cyan}http://localhost:${port}${colors.reset}`);
  } else {
    console.log(`${colors.red}[OFFLINE - STOPPED]${colors.reset}`);
  }

  if (proxy) {
    process.stdout.write(`Testing Telegram connection through proxy (${proxy})... `);
    const pTest = await testProxy(proxy);
    if (pTest.success) {
      console.log(`${colors.green}[CONNECTED - Latency: ${pTest.latency}ms]${colors.reset}`);
    } else {
      console.log(`${colors.red}[FAILED: ${pTest.error}]${colors.reset}`);
    }
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 7. Live Logs
async function viewLogs() {
  showBanner();
  console.log(`\n${colors.bright}${colors.yellow}>>> [7] System Live Logs${colors.reset}\n`);

  const logFiles = ['app.log', 'server.log', 'combined.log', 'error.log'];
  let foundLog = false;

  for (const file of logFiles) {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      console.log(`${colors.cyan}--- Last lines of ${file} ---${colors.reset}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').slice(-30);
      console.log(lines.join('\n'));
      foundLog = true;
    }
  }

  if (!foundLog) {
    console.log(`[INFO] Server logs are displayed in live terminal session.`);
    console.log(`To run with live terminal output, launch start.bat.`);
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 8. Configure Environment Interactive
async function configureEnvironmentInteractive() {
  const existingEnv = loadEnv();

  // Port
  const defaultPort = existingEnv.PORT || '3000';
  const inputPort = await ask(`Enter Web Server Port [Press Enter for ${defaultPort}]: `);
  const chosenPort = inputPort || defaultPort;

  // Proxy
  console.log(`\nTelegram Proxy Configuration (for anti-censorship):`);
  console.log(`  1. v2rayN (SOCKS5):  socks5://127.0.0.1:10808`);
  console.log(`  2. v2rayN (HTTP):    http://127.0.0.1:10809`);
  console.log(`  3. Clash (HTTP):     http://127.0.0.1:7890`);
  console.log(`  4. Direct (No Proxy): Press Enter without typing or type 0`);

  const defaultProxy = existingEnv.PROXY_URL || '';
  const inputProxy = await ask(`Enter Proxy URL [Press Enter for ${defaultProxy || 'Direct'}]: `);
  let chosenProxy = inputProxy !== '' ? inputProxy : defaultProxy;
  if (chosenProxy === '0' || chosenProxy.toLowerCase() === 'none') chosenProxy = '';

  if (chosenProxy) {
    process.stdout.write(`Testing Telegram proxy connection to api.telegram.org... `);
    const res = await testProxy(chosenProxy);
    if (res.success) {
      console.log(`${colors.green}[OK - Connected in ${res.latency}ms]${colors.reset}`);
    } else {
      console.log(`${colors.red}[WARNING - Connection error: ${res.error}]${colors.reset}`);
    }
  }

  // Bot Token
  const defaultToken = existingEnv.BOT_TOKEN || '';
  const inputToken = await ask(`Enter Telegram Bot Token (Optional) [Press Enter for ${defaultToken ? 'Configured' : 'Empty'}]: `);
  const chosenToken = inputToken !== '' ? inputToken : defaultToken;

  // Admin ID
  const defaultAdmin = existingEnv.ADMIN_ID || '';
  const inputAdmin = await ask(`Enter Telegram Admin User ID (Optional) [Press Enter for ${defaultAdmin || 'Empty'}]: `);
  const chosenAdmin = inputAdmin !== '' ? inputAdmin : defaultAdmin;

  saveEnv({
    PORT: chosenPort,
    PROXY_URL: chosenProxy,
    BOT_TOKEN: chosenToken,
    ADMIN_ID: chosenAdmin,
    NODE_ENV: 'production',
  });

  console.log(`\n${colors.green}[OK] Configuration saved to .env successfully.${colors.reset}`);
}

async function changeConfigMenu() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [8] Configure Port, Proxy & Environment Variables${colors.reset}\n`);
  await configureEnvironmentInteractive();
  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 9. Windows Background Service Manager
async function windowsServiceManager() {
  showBanner();
  console.log(`\n${colors.bright}${colors.cyan}>>> [9] Windows Background Service Manager${colors.reset}\n`);
  console.log(` 1. ${colors.green}Install & Start Permanent Windows Service${colors.reset} (Auto-starts with Windows)`);
  console.log(` 2. ${colors.red}Uninstall & Remove Windows Service${colors.reset}`);
  console.log(` 0. Back to Main Menu`);

  const choice = await ask(`\nSelect option [0-2]: `);

  if (choice === '1') {
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      console.log(`\n${colors.green}[OK] Windows Service installed and running in background.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.yellow}[!] Note: If required, run install-windows-service.bat as Administrator.${colors.reset}`);
    }
  } else if (choice === '2') {
    try {
      execSync('node windows-service-uninstall.js', { stdio: 'inherit' });
      console.log(`\n${colors.green}[OK] Windows Service uninstalled successfully.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.yellow}[!] Note: If required, run uninstall-windows-service.bat as Administrator.${colors.reset}`);
    }
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

// 10. Uninstall
async function uninstallBot() {
  showBanner();
  console.log(`\n${colors.bright}${colors.red}>>> [10] Uninstall Bot & Services${colors.reset}\n`);
  const confirm = await ask(`${colors.red}Are you sure you want to stop and remove all services on this system? (y/n) [n]: ${colors.reset}`);

  if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
    console.log(`Stopping and uninstalling Windows background service...`);
    try {
      execSync('node windows-service-uninstall.js', { stdio: 'inherit' });
    } catch (e) {}

    const env = loadEnv();
    const port = env.PORT || '3000';
    try {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`, { 
        stdio: 'ignore', 
        shell: 'cmd.exe' 
      });
    } catch (e) {}

    console.log(`${colors.green}[OK] Services stopped and removed.${colors.reset}`);
    console.log(`To delete completely, remove this folder.`);
  } else {
    console.log(`Operation canceled.`);
  }

  await ask(`\nPress [Enter] to return to the Main Menu...`);
}

function startInteractiveProcess(port) {
  console.log(`\nStarting server in interactive terminal mode...`);
  const distServer = path.join(process.cwd(), 'dist', 'server.cjs');
  if (process.platform === 'win32') {
    execSync(`start "" "http://localhost:${port}"`);
  }
  if (fs.existsSync(distServer)) {
    require(distServer);
  } else {
    spawn('npx', ['tsx', 'server.ts'], { 
      stdio: 'inherit', 
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' 
    });
  }
}

// Main Menu Loop
async function main() {
  while (true) {
    showBanner();
    await showHeaderStatus();

    console.log(` ${colors.green}1)${colors.reset}  🚀 Full Install / Reinstall from GitHub`);
    console.log(` ${colors.green}2)${colors.reset}  🔄 Update Bot to Latest GitHub Version`);
    console.log(` ${colors.green}3)${colors.reset}  🌐 Change GitHub Repository URL`);
    console.log(` ${colors.green}4)${colors.reset}  ⚡ Restart Bot Service & Web Panel`);
    console.log(` ${colors.green}5)${colors.reset}  🛑 Stop Bot Service`);
    console.log(` ${colors.cyan}6)${colors.reset}  📊 Check Service Status & Diagnostics`);
    console.log(` ${colors.cyan}7)${colors.reset}  📜 View System Live Logs`);
    console.log(` ${colors.yellow}8)${colors.reset}  ⚙️ Configure Port, Proxy & Bot Token (.env)`);
    console.log(` ${colors.yellow}9)${colors.reset}  🛡️ Windows Auto-Start Background Service Manager`);
    console.log(` ${colors.red}10)${colors.reset} 🗑️ Uninstall Bot & Clean up`);
    console.log(` ${colors.magenta}0)${colors.reset}  🚪 Exit\n`);

    const choice = await ask(`Please select an option [0-10]: `);

    switch (choice) {
      case '1':
        await fullInstall();
        break;
      case '2':
        await updateFromGithub();
        break;
      case '3':
        await changeGitRepo();
        break;
      case '4':
        await restartService();
        break;
      case '5':
        await stopService();
        break;
      case '6':
        await checkStatus();
        break;
      case '7':
        await viewLogs();
        break;
      case '8':
        await changeConfigMenu();
        break;
      case '9':
        await windowsServiceManager();
        break;
      case '10':
        await uninstallBot();
        break;
      case '0':
      case 'exit':
      case 'q':
        console.log(`\nExiting Management Console. Have a great day!\n`);
        process.exit(0);
      default:
        console.log(`\n${colors.red}Invalid option! Please enter a number between 0 and 10.${colors.reset}`);
        await new Promise((r) => setTimeout(r, 1200));
        break;
    }
  }
}

main().catch((err) => {
  console.error('Fatal error in PC management console:', err);
  process.exit(1);
});
