#!/usr/bin/env node

/**
 * =====================================================================
 * Telegram Inventory Bot - Interactive PC Manager & Installer (Windows/PC)
 * منوی تعاملی مدیریت، نصب، بروزرسانی و پیکربندی ربات در کامپیوتر (ویندوز / مک / لینوکس)
 * دقیقاً مشابه منوی لینوکس با قابلیت دریافت آدرس گیت‌هاب و بروزرسانی خودکار
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
    // Git might not be initialized or configured
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
    return 'Not a git repository or git not available';
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
        resolve({ success: false, error: 'زمان اتصال به پایان رسید (Timeout)' });
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
      // Also test root if /api/health not responding
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
  console.log(`${colors.yellow}      سامانه تعاملی مدیریت، نصب و بروزرسانی ربات در کامپیوتر (ویندوز)       ${colors.reset}`);
  console.log(`${colors.cyan}======================================================================${colors.reset}`);
}

async function showHeaderStatus() {
  const env = loadEnv();
  const repoUrl = getGitRepoUrl();
  const port = env.PORT || '3000';
  const proxy = env.PROXY_URL || 'Direct (بدون پروکسی)';
  const isRunning = await checkPortListening(port);

  console.log(` 🌐 ${colors.bright}آدرس گیت‌هاب (GitHub):${colors.reset}   ${colors.yellow}${repoUrl}${colors.reset}`);
  console.log(` 🔌 ${colors.bright}وضعیت سرویس (Status):${colors.reset}   ${isRunning ? colors.green + '● در حال اجرا (RUNNING) در پورت ' + port : colors.red + '○ خاموش (STOPPED)'}${colors.reset}`);
  console.log(` 🛡️  ${colors.bright}پروکسی تلگرام (Proxy):${colors.reset}    ${colors.cyan}${proxy}${colors.reset}`);
  console.log(`${colors.cyan}----------------------------------------------------------------------${colors.reset}`);
}

// 1. Full Install / Reinstall
async function fullInstall() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [1] نصب و راه‌اندازی کامل ربات از گیت‌هاب (Full Install / Reinstall)${colors.reset}\n`);

  const currentRepo = getGitRepoUrl();
  console.log(`آدرس مخزن گیت‌هاب فعلی: ${colors.cyan}${currentRepo}${colors.reset}`);
  const inputRepo = await ask(`آدرس مخزن گیت‌هاب را وارد کنید [Enter برای استفاده از همین آدرس]: `);
  const finalRepo = inputRepo || currentRepo;
  setGitRepoUrl(finalRepo);

  console.log(`\n${colors.blue}[1/4] دریافت و بروزرسانی آخرین سورس کد از گیت‌هاب...${colors.reset}`);
  try {
    // If git is present
    if (fs.existsSync(path.join(process.cwd(), '.git'))) {
      try {
        execSync(`git remote set-url origin "${finalRepo}"`, { stdio: 'inherit' });
        execSync('git fetch --all', { stdio: 'inherit' });
        execSync('git reset --hard origin/main || git reset --hard origin/master || git pull', { stdio: 'inherit', shell: true });
        console.log(`${colors.green}[OK] آخرین تغییرات از گیت‌هاب دریافت شد.${colors.reset}`);
      } catch (ge) {
        console.log(`${colors.yellow}[!] اخطار دریافت گیت: ${ge.message}. با فایل‌های محلی ادامه می‌دهیم...${colors.reset}`);
      }
    } else {
      console.log(`[INFO] پوشه .git شناسایی نشد. راه‌اندازی در پوشه جاری انجام می‌شود.`);
    }
  } catch (e) {
    console.log(`${colors.yellow}[!] بررسی گیت تکمیل شد.${colors.reset}`);
  }

  // Install dependencies
  console.log(`\n${colors.blue}[2/4] نصب پکیج‌ها و پیش‌نیازهای پروژه (npm install)...${colors.reset}`);
  try {
    execSync('npm install --no-audit', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] پکیج‌ها با موفقیت نصب شدند.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.red}[ERROR] خطا در npm install: ${e.message}${colors.reset}`);
  }

  // Build
  console.log(`\n${colors.blue}[3/4] ساخت و کامپایل فایل‌های اجرایی (npm run build)...${colors.reset}`);
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] کامپایل پروژه با موفقیت انجام شد.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}[!] هشدار در بیلد: ${e.message}${colors.reset}`);
  }

  // Environment setup
  console.log(`\n${colors.blue}[4/4] پیکربندی متغیرهای سرور، پورت و پروکسی ضد فیلتر...${colors.reset}`);
  await configureEnvironmentInteractive();

  console.log(`\n${colors.green}${colors.bright}🎉 نصب و راه‌اندازی با موفقیت به پایان رسید!${colors.reset}`);
  const env = loadEnv();
  const port = env.PORT || '3000';
  console.log(`🌐 آدرس پنل تحت وب: ${colors.cyan}http://localhost:${port}${colors.reset}`);

  const startMode = await ask(`\nآیا می‌خواهید برنامه اکنون اجرا شود؟\n 1. اجرای نامرئی به عنوان سرویس دائمی ویندوز (پیشنهادی)\n 2. اجرای معمولی در ترمینال جاری\n 0. بازگشت به منو\nانتخاب [1]: `);

  if (startMode === '1' || startMode === '') {
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      if (process.platform === 'win32') execSync(`start "" "http://localhost:${port}"`);
      console.log(`\n${colors.green}[OK] سرویس ویندوز فعال شد و مرورگر باز گردید.${colors.reset}`);
    } catch (err) {
      console.log(`${colors.yellow}برای نصب سرویس ویندوز، فایل install-windows-service.bat را با Run as Administrator اجرا کنید.${colors.reset}`);
    }
  } else if (startMode === '2') {
    startInteractiveProcess(port);
    return;
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 2. Update from GitHub
async function updateFromGithub() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [2] بروزرسانی سریع ربات از مخزن گیت‌هاب (Update Bot from GitHub)${colors.reset}\n`);

  const currentRepo = getGitRepoUrl();
  console.log(`مخزن گیت‌هاب: ${colors.yellow}${currentRepo}${colors.reset}`);
  const repoInput = await ask(`آدرس مخزن را تایید کنید [Enter برای ادامه]: `);
  const repoToUse = repoInput || currentRepo;
  setGitRepoUrl(repoToUse);

  console.log(`\n${colors.blue}[1/3] دریافت آخرین کامیت‌ها و تغییرات از گیت‌هاب...${colors.reset}`);
  try {
    try {
      execSync(`git remote set-url origin "${repoToUse}"`, { stdio: 'inherit' });
    } catch (e) {
      try {
        execSync(`git remote add origin "${repoToUse}"`, { stdio: 'inherit' });
      } catch (err) {}
    }
    execSync('git fetch --all', { stdio: 'inherit' });
    execSync('git pull origin main || git pull origin master || git pull', { stdio: 'inherit', shell: true });
    console.log(`${colors.green}[OK] کدهای جدید با موفقیت دریافت شدند.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}[!] تلاش برای هماهنگ‌سازی با git reset...${colors.reset}`);
    try {
      execSync('git reset --hard origin/main || git reset --hard origin/master', { stdio: 'inherit', shell: true });
    } catch (err) {
      console.log(`${colors.red}[ERROR] خطا در دریافت از گیت‌هاب: ${err.message}${colors.reset}`);
    }
  }

  console.log(`\n${colors.blue}[2/3] بررسی و نصب پکیج‌های جدید (npm install)...${colors.reset}`);
  try {
    execSync('npm install --no-audit', { stdio: 'inherit' });
  } catch (e) {
    console.log(`${colors.yellow}هشدار npm: ${e.message}${colors.reset}`);
  }

  console.log(`\n${colors.blue}[3/3] کامپایل مجدد نسخه تولیدی (npm run build)...${colors.reset}`);
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`${colors.green}[OK] پروژه با موفقیت مجدداً بیلد شد.${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}هشدار بیلد: ${e.message}${colors.reset}`);
  }

  console.log(`\n${colors.green}${colors.bright}✅ بروزرسانی از گیت‌هاب با موفقیت پایان یافت!${colors.reset}`);
  
  // Restart service if installed
  console.log(`در حال راه‌اندازی مجدد سرویس‌ها...`);
  try {
    if (process.platform === 'win32') {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
    }
  } catch (e) {}

  await ask(`\nبرای بازگشت به منوی اصلی Enter بزنید...`);
}

// 3. Set/Change Git Repo URL
async function changeGitRepo() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [3] تنظیم یا تغییر آدرس مخزن گیت‌هاب (Set/Change GitHub Repo URL)${colors.reset}\n`);

  const current = getGitRepoUrl();
  console.log(`آدرس فعلی: ${colors.yellow}${current}${colors.reset}\n`);
  const newUrl = await ask(`آدرس جدید گیت‌هاب را وارد کنید (مثال: https://github.com/username/repo.git): `);

  if (newUrl) {
    setGitRepoUrl(newUrl);
    console.log(`\n${colors.green}[OK] آدرس مخزن گیت‌هاب به ${newUrl} تغییر یافت و در .env ذخیره شد.${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}تغییری اعمال نشد.${colors.reset}`);
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 4. Start / Restart Service
async function restartService() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [4] راه‌اندازی مجدد سرویس و وب‌پنل (Restart Service)${colors.reset}\n`);
  const env = loadEnv();
  const port = env.PORT || '3000';

  if (process.platform === 'win32') {
    console.log(`در حال متوقف کردن پروسه‌های قبلی پورت ${port}...`);
    try {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`, { stdio: 'ignore', shell: true });
    } catch (e) {}

    console.log(`راه‌اندازی مجدد سرویس پس‌زمینه ویندوز...`);
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      console.log(`\n${colors.green}[OK] سرویس با موفقیت راه‌اندازی شد.${colors.reset}`);
      execSync(`start "" "http://localhost:${port}"`);
    } catch (e) {
      console.log(`${colors.yellow}برای راه‌اندازی دستی، می‌توانید start.bat را اجرا کنید.${colors.reset}`);
    }
  } else {
    console.log(`سیستم‌عامل غیر ویندوز شناسایی شد. برای شروع دستی: npm start`);
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 5. Stop Service
async function stopService() {
  showBanner();
  console.log(`\n${colors.bright}${colors.red}>>> [5] توقف سرویس و خاموش کردن برنامه (Stop Service)${colors.reset}\n`);
  const env = loadEnv();
  const port = env.PORT || '3000';

  if (process.platform === 'win32') {
    try {
      execSync('node windows-service-uninstall.js', { stdio: 'inherit' });
    } catch (e) {}

    try {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`, { stdio: 'ignore', shell: true });
      console.log(`${colors.green}[OK] پروسه‌های فعال پورت ${port} بسته شدند.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.yellow}پروسه فعالی روی پورت ${port} یافت نشد.${colors.reset}`);
    }
  }

  console.log(`\n${colors.green}سرویس با موفقیت خاموش شد.${colors.reset}`);
  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 6. Check Status
async function checkStatus() {
  showBanner();
  console.log(`\n${colors.bright}${colors.cyan}>>> [6] بررسی وضعیت و پایش سلامت سیستم (System & Service Status)${colors.reset}\n`);

  const env = loadEnv();
  const port = env.PORT || '3000';
  const proxy = env.PROXY_URL || '';
  const repo = getGitRepoUrl();
  const gitInfo = getGitCommitInfo();

  console.log(` 📦 ${colors.bright}پلتفرم و محیط:${colors.reset}        ${process.platform} (${process.arch})`);
  console.log(` 🟢 ${colors.bright}نسخه Node.js:${colors.reset}         ${process.version}`);
  console.log(` 🌐 ${colors.bright}آدرس مخزن گیت‌هاب:${colors.reset}    ${colors.yellow}${repo}${colors.reset}`);
  console.log(` 🔖 ${colors.bright}آخرین کامیت گیت:${colors.reset}      ${colors.white}${gitInfo}${colors.reset}`);
  console.log(` 🚪 ${colors.bright}پورت سرور (PORT):${colors.reset}     ${port}`);
  console.log(` 🛡️  ${colors.bright}پروکسی ضد فیلتر:${colors.reset}     ${proxy ? colors.cyan + proxy : colors.yellow + 'غیرفعال (اتصال مستقیم)'}${colors.reset}`);
  console.log(` 🤖 ${colors.bright}توکن ربات تلگرام:${colors.reset}     ${env.BOT_TOKEN ? colors.green + 'تنظیم شده (Configured)' : colors.yellow + 'خالی'}${colors.reset}`);

  process.stdout.write(`\n🔍 در حال بررسی پاسخ‌دهی سرور وب روی پورت ${port}... `);
  const isListening = await checkPortListening(port);
  if (isListening) {
    console.log(`${colors.green}[فعال - OK]${colors.reset}`);
    console.log(`   🔗 آدرس وب پنل: ${colors.cyan}http://localhost:${port}${colors.reset}`);
  } else {
    console.log(`${colors.red}[غیرفعال - STOPPED]${colors.reset}`);
  }

  if (proxy) {
    process.stdout.write(`🔍 تست اتصال به سرورهای تلگرام از طریق پروکسی... `);
    const pTest = await testProxy(proxy);
    if (pTest.success) {
      console.log(`${colors.green}[موفق - زمان پاسخ: ${pTest.latency}ms]${colors.reset}`);
    } else {
      console.log(`${colors.red}[ناموفق: ${pTest.error}]${colors.reset}`);
    }
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 7. Live Logs
async function viewLogs() {
  showBanner();
  console.log(`\n${colors.bright}${colors.yellow}>>> [7] مشاهده لاگ‌ها و رخدادهای سیستم (System Logs)${colors.reset}\n`);
  console.log(`${colors.dim}برای خروج از حالت لاگ و بازگشت به منو، کلید Ctrl+C را فشار دهید.${colors.reset}\n`);

  const logFiles = ['app.log', 'server.log', 'combined.log', 'error.log'];
  let foundLog = false;

  for (const file of logFiles) {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      console.log(`${colors.cyan}--- محتوای آخرین خطوط ${file} ---${colors.reset}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').slice(-30);
      console.log(lines.join('\n'));
      foundLog = true;
    }
  }

  if (!foundLog) {
    console.log(`ℹ️ فایل لاگ متنی ذخیره شده در دیسک یافت نشد. لاگ‌ها به صورت زنده در ترمینال سرور نمایش داده می‌شوند.`);
    console.log(`💡 برای اجرای تعاملی همراه با لاگ زنده، می‌توانید از فایل start.bat استفاده کنید.`);
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 8. Configure Environment Interactive
async function configureEnvironmentInteractive() {
  const existingEnv = loadEnv();

  // Port
  const defaultPort = existingEnv.PORT || '3000';
  const inputPort = await ask(`شماره پورت وب سرور [Enter برای ${defaultPort}]: `);
  const chosenPort = inputPort || defaultPort;

  // Proxy
  console.log(`\nپیکربندی پروکسی ضد فیلتر تلگرام (در صورت مسدود بودن تلگرام):`);
  console.log(`  1. v2rayN (SOCKS5):  socks5://127.0.0.1:10808`);
  console.log(`  2. v2rayN (HTTP):    http://127.0.0.1:10809`);
  console.log(`  3. Clash (HTTP):     http://127.0.0.1:7890`);
  console.log(`  4. بدون پروکسی (اتصال مستقیم): کافیست Enter بزنید یا 0 وارد کنید`);

  const defaultProxy = existingEnv.PROXY_URL || '';
  const inputProxy = await ask(`آدرس پروکسی [Enter برای ${defaultProxy || 'بدون پروکسی'}]: `);
  let chosenProxy = inputProxy !== '' ? inputProxy : defaultProxy;
  if (chosenProxy === '0' || chosenProxy.toLowerCase() === 'none') chosenProxy = '';

  if (chosenProxy) {
    process.stdout.write(`در حال تست اتصال تلگرام از طریق ${chosenProxy}... `);
    const res = await testProxy(chosenProxy);
    if (res.success) {
      console.log(`${colors.green}[موفق - ${res.latency}ms]${colors.reset}`);
    } else {
      console.log(`${colors.red}[خطا: ${res.error}]${colors.reset}`);
    }
  }

  // Bot Token
  const defaultToken = existingEnv.BOT_TOKEN || '';
  const inputToken = await ask(`توکن ربات تلگرام (اختیاری) [Enter برای ${defaultToken ? 'توکن ذخیره شده فعلی' : 'خالی'}]: `);
  const chosenToken = inputToken !== '' ? inputToken : defaultToken;

  // Admin ID
  const defaultAdmin = existingEnv.ADMIN_ID || '';
  const inputAdmin = await ask(`آیدی عددی تلگرام ادمین (اختیاری) [Enter برای ${defaultAdmin || 'خالی'}]: `);
  const chosenAdmin = inputAdmin !== '' ? inputAdmin : defaultAdmin;

  saveEnv({
    PORT: chosenPort,
    PROXY_URL: chosenProxy,
    BOT_TOKEN: chosenToken,
    ADMIN_ID: chosenAdmin,
    NODE_ENV: 'production',
  });

  console.log(`\n${colors.green}[OK] تنظیمات در فایل .env ذخیره گردید.${colors.reset}`);
}

async function changeConfigMenu() {
  showBanner();
  console.log(`\n${colors.bright}${colors.green}>>> [8] تغییر پورت، پروکسی ضد فیلتر و متغیرهای .env${colors.reset}\n`);
  await configureEnvironmentInteractive();
  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 9. Windows Background Service Manager
async function windowsServiceManager() {
  showBanner();
  console.log(`\n${colors.bright}${colors.cyan}>>> [9] مدیریت سرویس پس‌زمینه خودکار ویندوز (Windows Service Manager)${colors.reset}\n`);
  console.log(` 1. ${colors.green}نصب و فعال‌سازی سرویس پس‌زمینه دائمی${colors.reset} (شروع خودکار با ویندوز و بدون پنجره سیاه)`);
  console.log(` 2. ${colors.red}حذف و غیرفعال‌سازی سرویس پس‌زمینه ویندوز${colors.reset}`);
  console.log(` 0. بازگشت به منوی اصلی`);

  const choice = await ask(`\nانتخاب [1-2]: `);

  if (choice === '1') {
    try {
      execSync('node windows-service-install.js', { stdio: 'inherit' });
      console.log(`\n${colors.green}[OK] سرویس ویندوز با موفقیت نصب و اجرا شد.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.yellow}[!] در صورت نیاز، فایل install-windows-service.bat را به صورت Run as Administrator اجرا کنید.${colors.reset}`);
    }
  } else if (choice === '2') {
    try {
      execSync('node windows-service-uninstall.js', { stdio: 'inherit' });
      console.log(`\n${colors.green}[OK] سرویس ویندوز با موفقیت حذف شد.${colors.reset}`);
    } catch (e) {
      console.log(`${colors.yellow}[!] در صورت نیاز، فایل uninstall-windows-service.bat را به صورت Run as Administrator اجرا کنید.${colors.reset}`);
    }
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

// 10. Uninstall
async function uninstallBot() {
  showBanner();
  console.log(`\n${colors.bright}${colors.red}>>> [10] حذف کامل برنامه و سرویس‌ها (Uninstall Bot)${colors.reset}\n`);
  const confirm = await ask(`${colors.red}آیا مطمئن هستید که می‌خواهید برنامه را از این سیستم به طور کامل حذف کنید؟ (y/n) [n]: ${colors.reset}`);

  if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
    console.log(`در حال متوقف کردن و حذف سرویس‌های ویندوز...`);
    try {
      execSync('node windows-service-uninstall.js', { stdio: 'inherit' });
    } catch (e) {}

    const env = loadEnv();
    const port = env.PORT || '3000';
    try {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /f /pid %a`, { stdio: 'ignore', shell: true });
    } catch (e) {}

    console.log(`${colors.green}سرویس‌ها متوقف و حذف شدند.${colors.reset}`);
    console.log(`💡 برای پاکسازی نهایی کافی است پوشه برنامه را حذف کنید.`);
  } else {
    console.log(`عملیات لغو شد.`);
  }

  await ask(`\nبرای بازگشت به منو Enter بزنید...`);
}

function startInteractiveProcess(port) {
  console.log(`\nدر حال راه‌اندازی سرور به صورت مستقیم در همین پنجره...`);
  const distServer = path.join(process.cwd(), 'dist', 'server.cjs');
  if (process.platform === 'win32') {
    execSync(`start "" "http://localhost:${port}"`);
  }
  if (fs.existsSync(distServer)) {
    require(distServer);
  } else {
    spawn('npx', ['tsx', 'server.ts'], { stdio: 'inherit', shell: true });
  }
}

// Main Menu Loop
async function main() {
  while (true) {
    showBanner();
    await showHeaderStatus();

    console.log(` ${colors.green}1)${colors.reset} 🚀 نصب و راه‌اندازی کامل (Full Install / Reinstall from GitHub)`);
    console.log(` ${colors.green}2)${colors.reset} 🔄 بروزرسانی سریع از گیت‌هاب (Update Bot from GitHub)`);
    console.log(` ${colors.green}3)${colors.reset} 🌐 تنظیم یا تغییر آدرس مخزن گیت‌هاب (Set/Change GitHub Repo URL)`);
    console.log(` ${colors.green}4)${colors.reset} ⚡ راه‌اندازی مجدد سرویس و وب‌پنل (Restart Service)`);
    console.log(` ${colors.green}5)${colors.reset} 🛑 توقف سرویس و خاموش کردن برنامه (Stop Service)`);
    console.log(` ${colors.cyan}6)${colors.reset} 📊 بررسی وضعیت و سلامت سیستم (Check Service & System Status)`);
    console.log(` ${colors.cyan}7)${colors.reset} 📜 مشاهده لاگ‌های زنده (View Live Logs)`);
    console.log(` ${colors.yellow}8)${colors.reset} ⚙️ تغییر پورت، پروکسی ضد فیلتر و تنظیمات .env`);
    console.log(` ${colors.yellow}9)${colors.reset} 🛡️ مدیریت سرویس پس‌زمینه خودکار ویندوز (Windows Service Manager)`);
    console.log(` ${colors.red}10)${colors.reset} 🗑️ حذف کامل برنامه و سرویس‌ها (Uninstall Bot)`);
    console.log(` ${colors.magenta}0)${colors.reset} 🚪 خروج (Exit)\n`);

    const choice = await ask(`گزینه مورد نظر خود را وارد کنید [0-10]: `);

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
        console.log(`\nخروج از سامانه مدیریت. روز خوبی داشته باشید!\n`);
        process.exit(0);
      default:
        console.log(`\n${colors.red}گزینه نامعتبر است. لطفاً عددی بین 0 تا 10 انتخاب کنید.${colors.reset}`);
        await new Promise((r) => setTimeout(r, 1200));
        break;
    }
  }
}

main().catch((err) => {
  console.error('Fatal error in PC menu manager:', err);
  process.exit(1);
});
