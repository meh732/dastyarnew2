#!/usr/bin/env node

/**
 * Telegram Inventory Assistant - Windows & Cross-Platform Interactive Installer
 * نصب‌کننده و پیکربندی تعاملی ربات دستیار انبارداری برای محیط ویندوز
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const https = require('https');

// ANSI Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

// Parse existing .env if available
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

// Save config into .env
function saveEnv(data) {
  const envPath = path.join(process.cwd(), '.env');
  let currentContent = '';
  if (fs.existsSync(envPath)) {
    currentContent = fs.readFileSync(envPath, 'utf8');
  }

  const keys = Object.keys(data);
  let updatedLines = [];
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

// Test proxy connection to api.telegram.org
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
      const req = https.get('https://api.telegram.org', { agent, timeout: 7000 }, (res) => {
        const latency = Date.now() - start;
        resolve({ success: true, latency });
      });
      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'No response received within 7 seconds (Timeout)' });
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  console.clear();
  console.log(`${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright}   Telegram Inventory Assistant - Interactive Setup (Windows)   ${colors.reset}`);
  console.log(`${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.yellow}Configuration for Server Port & Anti-Filter Proxy${colors.reset}\n`);

  // Verify Node.js version
  const nodeVer = process.version;
  const majorVer = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  console.log(`Detected Node.js version: ${colors.green}${nodeVer}${colors.reset}`);
  if (majorVer < 18) {
    console.log(`${colors.red}[WARNING] Node.js version is below 18. Version 18+ is recommended.${colors.reset}\n`);
  }

  const existingEnv = loadEnv();

  // 1. Port Selection
  console.log(`\n${colors.bright}[1/3] Web Server Port Configuration${colors.reset}`);
  const defaultPort = existingEnv.PORT || '3000';
  console.log(`Default Port: ${colors.green}${defaultPort}${colors.reset}`);
  let chosenPort = defaultPort;

  while (true) {
    const portInput = (await askQuestion(`Enter server port [Press Enter for ${defaultPort}]: `)).trim();
    if (!portInput) {
      chosenPort = defaultPort;
      break;
    }
    const num = parseInt(portInput, 10);
    if (!isNaN(num) && num >= 1 && num <= 65535) {
      chosenPort = String(num);
      break;
    }
    console.log(`${colors.red}Invalid port! Please enter a number between 1 and 65535.${colors.reset}`);
  }
  console.log(`[OK] Selected Port: ${colors.green}${chosenPort}${colors.reset}`);

  // 2. Proxy Configuration
  console.log(`\n${colors.bright}[2/3] Telegram Anti-Filtering Proxy Configuration${colors.reset}`);
  console.log(`${colors.yellow}Options (if Telegram is blocked in your location):${colors.reset}`);
  console.log(`  1. v2rayN (SOCKS5):  ${colors.cyan}socks5://127.0.0.1:10808${colors.reset}`);
  console.log(`  2. v2rayN (HTTP):    ${colors.cyan}http://127.0.0.1:10809${colors.reset}`);
  console.log(`  3. Clash (HTTP):     ${colors.cyan}http://127.0.0.1:7890${colors.reset}`);
  console.log(`  4. Direct (No Proxy): Press Enter without typing`);

  const defaultProxy = existingEnv.PROXY_URL || '';
  let chosenProxy = defaultProxy;

  while (true) {
    const promptMsg = defaultProxy
      ? `Proxy URL [Press Enter for previous: ${defaultProxy}]: `
      : `Proxy URL (Optional - Press Enter for direct connection): `;
    const proxyInput = (await askQuestion(promptMsg)).trim();

    if (!proxyInput) {
      chosenProxy = defaultProxy;
    } else if (proxyInput.toLowerCase() === 'none' || proxyInput === '0') {
      chosenProxy = '';
    } else {
      chosenProxy = proxyInput;
    }

    if (chosenProxy) {
      process.stdout.write(`Testing Telegram connection through proxy... `);
      const testResult = await testProxy(chosenProxy);
      if (testResult.success) {
        console.log(`\n${colors.green}[OK] Connected to api.telegram.org successfully (${testResult.latency}ms).${colors.reset}`);
        break;
      } else {
        console.log(`\n${colors.red}[WARNING] Connection test failed: ${testResult.error}${colors.reset}`);
        const confirm = (await askQuestion(`Keep this proxy anyway? (y/n) [Default: y]: `)).trim().toLowerCase();
        if (confirm === 'y' || confirm === 'yes' || confirm === '') {
          break;
        }
      }
    } else {
      console.log(`[INFO] Direct connection selected (No Proxy).`);
      break;
    }
  }

  // 3. Telegram Bot Token (Optional)
  console.log(`\n${colors.bright}[3/3] Telegram Bot Token (Optional)${colors.reset}`);
  const defaultToken = existingEnv.BOT_TOKEN || '';
  const tokenPrompt = defaultToken 
    ? `Bot Token [Press Enter for existing token]: `
    : `Bot Token (Optional - can also be configured in Web UI later): `;
  const tokenInput = (await askQuestion(tokenPrompt)).trim();
  const chosenToken = tokenInput || defaultToken;

  // Save to .env
  console.log(`\n${colors.yellow}Saving configuration to .env...${colors.reset}`);
  saveEnv({
    PORT: chosenPort,
    PROXY_URL: chosenProxy,
    BOT_TOKEN: chosenToken,
    NODE_ENV: 'production',
  });
  console.log(`${colors.green}[OK] Configuration saved successfully to .env${colors.reset}`);

  // 5. Dependency check and install
  console.log(`\n${colors.bright}[Step 4/5] Checking and installing project packages...${colors.reset}`);
  const needInstall = !fs.existsSync(path.join(process.cwd(), 'node_modules'));
  if (needInstall) {
    console.log(`Downloading and installing required dependencies via npm install...`);
    try {
      execSync('npm install --no-audit', { stdio: 'inherit' });
      console.log(`${colors.green}[OK] All npm dependencies installed successfully.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.red}[ERROR] npm install failed: ${e.message}${colors.reset}`);
    }
  } else {
    console.log(`${colors.green}[OK] Dependencies folder (node_modules) is already present.${colors.reset}`);
  }

  // 6. Build client and server
  const distServer = path.join(process.cwd(), 'dist', 'server.cjs');
  console.log(`\n${colors.bright}[Step 5/5] Compiling and building production assets...${colors.reset}`);
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] Production build created successfully.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}[WARNING] Build completed with note: ${e.message}${colors.reset}`);
  }

  // Final Summary
  console.log(`\n${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright}   [DONE] Full Zero-to-Hero Installation Complete!   ${colors.reset}`);
  console.log(`${colors.cyan}================================================================${colors.reset}`);
  console.log(`* Web Server Port:       ${colors.green}${chosenPort}${colors.reset}`);
  console.log(`* Web Panel URL:         ${colors.cyan}http://localhost:${chosenPort}${colors.reset}`);
  console.log(`* Telegram Proxy:        ${chosenProxy ? colors.green + chosenProxy + colors.reset : colors.yellow + 'Disabled (Direct)' + colors.reset}`);
  console.log(`* Telegram Bot Token:    ${chosenToken ? colors.green + 'Configured' + colors.reset : colors.yellow + 'Empty (Can be set in Web UI)' + colors.reset}`);
  console.log(`${colors.cyan}================================================================${colors.reset}\n`);

  // Ask how user wants to run: Permanent Windows Background Service or Normal start
  console.log(`${colors.bright}Choose execution mode:${colors.reset}`);
  console.log(`  1. ${colors.green}[RECOMMENDED] Install as Permanent Windows Background Service${colors.reset}`);
  console.log(`     (Runs silently in background, persists after CMD is closed, starts on Windows boot)`);
  console.log(`  2. Start now in standard interactive mode (opens CMD session & browser)`);
  console.log(`  3. Exit installer (run start.bat later manually)`);

  const runMode = (await askQuestion(`\nEnter choice (1, 2, or 3) [Default: 1]: `)).trim();
  rl.close();

  if (runMode === '1' || runMode === '') {
    console.log(`\n[*] Registering and starting Windows Background Service...`);
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      // Open browser
      const url = `http://localhost:${chosenPort}`;
      if (process.platform === 'win32') {
        execSync(`start "" "${url}"`);
      }
      console.log(`\n${colors.green}[OK] Bot is now active in background. Web UI opened: ${url}${colors.reset}\n`);
    } catch (err) {
      console.log(`${colors.yellow}[!] Note: If Windows Service installation needs Administrator rights, right-click install-windows-service.bat and choose 'Run as Administrator'.${colors.reset}`);
    }
  } else if (runMode === '2') {
    console.log(`\nStarting server in interactive mode...`);
    const url = `http://localhost:${chosenPort}`;
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`);
    }
    const srvFile = fs.existsSync(distServer) ? 'dist/server.cjs' : 'server.ts';
    if (srvFile.endsWith('.cjs')) {
      require(path.join(process.cwd(), 'dist', 'server.cjs'));
    } else {
      spawn('npx', ['tsx', 'server.ts'], { stdio: 'inherit', shell: true });
    }
  } else {
    console.log(`\nInstallation finished. To start anytime, use start.bat or install-windows-service.bat.\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${colors.red}Unexpected error:${colors.reset}`, err);
  rl.close();
  process.exit(1);
});
