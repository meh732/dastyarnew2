import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import { Telegraf, Markup } from "telegraf";
import * as XLSX from "xlsx";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { execSync, spawn } from "child_process";
import AdmZip from "adm-zip";

// Memory buffer for live system logs
const systemLogBuffer: Array<{ time: string; message: string; type: 'info' | 'error' | 'warn' }> = [];
const MAX_SYSTEM_LOGS = 200;

function appendSystemLog(message: string, type: 'info' | 'error' | 'warn' = 'info') {
  const time = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  systemLogBuffer.push({ time, message, type });
  if (systemLogBuffer.length > MAX_SYSTEM_LOGS) {
    systemLogBuffer.shift();
  }
}

// Intercept console.log and console.error safely
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args: any[]) => {
  originalConsoleLog(...args);
  const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  appendSystemLog(text, 'info');
};

console.error = (...args: any[]) => {
  originalConsoleError(...args);
  const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  appendSystemLog(text, 'error');
};

console.warn = (...args: any[]) => {
  originalConsoleWarn(...args);
  const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  appendSystemLog(text, 'warn');
};

interface InventoryItem {
  code: string;
  name: string;
  stock: number;
}
interface UserRule {
  id: string;
  target: string; // numeric User ID or @username
  name?: string; // Optional label/note e.g. "همکار مهم", "رقیب", "اسپمر"
  action: "ALWAYS_NOTIFY" | "NEVER_NOTIFY";
  enabled: boolean;
  forwardMessage?: boolean;
  notes?: string;
  createdAt?: string;
}

interface BotConfig {
  token: string;
  adminId: string;
  groupId?: string;
  customerMessage?: string;
  groupAccess?: "all" | "admin" | "group_admins";
  botEnabled?: boolean;
  disableCustomerPm?: boolean;
  userbotApiId?: string;
  userbotApiHash?: string;
  userbotSession?: string;
  userbotEnabled?: boolean;
  userbotGroups?: string;
  proxyUrl?: string;
  userRules?: UserRule[];
}

function findMatchingUserRule(
  senderId: string | undefined | null,
  senderUsername: string | undefined | null,
  rules?: UserRule[]
): UserRule | undefined {
  if (!rules || !Array.isArray(rules) || rules.length === 0) return undefined;
  const cleanSenderId = String(senderId || "").trim().toLowerCase();
  const cleanSenderUser = String(senderUsername || "").trim().toLowerCase().replace(/^@/, "");

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const target = String(rule.target || "").trim().toLowerCase().replace(/^@/, "");
    if (!target) continue;

    // 1. Match by numeric ID
    if (cleanSenderId && (cleanSenderId === target || target === `id:${cleanSenderId}`)) {
      return rule;
    }
    // 2. Match by @username
    if (cleanSenderUser && cleanSenderUser === target) {
      return rule;
    }
  }

  return undefined;
}
interface CustomerRequest {
  userId: string;
  username: string;
  chatId: string;
  chatTitle: string;
  itemCode: string;
  itemName: string;
  date: string;
}
interface DetectedGroup {
  id: string;
  title: string;
  username?: string;
  lastActive: string;
}
interface AppState {
  config: BotConfig;
  inventory: InventoryItem[];
  customers: CustomerRequest[];
  isRunning: boolean;
  groups?: DetectedGroup[];
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));

// Helper to parse proxy URL into GramJS (telegram package) proxy options
function parseGramJsProxy(proxyUrl?: string): { ip: string; port: number; socksType: 4 | 5; username?: string; password?: string } | undefined {
  if (!proxyUrl || typeof proxyUrl !== "string") return undefined;
  const clean = proxyUrl.trim();
  if (!clean) return undefined;
  try {
    const url = new URL(clean.includes("://") ? clean : `socks5://${clean}`);
    const ip = url.hostname;
    const port = Number(url.port) || (url.protocol.startsWith("socks4") ? 1080 : 10808);
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    const socksType: 4 | 5 = url.protocol.startsWith("socks4") ? 4 : 5;
    return { ip, port, socksType, username, password };
  } catch (e) {
    console.error("⚠️ Invalid proxy URL format for Userbot:", clean, e);
    return undefined;
  }
}

const escapeHtml = (t: string | undefined): string => {
  if (!t) return "";
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

// Helper to create proxy agent for Telegraf (bot)
function getTelegrafProxyAgent(proxyUrl?: string) {
  const target = (proxyUrl || state?.config?.proxyUrl || process.env.PROXY_URL || process.env.TELEGRAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "").trim();
  if (!target) return undefined;
  try {
    if (target.startsWith("socks")) {
      return new SocksProxyAgent(target);
    } else {
      return new HttpsProxyAgent(target.includes("://") ? target : `http://${target}`);
    }
  } catch (err) {
    console.error("⚠️ Could not initialize proxy agent for Telegraf:", err);
    return undefined;
  }
}

// Helper to get proxy options for TelegramClient (GramJS)
function getGramJsProxyConfig(proxyUrl?: string) {
  const target = (proxyUrl || state?.config?.proxyUrl || process.env.PROXY_URL || process.env.TELEGRAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "").trim();
  if (!target) return undefined;
  return parseGramJsProxy(target);
}

const normalizePersianArabicNumbers = (str: string | undefined | null): string => {
  if (!str) return "";
  const persianNumbers = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicNumbers  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let res = String(str);
  for (let i = 0; i < 10; i++) {
    res = res.replace(persianNumbers[i], String(i)).replace(arabicNumbers[i], String(i));
  }
  // Normalize Arabic Yeh and Kaf to Persian
  res = res.replace(/ي/g, "ی").replace(/ك/g, "ک");
  // Normalize Tatweel, Zero-width joiners and Unicode formatting marks to standard spaces
  res = res.replace(/[\u200c\u200d\u200e\u200f\u0640\ufeff]/g, " ");
  // Normalize all unicode dashes/hyphens to standard hyphen
  res = res.replace(/[‐‑‒–—―−ー_]/g, "-");
  return res;
};

const normalizeLettersAndNumbers = (str: string | undefined | null): string => {
  if (!str) return "";
  
  // 1. Normalize Persian/Arabic numbers to English
  let res = normalizePersianArabicNumbers(str).toLowerCase();
  
  // 2. Normalize common Persian phonetic spellings of English letters (do this first to match multi-char sequences)
  res = res
    .replace(/ایکس/g, 'x')
    .replace(/اچ/g, 'h')
    .replace(/جی/g, 'j')
    .replace(/کی/g, 'k')
    .replace(/پی/g, 'p')
    .replace(/تی/g, 't')
    .replace(/سی/g, 'c')
    .replace(/دی/g, 'd')
    .replace(/اف/g, 'f')
    .replace(/ام/g, 'm')
    .replace(/ان/g, 'n')
    .replace(/ال/g, 'l')
    .replace(/ار/g, 'r')
    .replace(/اس/g, 's');

  // 3. Normalize single interchangeable Persian letters to English (both phonetic and layout-based)
  res = res
    .replace(/پ/g, 'p')
    .replace(/ک/g, 'k')
    .replace(/ی/g, 'y')
    .replace(/م/g, 'm')
    .replace(/ه/g, 'h')
    .replace(/د/g, 'd')
    .replace(/ت/g, 't')
    .replace(/ن/g, 'n')
    .replace(/ب/g, 'b')
    .replace(/ج/g, 'j')
    .replace(/س/g, 's')
    .replace(/ر/g, 'r')
    .replace(/ل/g, 'l')
    .replace(/و/g, 'v')
    .replace(/چ/g, 'ch')
    .replace(/ف/g, 'f')
    .replace(/ق/g, 'q')
    .replace(/گ/g, 'g')
    .replace(/ص/g, 'w')
    .replace(/ث/g, 'e')
    .replace(/غ/g, 'g')
    .replace(/ع/g, 'u')
    .replace(/خ/g, 'o') // physically 'o' is very common
    .replace(/ح/g, 'p') // physically 'p' is very common
    .replace(/ش/g, 'a') // physically 'a' is very common
    .replace(/ظ/g, 'z')
    .replace(/ط/g, 'x') // physically 'x'
    .replace(/ز/g, 'z')
    .replace(/ذ/g, 'b'); // physically 'b'

  // 4. Normalize letter 'o' / 'O' to '0' (zero) since 'o' is never used in auto OEM part numbers
  res = res.replace(/o/g, '0');

  return res;
};

const sanitizeCode = (code: string | undefined | null): string => {
  if (!code) return "";
  const normalized = normalizeLettersAndNumbers(code);
  return normalized.replace(/[^a-z0-9]/g, '');
};

const isAdmin = (ctx: any): boolean => {
  loadState();
  if (!ctx || !ctx.from) return false;
  if (!state || !state.config || !state.config.adminId) return false;
  
  const adminIdClean = String(state.config.adminId).trim().toLowerCase();
  if (!adminIdClean) return false;

  const fromIdStr = String(ctx.from.id).trim().toLowerCase();
  if (fromIdStr === adminIdClean) return true;

  const fromUsername = ctx.from.username ? String(ctx.from.username).trim().toLowerCase() : "";
  if (fromUsername) {
    if (fromUsername === adminIdClean) return true;
    if (`@${fromUsername}` === adminIdClean) return true;
    if (adminIdClean === `@${fromUsername}`) return true;
  }

  return false;
};

const matchCodeInText = (text: string, code: string): boolean => {
  const cleanTarget = sanitizeCode(code);
  if (!cleanTarget) return false;

  // Ignore purely numeric codes of length < 4 to avoid matching quantities ("1", "2تا", etc.)
  if (/^\d+$/.test(cleanTarget) && cleanTarget.length < 4) {
    return false;
  }
  if (cleanTarget.length < 3) {
    return false;
  }

  let normalizedText = normalizeLettersAndNumbers(text);

  // 1. Separate Persian text attached directly to alphanumeric codes
  // e.g. "جلوپنجره863501M000موجوده" -> "جلوپنجره 863501M000 موجوده"
  normalizedText = normalizedText
    .replace(/([\u0600-\u06FF]+)([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u0600-\u06FF]+)/g, '$1 $2');

  // Separate common attached automotive suffixes/words
  normalizedText = normalizedText.replace(
    /(?<=[a-zA-Z0-9\u0600-\u06FF])(اصلی|جنیون|کره|تایوان|چین|چپ|راست|جلو|عقب|استوک|نو|دست|عدد|جفت|شرکتی|وارداتی|ctr|mobis|mando|hiq|oem|lh|rh|fr|rr|fl|rl)(?=[^a-zA-Z0-9\u0600-\u06FF]|$)/gi,
    ' $1 '
  );

  // 2. Token-level matching
  // Split message by any punctuation and whitespace
  const rawTokens = normalizedText.split(/[\s,;:()[\]{}<>"'\n\r\t/\\+*!?#@$%^&=~|،؛ـ]+/);
  const cleanTokens: string[] = [];

  for (const rawToken of rawTokens) {
    const clean = sanitizeCode(rawToken);
    if (clean) {
      cleanTokens.push(clean);
    }
  }

  // A. Single token exact match & OEM trailing zero match
  for (const cleanToken of cleanTokens) {
    // Skip purely numeric tokens < 4 chars
    if (/^\d+$/.test(cleanToken) && cleanToken.length < 4) continue;

    // Exact Match (e.g. 863501M000 vs 86350-1M000)
    if (cleanToken === cleanTarget) {
      return true;
    }

    // OEM Automotive Trailing-Zero Equivalence (e.g. 863501M <-> 863501M000, 54830-2H <-> 54830-2H000)
    if (cleanTarget.length >= 7 && cleanToken.length >= 6) {
      if (cleanTarget.startsWith(cleanToken) && /^0+$/.test(cleanTarget.slice(cleanToken.length))) {
        return true;
      }
    }
    if (cleanToken.length >= 7 && cleanTarget.length >= 6) {
      if (cleanToken.startsWith(cleanTarget) && /^0+$/.test(cleanToken.slice(cleanTarget.length))) {
        return true;
      }
    }
  }

  // B. Sliding window multi-token matching (for codes written with spaces like "86350 1M000" or "86350 1M 000")
  for (let i = 0; i < cleanTokens.length; i++) {
    let combined = cleanTokens[i];
    for (let window = 1; window <= 3 && i + window < cleanTokens.length; window++) {
      combined += cleanTokens[i + window];
      if (combined === cleanTarget) {
        return true;
      }
      if (cleanTarget.length >= 7 && combined.length >= 6) {
        if (cleanTarget.startsWith(combined) && /^0+$/.test(cleanTarget.slice(combined.length))) {
          return true;
        }
      }
      if (combined.length >= 7 && cleanTarget.length >= 6) {
        if (combined.startsWith(cleanTarget) && /^0+$/.test(combined.slice(cleanTarget.length))) {
          return true;
        }
      }
    }
  }

  // C. Fallback: Multi-segment regex match for codes written with symbols/delimiters
  try {
    const escapedChars = cleanTarget.split('').map(char => {
      return char.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    });

    let charPattern = '';
    if (cleanTarget.length >= 9 && cleanTarget.endsWith('000')) {
      const core = cleanTarget.slice(0, -3);
      const coreEscaped = core.split('').map(c => c.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('[-.\\s/_]*');
      charPattern = `${coreEscaped}([-.\\s/_]*(0[-.\\s/_]*0[-.\\s/_]*0|0[-.\\s/_]*0|0))?`;
    } else {
      charPattern = escapedChars.join('[-.\\s/_]*');
    }

    const regexStr = `(?<![a-zA-Z0-9])${charPattern}(?![a-zA-Z0-9])`;
    const regex = new RegExp(regexStr, 'i');
    if (regex.test(normalizedText)) {
      return true;
    }
  } catch (err) {
    // regex fallback
  }

  return false;
};

const isProd = process.env.NODE_ENV === "production";

const getStoragePath = (): string => {
  // 1. Try project root directory (process.cwd()) first (highly recommended for shared hosting/cPanel/VPS to ensure all concurrent processes sync on the same file)
  try {
    const rootPath = path.join(process.cwd(), "bot-data.json");
    fs.writeFileSync(rootPath + ".tmp", "test");
    fs.unlinkSync(rootPath + ".tmp");
    return rootPath;
  } catch (e) {
    // fallback
  }

  // 2. If project root is not writable, fall back to process.env.HOME
  if (process.env.HOME) {
    const homePath = path.join(process.env.HOME, "bot-data.json");
    try {
      fs.writeFileSync(homePath + ".tmp", "test");
      fs.unlinkSync(homePath + ".tmp");
      return homePath;
    } catch (e) {
      // fallback
    }
  }
  
  // 3. Try /tmp directory for serverless (like Cloud Run) or other jailed ephemeral hosting
  try {
    const tmpPath = path.join("/tmp", "bot-data.json");
    fs.writeFileSync(tmpPath + ".tmp", "test");
    fs.unlinkSync(tmpPath + ".tmp");
    return tmpPath;
  } catch (e) {
    // fallback
  }

  return path.join(process.cwd(), "bot-data.json");
};

const DATA_FILE = getStoragePath();
const OLD_DATA_FILE = path.join(__dirname, isProd ? ".." : "", "bot-data.json");
const WORKSPACE_DATA_FILE = path.join(process.cwd(), "bot-data.json");

let state: AppState = {
  config: { 
    token: "", 
    adminId: "", 
    groupId: "", 
    customerMessage: "", 
    groupAccess: "all", 
    botEnabled: true, 
    disableCustomerPm: false,
    proxyUrl: process.env.PROXY_URL || ""
  },
  inventory: [],
  customers: [],
  isRunning: true,
  groups: [],
};

const BACKUP_FILE = DATA_FILE + ".bak";

let isLoaded = false;
let lastCheckedTime = 0;
let lastLoadedMtime = 0;
const DISK_CHECK_COOLDOWN_MS = 2000;

let lastKnownValidConfig: {
  token: string;
  adminId: string;
  groupId: string;
  customerMessage: string;
  groupAccess: "all" | "admin" | "group_admins";
  botEnabled: boolean;
  disableCustomerPm: boolean;
  proxyUrl?: string;
  userRules?: UserRule[];
} = {
  token: "",
  adminId: "",
  groupId: "",
  customerMessage: "",
  groupAccess: "all",
  botEnabled: true,
  disableCustomerPm: false,
  proxyUrl: process.env.PROXY_URL || "",
  userRules: []
};

function loadState(force = false) {
  const now = Date.now();
  if (!force && isLoaded && (now - lastCheckedTime < DISK_CHECK_COOLDOWN_MS)) {
    return;
  }
  lastCheckedTime = now;

  try {
    if (fs.existsSync(DATA_FILE)) {
      const stat = fs.statSync(DATA_FILE);
      if (!force && isLoaded && stat.mtimeMs === lastLoadedMtime) {
        return;
      }
      lastLoadedMtime = stat.mtimeMs;
    }
  } catch (e) {
    console.error("[State Load] Failed to check mtime", e);
  }

  let loadedSuccessfully = false;
  let targetFile = DATA_FILE;

  // Try to find any existing file
  if (!fs.existsSync(targetFile)) {
    if (fs.existsSync(BACKUP_FILE)) {
      targetFile = BACKUP_FILE;
    } else if (fs.existsSync(OLD_DATA_FILE)) {
      targetFile = OLD_DATA_FILE;
    } else if (fs.existsSync(WORKSPACE_DATA_FILE)) {
      targetFile = WORKSPACE_DATA_FILE;
    }
  }

  const tryLoadFromFile = (filePath: string): boolean => {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        if (!raw || raw.trim() === "") {
          console.warn(`[State Load] File ${filePath} is empty, skipping.`);
          return false;
        }
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          // Validate that it has at least some expected keys to avoid corrupt formats
          if (saved.config || saved.inventory || saved.customers || saved.groups) {
            state.config = { ...state.config, ...(saved.config || {}) };
            state.inventory = saved.inventory || [];
            state.customers = saved.customers || [];
            state.groups = saved.groups || [];
            state.isRunning = typeof saved.isRunning === 'boolean' ? saved.isRunning : true;
            
            // Cache the config if it contains valid values
            if (state.config.token || state.config.adminId) {
              lastKnownValidConfig = {
                token: state.config.token || lastKnownValidConfig.token,
                adminId: state.config.adminId || lastKnownValidConfig.adminId,
                groupId: state.config.groupId || lastKnownValidConfig.groupId,
                customerMessage: state.config.customerMessage || lastKnownValidConfig.customerMessage,
                groupAccess: state.config.groupAccess || lastKnownValidConfig.groupAccess,
                botEnabled: typeof state.config.botEnabled === "boolean" ? state.config.botEnabled : lastKnownValidConfig.botEnabled,
                disableCustomerPm: typeof state.config.disableCustomerPm === "boolean" ? state.config.disableCustomerPm : lastKnownValidConfig.disableCustomerPm,
                proxyUrl: state.config.proxyUrl || lastKnownValidConfig.proxyUrl || process.env.PROXY_URL || "",
                userRules: state.config.userRules || lastKnownValidConfig.userRules || [],
              };
            }
            if (!state.config.proxyUrl && process.env.PROXY_URL) {
              state.config.proxyUrl = process.env.PROXY_URL;
            }

            // Save back to safe storage path if we migrated or loaded from backup
            if (filePath !== DATA_FILE) {
              console.log(`[State Load] Successfully migrated/restored state from ${filePath} to safe path: ${DATA_FILE}`);
              // Use direct write to initialize the main file safely
              fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
            }
            return true;
          }
        }
      }
    } catch (e) {
      console.error(`[State Load] Error reading or parsing state file ${filePath}:`, e);
    }
    return false;
  };

  // 1. Try primary file
  loadedSuccessfully = tryLoadFromFile(DATA_FILE);

  // 2. If primary failed, try backup file
  if (!loadedSuccessfully && DATA_FILE !== BACKUP_FILE) {
    console.warn("[State Load] Primary state file load failed. Trying backup file...");
    loadedSuccessfully = tryLoadFromFile(BACKUP_FILE);
  }

  // 3. If backup failed, try OLD_DATA_FILE
  if (!loadedSuccessfully) {
    console.warn("[State Load] Backup state file load failed. Trying old/workspace fallback files...");
    loadedSuccessfully = tryLoadFromFile(OLD_DATA_FILE);
    if (!loadedSuccessfully) {
      tryLoadFromFile(WORKSPACE_DATA_FILE);
    }
  }

  // Fallback to .env variables if not set in state
  if (!state.config.adminId && process.env.ADMIN_ID) {
    state.config.adminId = process.env.ADMIN_ID;
  }
  if (!state.config.token && process.env.BOT_TOKEN) {
    state.config.token = process.env.BOT_TOKEN;
  }

  // Update last known valid config if we got them from .env fallbacks
  if (state.config.token || state.config.adminId) {
    lastKnownValidConfig.token = lastKnownValidConfig.token || state.config.token;
    lastKnownValidConfig.adminId = lastKnownValidConfig.adminId || state.config.adminId;
  }

  // Double guard: restore from memory cache if fields got wiped
  if (!state.config.token && lastKnownValidConfig.token) {
    state.config.token = lastKnownValidConfig.token;
  }
  if (!state.config.adminId && lastKnownValidConfig.adminId) {
    state.config.adminId = lastKnownValidConfig.adminId;
  }

  isLoaded = true;
}

// Initial load
loadState(true);

function saveState() {
  // Guard against saving an empty config if we previously had a valid one in memory
  if (!state.config.token && !state.config.adminId) {
    if (lastKnownValidConfig.token || lastKnownValidConfig.adminId) {
      console.warn("[State Save] Refusing to overwrite state with empty config. Restoring config from memory.");
      state.config = { ...state.config, ...lastKnownValidConfig };
    } else {
      console.warn("[State Save] Both token and adminId are empty, skipping save to avoid corrupting file.");
      return;
    }
  }

  // If one of them became empty but we had it in memory, restore it to be completely safe
  if (!state.config.token && lastKnownValidConfig.token) {
    state.config.token = lastKnownValidConfig.token;
  }
  if (!state.config.adminId && lastKnownValidConfig.adminId) {
    state.config.adminId = lastKnownValidConfig.adminId;
  }

  try {
    const rawData = JSON.stringify(state, null, 2);
    const tmpFile = DATA_FILE + ".tmp";
    
    // 1. Write to a temporary file first
    fs.writeFileSync(tmpFile, rawData, "utf-8");
    
    // 2. If backup file is supported, backup the current valid DATA_FILE
    if (fs.existsSync(DATA_FILE)) {
      try {
        fs.copyFileSync(DATA_FILE, BACKUP_FILE);
      } catch (err) {
        console.error("[State Save] Failed to create backup file", err);
      }
    }
    
    // 3. Atomically rename the temp file to the target DATA_FILE (atomic rename protects against incomplete file read/write issues)
    fs.renameSync(tmpFile, DATA_FILE);

    // Update loaded timestamp so we don't reload our own written file immediately
    try {
      const stat = fs.statSync(DATA_FILE);
      lastLoadedMtime = stat.mtimeMs;
    } catch (e) {}

  } catch (e) {
    console.error("[State Save] Failed to save state atomically:", e);
    // Fallback to direct write if renameSync fails
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.error("[State Save] Direct write fallback also failed:", err);
    }
  }
}

process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception (Ignored to keep bot running):", err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection (Ignored to keep bot running):", reason);
});

let bot: any = null;
let botMe: any = null;

const adminSessions: Record<string | number, { step: string; data: any }> = {};

function generateFullBackup() {
  loadState(true);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestampStr = now.toISOString();
  const timeFormatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  
  let persianDate = "";
  try {
    persianDate = new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'full',
      timeStyle: 'medium',
      timeZone: 'Asia/Tehran'
    }).format(now);
  } catch (e) {
    persianDate = now.toLocaleString();
  }

  const backupData = {
    app: "robotdatyar",
    version: "2.0.0",
    backupTimestamp: timestampStr,
    backupTimeFormatted: timeFormatted,
    backupDatePersian: persianDate,
    summary: {
      inventoryCount: (state.inventory || []).length,
      userRulesCount: (state.config?.userRules || []).length,
      customersCount: (state.customers || []).length,
      groupsCount: (state.groups || []).length
    },
    inventory: state.inventory || [],
    userRules: state.config?.userRules || [],
    config: {
      adminId: state.config?.adminId,
      groupId: state.config?.groupId,
      customerMessage: state.config?.customerMessage,
      groupAccess: state.config?.groupAccess,
      botEnabled: state.config?.botEnabled,
      disableCustomerPm: state.config?.disableCustomerPm,
      userbotEnabled: state.config?.userbotEnabled,
      userbotGroups: state.config?.userbotGroups,
      proxyUrl: state.config?.proxyUrl
    },
    customers: state.customers || [],
    groups: state.groups || []
  };

  return { backupData, filename: `robotdatyar_backup_${timeFormatted}.json` };
}

function restoreFromBackupData(backupData: any): { success: boolean; summary: any; error?: string } {
  if (!backupData || typeof backupData !== 'object') {
    return { success: false, summary: null, error: 'محتوای فایل پشتیبان معتبر نیست.' };
  }

  loadState(true);

  let restoredInv = 0;
  let restoredRules = 0;
  let restoredCust = 0;

  // 1. Inventory restore
  if (Array.isArray(backupData.inventory)) {
    state.inventory = backupData.inventory;
    restoredInv = state.inventory.length;
  }

  // 2. User Rules restore
  if (Array.isArray(backupData.userRules)) {
    if (!state.config) state.config = {} as any;
    state.config.userRules = backupData.userRules;
    restoredRules = state.config.userRules.length;
  } else if (Array.isArray(backupData.config?.userRules)) {
    if (!state.config) state.config = {} as any;
    state.config.userRules = backupData.config.userRules;
    restoredRules = state.config.userRules.length;
  }

  // 3. Config restore (safely preserving sensitive token/userbot credentials if backup didn't specify them)
  if (backupData.config && typeof backupData.config === 'object') {
    const safeConfig = { ...backupData.config };
    if (!safeConfig.token && state.config.token) safeConfig.token = state.config.token;
    if (!safeConfig.userbotSession && state.config.userbotSession) {
      safeConfig.userbotSession = state.config.userbotSession;
      safeConfig.userbotApiId = state.config.userbotApiId;
      safeConfig.userbotApiHash = state.config.userbotApiHash;
    }
    state.config = { ...state.config, ...safeConfig };
  }

  // 4. Customers restore
  if (Array.isArray(backupData.customers)) {
    state.customers = backupData.customers;
    restoredCust = state.customers.length;
  }

  // 5. Groups restore
  if (Array.isArray(backupData.groups)) {
    state.groups = backupData.groups;
  }

  saveState();

  return {
    success: true,
    summary: {
      inventoryCount: restoredInv,
      userRulesCount: restoredRules,
      customersCount: restoredCust,
      backupTimestamp: backupData.backupTimestamp || backupData.backupDatePersian || 'نامشخص'
    }
  };
}

const groupMessageQueue: Array<() => Promise<void>> = [];
let isProcessingGroupQueue = false;

const processGroupQueue = async () => {
  if (isProcessingGroupQueue) return;
  isProcessingGroupQueue = true;
  while (groupMessageQueue.length > 0) {
    const task = groupMessageQueue.shift();
    if (task) {
      try {
        await task();
      } catch (err) {
        console.error("Error executing queued group message task:", err);
      }
      // Delay of 300ms protects against Telegram API rate limits (avoiding concurrent 429 when sending/forwarding in rapid succession)
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  isProcessingGroupQueue = false;
};

const enqueueGroupMessageTask = (task: () => Promise<void>) => {
  groupMessageQueue.push(task);
  processGroupQueue();
};

function isPurchaseRequest(rawText: string): boolean {
  const normText = rawText.toLowerCase().replace(/\u200c/g, ' ').trim();

  // Negative keywords (only absolute seller/automatic confirmations to avoid self-loops or admin confirmation logs)
  const sellerKeywords = [
    "فروخته شد",
    "ارسال شد",
    "فرستاده شد",
    "ثبت شد",
    "ثبت گردید",
    "تایید شد",
    "تایید گردید",
    "حواله شد",
    "واریز شد",
    "تموم شد",
    "تمام شد",
    "ناموجود"
  ];

  for (const kw of sellerKeywords) {
    if (normText.includes(kw)) {
      return false; // Identified as a seller confirmation/update
    }
  }

  return true;
}

let userbotClient: TelegramClient | null = null;

async function stopUserbot() {
  if (userbotClient) {
    try {
      await userbotClient.disconnect();
    } catch (e) {}
    userbotClient = null;
  }
}

async function startUserbot() {
  await stopUserbot();

  if (!state.config.userbotSession || !state.config.userbotApiId || !state.config.userbotApiHash) {
    return false;
  }

  if (state.config.userbotEnabled === false) {
    return false;
  }

  try {
    const session = new StringSession(state.config.userbotSession);
    const proxyConfig = getGramJsProxyConfig(state.config.proxyUrl);
    userbotClient = new TelegramClient(
      session,
      Number(state.config.userbotApiId),
      state.config.userbotApiHash,
      { 
        connectionRetries: 10,
        floodSleepThreshold: 60,
        autoReconnect: true,
        ...(proxyConfig ? { proxy: proxyConfig } : {})
      }
    );

    await userbotClient.connect();

    userbotClient.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        if (!message || !message.text) return;

        // Skip userbot functions if userbot is disabled
        if (state.config.userbotEnabled === false) return;

        // 1. Get chat details first
        let chat: any = null;
        try {
          chat = await message.getChat();
        } catch (e) {
          console.warn("getChat failed inside Userbot event handler, using peer details", e);
        }

        const chatIdObject = message.chatId || (chat ? chat.id : null);
        if (!chatIdObject) return;

        const chatId = String(chatIdObject);
        const chatTitle = chat ? (chat.title || "گروه") : "گروه تحت پایش سلف";
        const chatUsername = chat?.username ? String(chat.username) : "";

        // Skip if chat title indicates deleted, deactivated, or inactive group
        const lowerTitle = (chatTitle || "").toLowerCase();
        if (
          lowerTitle.includes("deleted account") || 
          lowerTitle.includes("deactivated") || 
          lowerTitle.includes("حذف شده") || 
          lowerTitle.includes("حذفی")
        ) {
          return; // Skip deleted/inactive groups
        }

        // Check if targeted to specific userbot groups (Watchlist)
        if (state.config.userbotGroups && state.config.userbotGroups.trim() !== "") {
          const watched = state.config.userbotGroups.split(",")
            .map(x => x.trim().toLowerCase())
            .filter(Boolean);
          if (watched.length > 0) {
            const normalizeId = (id: string) => id.trim().toLowerCase().replace(/^-100/, "").replace(/^-/, "");
            const normChatId = normalizeId(chatId);
            
            const cleanStringForMatch = (s: string) => {
              const normalized = normalizePersianArabicNumbers(s).toLowerCase();
              return normalized.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "");
            };
            const normChatTitle = cleanStringForMatch(chatTitle || "");

            const isMatch = watched.some(w => {
              const normW = normalizeId(w);
              
              // 1. Match by ID
              if (normChatId === normW) return true;
              
              // 2. Match by Username (ignores @ and is case-insensitive)
              if (chatUsername) {
                const cleanU = chatUsername.toLowerCase().replace(/^@/, "");
                const cleanW = w.replace(/^@/, "");
                if (cleanU === cleanW) return true;
              }

              // 3. Match by Group Title (ignores spaces, dots, and is case-insensitive)
              const normWTitle = cleanStringForMatch(w);
              if (normWTitle && (normChatTitle.includes(normWTitle) || normWTitle.includes(normChatTitle))) {
                return true;
              }

              return false;
            });

            if (!isMatch) return; // ignore unwatched chat
          }
        }

        // 2. Identify sender details
        const sender = await message.getSender().catch(() => null);
        const senderId = sender ? String(sender.id) : String(message.senderId || "");
        const senderFirstName = sender ? (sender.firstName || "") : "";
        const senderLastName = sender ? (sender.lastName || "") : "";
        const senderFullName = (senderFirstName + " " + senderLastName).trim();
        const senderUsername = sender ? (sender.username || "") : "";

        // 3. Check specific person rules (قوانین افراد خاص: VIP اطلاع‌رسانی اجباری یا بلاک‌لیست)
        const matchedUserRule = findMatchingUserRule(senderId, senderUsername, state.config.userRules);

        if (matchedUserRule) {
          // Rule Action A: NEVER_NOTIFY (نادیده گرفتن کامل پیام این شخص حتی در صورت وجود کالا)
          if (matchedUserRule.action === "NEVER_NOTIFY") {
            console.log(`[Userbot] Muted/Ignored message from ${senderId} (@${senderUsername}) per rule: ${matchedUserRule.name || matchedUserRule.target}`);
            return; // Completely drop this message
          }

          // Rule Action B: ALWAYS_NOTIFY (اطلاع‌رسانی تحت هر شرایطی - حتی اگر کالا در لیست انبار نباشد)
          if (matchedUserRule.action === "ALWAYS_NOTIFY") {
            console.log(`[Userbot] ALWAYS_NOTIFY triggered for ${senderId} (@${senderUsername}) per rule: ${matchedUserRule.name || matchedUserRule.target}`);
            
            const normalizedText = normalizePersianArabicNumbers(message.text);
            const matchedItems = state.inventory.filter(item => matchCodeInText(normalizedText, item.code));

            let vipNotifyMsg = `🌟 <b>اطلاع‌رسانی ویژه: پیام از شخص تحت پایش اختصاصی (VIP)!</b>\n\n`;
            if (matchedUserRule.name) {
              vipNotifyMsg += `🏷️ <b>عنوان قانون:</b> <code>${escapeHtml(matchedUserRule.name)}</code>\n`;
            }
            vipNotifyMsg += `👥 <b>مشخصات گروه:</b> ${escapeHtml(chatTitle)}\n`;
            vipNotifyMsg += `🆔 <b>آیدی گروه:</b> <code>${chatId}</code>\n\n`;

            vipNotifyMsg += `👤 <b>مشخصات فرستنده:</b>\n`;
            vipNotifyMsg += `🔹 نام: <a href="tg://user?id=${senderId}"><b>${escapeHtml(senderFullName || "ناشناس")}</b></a>\n`;
            vipNotifyMsg += `🔹 نام کاربری: <a href="tg://user?id=${senderId}">${senderUsername ? `@${escapeHtml(senderUsername)}` : "بدون‌یوزرنیم"}</a>\n`;
            vipNotifyMsg += `🆔 <b>آیدی عددی:</b> <a href="tg://user?id=${senderId}"><code>${senderId}</code></a>\n\n`;

            if (matchedItems.length > 0) {
              vipNotifyMsg += `📦 <b>کالاهای تطبیق‌یافته در انبار:</b>\n\n`;
              for (const item of matchedItems) {
                if (!state.customers) state.customers = [];
                state.customers.push({
                  userId: senderId,
                  username: senderUsername || "بدون‌نام",
                  chatId: chatId,
                  chatTitle: chatTitle,
                  itemCode: String(item.code),
                  itemName: String(item.name),
                  date: new Date().toISOString()
                });

                vipNotifyMsg += `✅ <b>کد محصول:</b> <code>${escapeHtml(item.code)}</code>\n`;
                vipNotifyMsg += `🔸 <b>نام محصول:</b> ${escapeHtml(item.name)}\n`;
                vipNotifyMsg += `🔢 <b>موجودی در انبار:</b> <b>${escapeHtml(String(item.stock))}</b>\n\n`;
              }
            } else {
              vipNotifyMsg += `ℹ️ <i>کدهای پیام در انبار شما نبود، ولی طبق قانون شخص ویژه (Always Notify) برای شما ارسال شد.</i>\n\n`;
            }

            vipNotifyMsg += `📝 <b>متن کامل پیام فرستنده:</b>\n« ${escapeHtml(message.text)} »\n\n`;
            saveState();

            let notifiedAdminByBot = false;
            if (bot && state.config.adminId) {
              try {
                await bot.telegram.sendMessage(state.config.adminId, vipNotifyMsg, { parse_mode: 'HTML' });
                notifiedAdminByBot = true;
              } catch (notifyErr) {
                console.error("Failed to notify admin via main Bot:", notifyErr);
              }
            }

            // Fallback: Notify admin directly via Userbot PV
            if (!notifiedAdminByBot && state.config.adminId && userbotClient) {
              try {
                const target = (botMe && botMe.username) ? botMe.username : state.config.adminId;
                await userbotClient.sendMessage(target, {
                  message: vipNotifyMsg,
                  parseMode: 'html'
                });
              } catch (uErr) {
                console.error("Failed to notify admin via Userbot client:", uErr);
              }
            }

            // Forward original message to admin for full context (if not explicitly disabled in rule)
            if (matchedUserRule.forwardMessage !== false && state.config.adminId && userbotClient) {
              try {
                const forwardTarget = (botMe && botMe.username) ? botMe.username : state.config.adminId;
                await userbotClient.forwardMessages(forwardTarget, {
                  messages: [message.id],
                  fromPeer: chatIdObject
                });
              } catch (forwardErr) {
                console.error("Failed userbot message forwarding to admin:", forwardErr);
              }
            }

            return; // Finished handling VIP rule!
          }
        }

        // 4. Standard Message Processing (Check purchase intent and inventory items)
        if (!isPurchaseRequest(message.text)) return;

        const normalizedText = normalizePersianArabicNumbers(message.text);
        const matchedItems = state.inventory.filter(item => matchCodeInText(normalizedText, item.code));
        if (matchedItems.length === 0) return;

        const foundItems = matchedItems;

        if (foundItems.length > 0) {
          let adminNotifyMsg = `📥 <b>ثبت درخواست خرید جدید از طریق ربات کاربر (سلف)!</b>\n\n`;
          adminNotifyMsg += `👥 <b>مشخصات گروه:</b> ${escapeHtml(chatTitle)}\n`;
          adminNotifyMsg += `🆔 <b>آیدی گروه:</b> <code>${chatId}</code>\n\n`;

          adminNotifyMsg += `👤 <b>مشخصات خریدار:</b>\n`;
          adminNotifyMsg += `🔹 نام: <a href="tg://user?id=${senderId}"><b>${escapeHtml((senderFirstName + " " + senderLastName).trim() || "ناشناس")}</b></a>\n`;
          adminNotifyMsg += `🔹 نام کاربری: <a href="tg://user?id=${senderId}">${senderUsername ? `@${escapeHtml(senderUsername)}` : "بدون‌یوزرنیم"}</a>\n`;
          adminNotifyMsg += `🆔 <b>آیدی عددی خریدار:</b> <a href="tg://user?id=${senderId}"><code>${senderId}</code></a>\n\n`;
          adminNotifyMsg += `📦 <b>کالاهای اسکن‌شده:</b> \n\n`;

          let hasAvailable = false;
          for (const item of foundItems) {
            if (Number(item.stock) > 0) {
              hasAvailable = true;

              if (!state.customers) state.customers = [];
              state.customers.push({
                 userId: senderId,
                 username: senderUsername || "بدون‌نام",
                 chatId: chatId,
                 chatTitle: chatTitle,
                 itemCode: String(item.code),
                 itemName: String(item.name),
                 date: new Date().toISOString()
              });

              adminNotifyMsg += `✅ <b>کد محصول:</b> <code>${escapeHtml(item.code)}</code>\n`;
              adminNotifyMsg += `🔸 <b>نام محصول:</b> ${escapeHtml(item.name)}\n`;
              adminNotifyMsg += `🔢 <b>موجودی در انبار:</b> <b>${escapeHtml(String(item.stock))}</b>\n\n`;

              // Send private alert template to customer
              if (state.config.disableCustomerPm !== true && senderId) {
                let pmText = state.config.customerMessage && state.config.customerMessage.trim() !== ""
                  ? state.config.customerMessage
                  : `سلام دوست گرامی، درخواست شما برای خرید کالای «<b>{name}</b>» با کد «<b>{code}</b>» با موفقیت ثبت شد.\nمدیریت ربات به زودی برای هماهنگی‌های لازم با شما ارتباط می‌گیرد.🌸`;
                pmText = pmText.replace(/{code}/g, item.code).replace(/{name}/g, item.name);

                let customerNotifiedByBot = false;
                if (bot) {
                  try {
                    await bot.telegram.sendMessage(senderId, pmText, { parse_mode: 'HTML' });
                    customerNotifiedByBot = true;
                  } catch (e) {
                    console.warn(`Main bot failed to PM client ${senderId}. Trying via Userbot...`, e);
                  }
                }

                if (!customerNotifiedByBot && userbotClient) {
                  try {
                    await userbotClient.sendMessage(senderId, { message: pmText, parseMode: 'html' });
                  } catch (ue) {
                    console.error("Userbot failed to PM client:", ue);
                  }
                }
              }
            }
          }

          if (hasAvailable) {
            saveState();
            adminNotifyMsg += `📝 <b>متن پیام خریدار:</b>\n« ${escapeHtml(message.text)} »\n\n`;

            let notifiedAdminByBot = false;
            if (bot && state.config.adminId) {
              try {
                await bot.telegram.sendMessage(state.config.adminId, adminNotifyMsg, { parse_mode: 'HTML' });
                notifiedAdminByBot = true;
              } catch (notifyErr) {
                console.error("Failed to notify admin via main Bot:", notifyErr);
              }
            }

            // Fallback: Notify admin directly via Userbot PV!
            if (!notifiedAdminByBot && state.config.adminId && userbotClient) {
              try {
                const target = (botMe && botMe.username) ? botMe.username : state.config.adminId;
                await userbotClient.sendMessage(target, {
                  message: adminNotifyMsg,
                  parseMode: 'html'
                });
              } catch (uErr) {
                console.error("Failed to notify admin via Userbot client:", uErr);
              }
            }

            // Forward the original post to admin for context
            if (state.config.adminId && userbotClient) {
              try {
                const forwardTarget = (botMe && botMe.username) ? botMe.username : state.config.adminId;
                await userbotClient.forwardMessages(forwardTarget, {
                  messages: [message.id],
                  fromPeer: chatIdObject
                });
              } catch (forwardErr) {
                console.error("Failed userbot message forwarding to admin:", forwardErr);
              }
            }
          }
        }
      } catch (evtErr) {
        console.error("Error inside Userbot message handler", evtErr);
      }
    }, new NewMessage({}));

    console.log("🚀 Userbot successfully connected and listening to target groups.");
    return true;
  } catch (err) {
    console.error("Failed to start Userbot client", err);
    return false;
  }
}

const showInventoryPage = async (ctx: any, page: number, isEdit = false) => {
  const itemsPerPage = 10;
  const totalItems = state.inventory.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  
  const startIdx = safePage * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const items = state.inventory.slice(startIdx, endIdx);

  if (items.length === 0) {
    const emptyMsg = "📦 لیست کالاها خالی است.";
    if (isEdit) {
      return ctx.editMessageText(emptyMsg).catch(() => {});
    }
    return ctx.reply(emptyMsg);
  }

  let text = `📦 *لیست کالاهای موجود* (صفحه ${safePage + 1} از ${totalPages})\n\n`;
  const buttons: any[][] = [];

  items.forEach((item) => {
    text += `🔹 *کد:* \`${item.code}\`\n`;
    text += `📝 *نام:* ${item.name}\n`;
    text += `📦 *موجودی:* ${item.stock}\n\n`;
    
    // Add inline buttons for this item with style fields (Telegram Bot API 9.4+)
    buttons.push([
      { text: `🗑️ حذف ${item.code}`, callback_data: `inv_del_${item.code}`, style: 'danger' },
      { text: `✏️ ویرایش ${item.code}`, callback_data: `inv_edit_${item.code}`, style: 'primary' },
      { text: `➕ موجودی ${item.code}`, callback_data: `inv_addstock_${item.code}`, style: 'success' }
    ]);
  });

  // Pagination row
  const paginationRow = [];
  if (safePage > 0) {
    paginationRow.push({ text: "◀️ صفحه قبلی", callback_data: `inv_page_${safePage - 1}`, style: 'primary' });
  }
  if (safePage < totalPages - 1) {
    paginationRow.push({ text: "صفحه بعدی ▶️", callback_data: `inv_page_${safePage + 1}`, style: 'primary' });
  }
  if (paginationRow.length > 0) {
    buttons.push(paginationRow);
  }

  // Add Search Button
  buttons.push([{ text: "🔍 جستجوی سریع کالا", callback_data: "action_search_product", style: 'primary' }]);

  const replyOptions = {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  };

  if (isEdit) {
    try {
      await ctx.editMessageText(text, replyOptions);
    } catch (err: any) {
      if (!err.message?.includes('message is not modified')) {
        console.error(err);
      }
    }
  } else {
    await ctx.reply(text, replyOptions);
  }
};

async function startBot() {
  if (bot) {
    try {
      bot.stop();
    } catch (e) {}
  }

  if (!state.config.token || !state.config.adminId) {
    state.isRunning = false;
    saveState();
    return false;
  }

  try {
    const agent = getTelegrafProxyAgent(state.config.proxyUrl);
    bot = new Telegraf(state.config.token, agent ? { telegram: { agent } } : undefined);

    // Middleware to hot-reload state on every bot request to stay synced across processes
    bot.use(async (ctx: any, next: any) => {
      loadState();
      return await next();
    });

    // Retrieve bot details and configure command list (Menu button next to chat box)
    try {
      botMe = await bot.telegram.getMe();
      
      // Clear global commands for everyone
      await bot.telegram.setMyCommands([]);
      
      // Set commands specifically only in the private chat scopes so they don't show up in groups
      const adminCommands = [
        { command: 'start', description: '🏠 شروع و پنل مدیریت' },
        { command: 'settings', description: '⚙️ تنظیمات ربات' },
        { command: 'rules', description: '👥 اشخاص و قوانین مانیتورینگ' },
        { command: 'backup', description: '💾 پشتیبان‌گیری و بازگردانی' },
        { command: 'add', description: '➕ افزودن دستی کالا' },
        { command: 'delete', description: '🗑️ حذف دستی کالا' },
        { command: 'setmsg', description: '📝 تغییر پیام خریدار' },
        { command: 'help', description: '💡 راهنمای کامل' }
      ];
      
      await bot.telegram.setMyCommands(adminCommands, { scope: { type: 'all_private_chats' } });
      
      console.log(`Bot @${botMe.username} is connected.`);
    } catch (cmdErr) {
      console.error("Failed to get bot details or set commands menu", cmdErr);
    }

    // Helper to render Settings Keyboard
    const showAdminSettingsKeyboard = async (ctx: any, isEdit = false) => {
      const isScanOn = state.config.botEnabled !== false;
      const isPmEnabled = !state.config.disableCustomerPm;
      const isUserbotOn = state.config.userbotEnabled !== false && !!state.config.userbotSession;
      const isTargetGroupOnly = state.config.groupAccess === 'admin';
      const rulesCount = (state.config.userRules || []).length;
      const inventoryCount = (state.inventory || []).length;
      
      let msg = `⚙️ *پنل تنظیمات و پیکربندی ربات مانیتورینگ:*\n\n`;
      msg += `🤖 *وضعیت اسکن و پایش کدها:* ${isScanOn ? "🟢 *روشن (فعال)*" : "🔴 *خاموش (غیرفعال)*"}\n`;
      msg += `💬 *ارسال پیام به خریدار در پی‌وی:* ${isPmEnabled ? "🟢 *فعال*" : "🔴 *غیرفعال (فقط اطلاع به ادمین)*"}\n`;
      msg += `👤 *سلف‌بات (حساب شخصی):* ${isUserbotOn ? "🟢 *متصل و فعال*" : "⚪ *غیرفعال یا متصل‌نشده*"}\n`;
      msg += `🔒 *حوزه پایش گروه‌ها:* ${isTargetGroupOnly ? "🔒 *فقط گروه هدف*" : "🌐 *همه گروه‌های عضو*"}\n`;
      msg += `👥 *تعداد قوانین اشخاص (VIP/بلاک):* *${rulesCount} شخص*\n`;
      msg += `📦 *تعداد اقلام موجود در انبار:* *${inventoryCount} کالا*\n\n`;
      
      const currentMsg = state.config.customerMessage && state.config.customerMessage.trim() !== ""
        ? state.config.customerMessage
        : `سلام دوست گرامی، درخواست شما برای خرید کالای «*{name}*» با کد «*{code}*» با موفقیت ثبت شد.\nمدیریت ربات به زودی برای هماهنگی‌های لازم با شما ارتباط می‌گیرد.🌸`;
      
      msg += `📝 *قالب پیام ارسالی به خریدار:*\n_${currentMsg}_\n\n`;
      msg += `💡 *جهت تغییر وضعیت‌ها، از دکمه‌های شیشه‌ای زیر استفاده کنید:*`;

      const keyboard = [
        [
          {
            text: `${isScanOn ? "🟢 پایش کدها: روشن" : "🔴 پایش کدها: خاموش"}`,
            callback_data: "toggle_scan",
            style: isScanOn ? "success" : "danger"
          },
          {
            text: `${isPmEnabled ? "🟢 ارسال پیام خریدار: فعال" : "🔴 پیام خریدار: غیرفعال"}`,
            callback_data: "toggle_pm",
            style: isPmEnabled ? "success" : "danger"
          }
        ],
        [
          {
            text: `${isTargetGroupOnly ? "🔒 حوزه: فقط گروه هدف" : "🌐 حوزه: تمام گروه‌ها"}`,
            callback_data: "toggle_grp_access",
            style: "primary"
          },
          {
            text: "✍️ ویرایش متن پیام خریدار",
            callback_data: "edit_msg_template",
            style: "primary"
          }
        ],
        [
          {
            text: `👥 مدیریت اشخاص و قوانین (${rulesCount})`,
            callback_data: "menu_rules",
            style: "primary"
          },
          {
            text: "💾 پشتیبان‌گیری و بازگردانی",
            callback_data: "menu_backups",
            style: "primary"
          }
        ],
        [
          {
            text: "📦 مشاهده و مدیریت انبار",
            callback_data: "menu_inventory",
            style: "primary"
          },
          {
            text: "🔄 بروزرسانی وضعیت",
            callback_data: "refresh_settings",
            style: "primary"
          }
        ]
      ];

      if (isEdit) {
        try {
          return await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        } catch (e: any) {
          if (!e.message?.includes('message is not modified')) {
            return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
          }
        }
      } else {
        return ctx.replyWithMarkdown(msg, { reply_markup: { inline_keyboard: keyboard } });
      }
    };

    // Helper to render Rules Menu with Glass Buttons
    const showRulesMenu = async (ctx: any, page = 0, filter: 'ALL' | 'ALWAYS_NOTIFY' | 'NEVER_NOTIFY' = 'ALL', isEdit = false) => {
      const allRules = state.config.userRules || [];
      const vipCount = allRules.filter(r => r.action === 'ALWAYS_NOTIFY').length;
      const blockedCount = allRules.filter(r => r.action === 'NEVER_NOTIFY').length;

      const filtered = allRules.filter(r => {
        if (filter === 'ALL') return true;
        return r.action === filter;
      });

      const itemsPerPage = 5;
      const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
      const safePage = Math.max(0, Math.min(page, totalPages - 1));
      const pageItems = filtered.slice(safePage * itemsPerPage, (safePage + 1) * itemsPerPage);

      let msg = `👥 *مدیریت و فیلتر هوشمند اشخاص خاص (سلف‌بات و ربات):*\n\n`;
      msg += `📊 *آمار اشخاص:* کل: *${allRules.length}* | 🌟 ویژه (VIP): *${vipCount}* | 🚫 بلاک: *${blockedCount}*\n`;
      msg += `🔍 *فیلتر فعلی:* ${filter === 'ALL' ? 'همه اشخاص' : filter === 'ALWAYS_NOTIFY' ? '🌟 فقط VIP' : '🚫 فقط بلاک‌شده'}\n\n`;

      if (filtered.length === 0) {
        msg += `_هیچ قانونی در این لیست وجود ندارد._\n\nبرای تعریف شخص جدید روی دکمه «➕ افزودن شخص خاص جدید» بزنید.`;
      } else {
        pageItems.forEach((r, idx) => {
          const itemNum = safePage * itemsPerPage + idx + 1;
          const isVip = r.action === 'ALWAYS_NOTIFY';
          const actionText = isVip ? '🌟 VIP (اطلاع‌رسانی اجباری)' : '🚫 بلاک‌لیست (نادیده‌گیری کامل)';
          const statusText = r.enabled !== false ? '🟢 فعال' : '⚪ غیرفعال';
          msg += `*${itemNum}.* \`${r.target}\` ${r.name ? `(${r.name})` : ''}\n`;
          msg += `   ⚙️ *نوع:* ${actionText}\n`;
          msg += `   📊 *وضعیت:* ${statusText}\n\n`;
        });
      }

      const buttons: any[][] = [];

      // Per-item action buttons
      pageItems.forEach(r => {
        const isVip = r.action === 'ALWAYS_NOTIFY';
        const isEnabled = r.enabled !== false;
        buttons.push([
          {
            text: `${isEnabled ? '⏸️ غیرفعال' : '▶️ فعال'}`,
            callback_data: `rule_toggle_${r.id}`,
            style: isEnabled ? 'primary' : 'success'
          },
          {
            text: `${isVip ? '🔄 تغییر به بلاک' : '🔄 تغییر به VIP'}`,
            callback_data: `rule_switch_${r.id}`,
            style: 'primary'
          },
          {
            text: `🗑️ حذف`,
            callback_data: `rule_del_${r.id}`,
            style: 'danger'
          }
        ]);
      });

      // Pagination
      if (totalPages > 1) {
        const pagRow = [];
        if (safePage > 0) {
          pagRow.push({ text: "◀️ قبلی", callback_data: `rule_page_${safePage - 1}_${filter}`, style: 'primary' });
        }
        pagRow.push({ text: `صفحه ${safePage + 1} از ${totalPages}`, callback_data: "rule_noop", style: 'primary' });
        if (safePage < totalPages - 1) {
          pagRow.push({ text: "بعدی ▶️", callback_data: `rule_page_${safePage + 1}_${filter}`, style: 'primary' });
        }
        buttons.push(pagRow);
      }

      // Filter switch row
      buttons.push([
        { text: `${filter === 'ALL' ? '🔘 همه' : 'همه'}`, callback_data: "rule_filter_ALL", style: filter === 'ALL' ? 'primary' : 'secondary' },
        { text: `${filter === 'ALWAYS_NOTIFY' ? '🔘 🌟 فقط VIP' : '🌟 فقط VIP'}`, callback_data: "rule_filter_ALWAYS_NOTIFY", style: filter === 'ALWAYS_NOTIFY' ? 'primary' : 'secondary' },
        { text: `${filter === 'NEVER_NOTIFY' ? '🔘 🚫 فقط بلاک' : '🚫 فقط بلاک'}`, callback_data: "rule_filter_NEVER_NOTIFY", style: filter === 'NEVER_NOTIFY' ? 'primary' : 'secondary' }
      ]);

      // Add New Rule & Back buttons
      buttons.push([
        { text: "➕ افزودن شخص خاص جدید", callback_data: "rule_wizard_start", style: "success" }
      ]);
      buttons.push([
        { text: "⚙️ بازگشت به تنظیمات", callback_data: "menu_settings", style: "primary" },
        { text: "💾 پشتیبان‌گیری", callback_data: "menu_backups", style: "primary" }
      ]);

      if (isEdit) {
        try {
          return await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
        } catch (e: any) {
          if (!e.message?.includes('message is not modified')) {
            return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
          }
        }
      } else {
        return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
      }
    };

    // Helper to render Backup & Restore Menu with Glass Buttons
    const showBackupMenu = async (ctx: any, isEdit = false) => {
      const invCount = (state.inventory || []).length;
      const rulesCount = (state.config.userRules || []).length;
      const custCount = (state.customers || []).length;
      const groupsCount = (state.groups || []).length;

      let msg = `💾 *مدیریت جامع پشتیبان‌گیری و بازگردانی (Backup & Restore):*\n\n`;
      msg += `📦 *موجودی انبار:* *${invCount} کالا*\n`;
      msg += `👥 *قوانین اشخاص (VIP/بلاک):* *${rulesCount} شخص*\n`;
      msg += `📋 *سوابق تقاضای مشتریان:* *${custCount} مورد*\n`;
      msg += `👥 *گروه‌های ثبت‌شده:* *${groupsCount} گروه*\n\n`;
      msg += `✨ *قابلیت‌ها:*\n`;
      msg += `• *پشتیبان کامل JSON (زمان‌دار):* حاوی ۱۰۰٪ اطلاعات (انبار + اشخاص + کانفیگ + مشتریان) با قابلیت بازگردانی آنی.\n`;
      msg += `• *پشتیبان اکسل (Excel):* شامل شیت‌های مجزا برای مشاهده در نرم‌افزار اکسل.\n`;
      msg += `• *بازگردانی (Restore):* کافیست هر زمان فایل پشتیبان \`.json\` یا \`.xlsx\` را مستقیماً همینجا در چت بفرستید تا فوراً بازیابی شود!\n\n`;
      msg += `👇 *یک گزینه را انتخاب کنید:*`;

      const keyboard = [
        [
          { text: "📥 دریافت پشتیبان کامل JSON (زمان‌دار)", callback_data: "backup_json_download", style: "success" }
        ],
        [
          { text: "📥 دریافت پشتیبان اکسل (Excel)", callback_data: "backup_excel_download", style: "primary" }
        ],
        [
          { text: "📤 راهنمای بازگردانی فایل (Restore)", callback_data: "backup_restore_guide", style: "primary" }
        ],
        [
          { text: "⚙️ تنظیمات ربات", callback_data: "menu_settings", style: "primary" },
          { text: "👥 مدیریت اشخاص", callback_data: "menu_rules", style: "primary" }
        ]
      ];

      if (isEdit) {
        try {
          return await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        } catch (e: any) {
          if (!e.message?.includes('message is not modified')) {
            return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
          }
        }
      } else {
        return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
      }
    };

    // Command handle /start
    bot.command('start', (ctx: any) => {
      if (ctx.chat.type === "private") {
        if (isAdmin(ctx)) {
          ctx.reply(
            "سلام مدیر محترم! 🌹\n" +
            "به بخش کنترل انبار، اشخاص و مانیتورینگ ربات خوش آمدید.\n\n" +
            "📌 برای مدیریت آسان و سریع، می‌توانید از دکمه‌های منوی شیشه‌ای یا دکمه‌های کیبورد پایین صفحه استفاده کنید:\n\n" +
            "👥 *۱. مدیریت اشخاص خاص (VIP / بلاک‌لیست):*\n" +
            "تعریف افرادی که پیام‌هایشان حتی بدون تطابق کالا فوروارد شود یا کلاً نادیده گرفته شود.\n\n" +
            "💾 *۲. پشتیبان‌گیری و بازگردانی هوشمند:*\n" +
            "دریافت فایل زمان‌دار JSON و اکسل کامل شامل انبار و اشخاص و بازیابی سریع با ارسال فایل.\n\n" +
            "📦 *۳. انبار و محصولات:*\n" +
            "ثبت دستی کالا یا ارسال مستقیم فایل اکسل `.xlsx` جهت جایگزینی موجودی انبار.\n\n" +
            "⚙️ *۴. تنظیمات و پیکربندی:*\n" +
            "روشن/خاموش کردن پایش، ارسال پیام، قالب پیام و فیلتر گروه‌ها.",
            {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [
                  [
                    "👥 مدیریت اشخاص و VIP",
                    "⚙️ تنظیمات ربات"
                  ],
                  [
                    "✍️ ثبت و ویرایش دستی کالا",
                    "📦 لیست کالاهای موجود"
                  ],
                  [
                    "🔎 جستجوی کالا",
                    "🗑️ حذف دستی کالا"
                  ],
                  [
                    "💾 پشتیبان‌گیری و بازگردانی",
                    "📤 آپلود موجودی انبار (اکسل)"
                  ],
                  [
                    "💡 راهنمای کامل"
                  ]
                ],
                resize_keyboard: true
              }
            }
          );
          // Show interactive settings keyboard
          setTimeout(() => {
            showAdminSettingsKeyboard(ctx);
          }, 300);
        } else {
          ctx.reply(`سلام گرامی! خوش آمدید. 🌸\nشما امکان دسترسی به پنل مدیریتی این ربات را ندارید. ربات در گروه‌های کاری تنظیم‌شده فعال است و کدهای کالا را پایش می‌نماید.`);
        }
      }
    });

    // Custom Button Listeners for Admin Reply Keyboard
    bot.hears(/👥.*(اشخاص|قوانین|VIP)/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showRulesMenu(ctx, 0, 'ALL');
      }
    });

    bot.hears(/💾.*(پشتیبان|بکاپ)/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showBackupMenu(ctx);
      }
    });

    bot.hears(/⚙️.*تنظیمات/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showAdminSettingsKeyboard(ctx);
      }
    });

    bot.hears(/✍️.*ثبت و ویرایش دستی کالا/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        ctx.reply(
          "👇 جهت افزودن یا ویرایش دستی کالا از طریق دکمه زیر اقدام کنید:",
          Markup.inlineKeyboard([
            [Markup.button.callback("➕ افزودن/ویرایش کالا", "start_add_product")]
          ])
        );
      }
    });

    bot.action("start_add_product", async (ctx: any) => {
      if (isAdmin(ctx)) {
        adminSessions[ctx.from.id] = { step: 'awaiting_product_code', data: {} };
        await ctx.answerCbQuery();
        await ctx.editMessageText("📝 لطفاً **کد کالا** را ارسال کنید:\n\n(برای انصراف از دکمه زیر استفاده کنید)", {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]]
          }
        });
      }
    });

    bot.action("cancel_add_product", async (ctx: any) => {
      if (isAdmin(ctx)) {
        delete adminSessions[ctx.from.id];
        await ctx.answerCbQuery("عملیات لغو شد.");
        await ctx.editMessageText("❌ عملیات جاری لغو شد.");
      }
    });

    bot.hears(/🗑️.*حذف دستی کالا/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        adminSessions[ctx.from.id] = { step: 'awaiting_delete_search', data: {} };
        ctx.reply("🗑️ لطفاً **نام** یا **کد** کالا را برای حذف ارسال کنید:", {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]]
          }
        });
      }
    });

    bot.hears(/📦.*لیست کالاهای موجود/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showInventoryPage(ctx, 0);
      }
    });

    bot.hears(/🔎.*جستجوی کالا/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        adminSessions[ctx.from.id] = { step: 'awaiting_search_query', data: {} };
        ctx.reply("🔎 لطفاً **کد** یا **نام** کالا را برای جستجو وارد کنید:\n\n(برای انصراف از دکمه زیر استفاده کنید)", {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]] }
        });
      }
    });

    bot.action("action_search_product", async (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        adminSessions[ctx.from.id] = { step: 'awaiting_search_query', data: {} };
        await ctx.answerCbQuery();
        ctx.reply("🔎 لطفاً **کد** یا **نام** کالا را برای جستجو وارد کنید:\n\n(برای انصراف از دکمه زیر استفاده کنید)", {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]] }
        });
      } else {
        await ctx.answerCbQuery("❌ شما دسترسی ندارید.", { show_alert: true }).catch(() => {});
      }
    });

    bot.action(/^inv_page_(\d+)$/, (ctx: any) => {
      if (isAdmin(ctx)) {
        const page = parseInt(ctx.match[1], 10);
        showInventoryPage(ctx, page, true);
      }
    });

    bot.action(/^inv_del_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const code = ctx.match[1];
        const querySanitized = sanitizeCode(code);
        const existingItems = state.inventory.filter(item => {
          return item.code === code || sanitizeCode(item.code) === querySanitized || sanitizeCode(item.name) === querySanitized;
        });
        if (existingItems.length > 0) {
          state.inventory = state.inventory.filter(item => !existingItems.includes(item));
          saveState();
          await ctx.answerCbQuery(`✅ کالا (${code}) با موفقیت حذف شد.`, { show_alert: true });
          
          const pageStr = ctx.callbackQuery.message?.reply_markup?.inline_keyboard?.flat()?.find((b: any) => b.callback_data?.startsWith('inv_page_'))?.callback_data?.split('_')[2];
          const page = pageStr ? parseInt(pageStr, 10) : 0;
          showInventoryPage(ctx, page, true);
        } else {
          await ctx.answerCbQuery(`❌ کالا با مشخصات ${code} یافت نشد.`, { show_alert: true });
        }
      }
    });

    bot.action(/^inv_edit_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const code = ctx.match[1];
        adminSessions[ctx.from.id] = { step: 'awaiting_product_name', data: { code: code } };
        await ctx.answerCbQuery();
        ctx.reply(`✍️ ویرایش کالای ${code}\n\nلطفاً **نام جدید کالا** را وارد کنید:`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]] }
        });
      }
    });

    bot.action(/^inv_addstock_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const code = ctx.match[1];
        adminSessions[ctx.from.id] = { step: 'awaiting_add_stock', data: { code: code } };
        await ctx.answerCbQuery();
        ctx.reply(`➕ تغییر موجودی کالای ${code}\n\nلطفاً **تعداد موجودی جدید** را به صورت عدد وارد کنید:`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]] }
        });
      }
    });

    bot.hears(/📤.*آپلود موجودی انبار/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        ctx.replyWithMarkdown(
          "📤 *بارگذاری دسته‌جمعی لیست کالاها از اکسل:*\n\n" +
          "شما می‌توانید یک فایل اکسل با فرمت `.xlsx` که شامل حداقل سه ستون `کد`، `نام` و `موجودی` است را مستقیماً همینجا در بات ارسال کنید تا موجودی انبار بلافاصله بروز و جایگزین شود.\n\n" +
          "همین حالا می‌توانید فایل اکسل خود را بفرستید. 📎👇"
        );
      }
    });

    bot.hears(/💡.*راهنمای کامل/i, (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        ctx.reply(
          "💡 *راهنمای کامل سیستم پایش هوشمند انبار و اشخاص:*\n\n" +
          "۱. *پایش خودکار کالاها:* ربات و سلف‌بات پیام‌های گروه‌ها را برای پیدا کردن کد کالاهای انبار اسکن می‌کنند.\n" +
          "۲. *پایش اشخاص خاص (VIP):* با ثبت شخص در لیست VIP، تمام پیام‌های او حتی بدون تطابق کد کالا با فوروارد به پی‌وی شما می‌رسد.\n" +
          "۳. *لیست سیاه اشخاص (بلاک):* پیام‌های این اشخاص کلاً نادیده گرفته می‌شود.\n" +
          "۴. *پشتیبان‌گیری هوشمند (JSON/Excel):* فایل زمان‌دار JSON حاوی تمام انبار و اشخاص را دریافت و با ارسال مجدد فایل در چت، بازگردانی (Restore) کنید.\n" +
          "۵. *پروکسی و اتصال:* قابلیت کار با تمام نرم‌افزارهای فیلترشکن و سرورهای مختلف.",
          { parse_mode: 'Markdown' }
        );
      }
    });

    // Commands & Action Menu Routing
    bot.command("settings", (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showAdminSettingsKeyboard(ctx);
      }
    });

    bot.command(['rules', 'vip', 'targets'], (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showRulesMenu(ctx, 0, 'ALL');
      }
    });

    bot.command(['backup', 'export'], (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        showBackupMenu(ctx);
      }
    });

    bot.action("menu_settings", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery();
        showAdminSettingsKeyboard(ctx, true);
      }
    });

    bot.action("menu_rules", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery();
        showRulesMenu(ctx, 0, 'ALL', true);
      }
    });

    bot.action("menu_backups", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery();
        showBackupMenu(ctx, true);
      }
    });

    bot.action("menu_inventory", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery();
        showInventoryPage(ctx, 0, true);
      }
    });

    bot.action("refresh_settings", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery("اطلاعات بروز شد.");
        showAdminSettingsKeyboard(ctx, true);
      }
    });

    bot.action("rule_noop", async (ctx: any) => {
      await ctx.answerCbQuery();
    });

    bot.action(/^rule_page_(\d+)_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const page = parseInt(ctx.match[1], 10);
        const filter = ctx.match[2] as any;
        await ctx.answerCbQuery();
        showRulesMenu(ctx, page, filter, true);
      }
    });

    bot.action(/^rule_filter_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const filter = ctx.match[1] as any;
        await ctx.answerCbQuery();
        showRulesMenu(ctx, 0, filter, true);
      }
    });

    // Rule toggle action
    bot.action(/^rule_toggle_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const ruleId = ctx.match[1];
        if (!state.config.userRules) state.config.userRules = [];
        const rule = state.config.userRules.find(r => r.id === ruleId);
        if (rule) {
          rule.enabled = rule.enabled === false ? true : false;
          saveState();
          await ctx.answerCbQuery(`وضعیت قانون به ${rule.enabled ? '🟢 فعال' : '⚪ غیرفعال'} تغییر یافت.`);
          showRulesMenu(ctx, 0, 'ALL', true);
        } else {
          await ctx.answerCbQuery("قانون یافت نشد.");
        }
      }
    });

    // Rule switch action (Toggle between ALWAYS_NOTIFY and NEVER_NOTIFY)
    bot.action(/^rule_switch_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const ruleId = ctx.match[1];
        if (!state.config.userRules) state.config.userRules = [];
        const rule = state.config.userRules.find(r => r.id === ruleId);
        if (rule) {
          rule.action = rule.action === 'ALWAYS_NOTIFY' ? 'NEVER_NOTIFY' : 'ALWAYS_NOTIFY';
          saveState();
          const label = rule.action === 'ALWAYS_NOTIFY' ? '🌟 ویژه (VIP)' : '🚫 بلاک‌لیست';
          await ctx.answerCbQuery(`نوع قانون به «${label}» تغییر یافت.`);
          showRulesMenu(ctx, 0, 'ALL', true);
        } else {
          await ctx.answerCbQuery("قانون یافت نشد.");
        }
      }
    });

    // Rule delete action
    bot.action(/^rule_del_(.+)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const ruleId = ctx.match[1];
        if (!state.config.userRules) state.config.userRules = [];
        state.config.userRules = state.config.userRules.filter(r => r.id !== ruleId);
        saveState();
        await ctx.answerCbQuery("🗑️ قانون با موفقیت حذف شد.");
        showRulesMenu(ctx, 0, 'ALL', true);
      }
    });

    // Add Rule Wizard (Glass Buttons + Chat Session)
    bot.action("rule_wizard_start", async (ctx: any) => {
      if (isAdmin(ctx)) {
        adminSessions[ctx.from.id] = { step: 'awaiting_rule_target', data: {} };
        await ctx.answerCbQuery();
        await ctx.editMessageText(
          "➕ *افزودن شخص خاص به مانیتورینگ (مرحله ۱ از ۳):*\n\n" +
          "لطفاً **آیدی عددی** (User ID) یا **نام کاربری** (@username) شخص را ارسال کنید:\n\n" +
          "💡 مثال: `123456789` یا `@partner_user`",
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ انصراف", callback_data: "rule_wizard_cancel", style: "danger" }]
              ]
            }
          }
        );
      }
    });

    bot.action("rule_wizard_cancel", async (ctx: any) => {
      if (isAdmin(ctx)) {
        delete adminSessions[ctx.from.id];
        await ctx.answerCbQuery("عملیات لغو شد.");
        showRulesMenu(ctx, 0, 'ALL', true);
      }
    });

    bot.action(/^rule_set_type_(vip|never)$/, async (ctx: any) => {
      if (isAdmin(ctx)) {
        const session = adminSessions[ctx.from.id];
        if (!session || session.step !== 'awaiting_rule_action') {
          return ctx.answerCbQuery("جلسه منقضی شده است.");
        }

        const actionType = ctx.match[1] === 'vip' ? 'ALWAYS_NOTIFY' : 'NEVER_NOTIFY';
        session.data.action = actionType;
        session.step = 'awaiting_rule_name';
        await ctx.answerCbQuery();

        await ctx.editMessageText(
          `✅ نوع عملکرد: ${actionType === 'ALWAYS_NOTIFY' ? '🌟 شخص ویژه (VIP - اطلاع‌رسانی اجباری)' : '🚫 بلاک‌لیست (نادیده‌گیری کامل)'}\n\n` +
          `📝 *مرحله ۳ از ۳: لطفاً یک نام یا برچسب برای این شخص وارد کنید:*\n\n` +
          `💡 مثال: «همکار معتمد» یا «مشتری عمده» یا دکمه «رد شدن» را بزنید:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "⏭️ رد شدن (بدون عنوان)", callback_data: "rule_skip_name", style: "primary" }],
                [{ text: "❌ انصراف", callback_data: "rule_wizard_cancel", style: "danger" }]
              ]
            }
          }
        );
      }
    });

    bot.action("rule_skip_name", async (ctx: any) => {
      if (isAdmin(ctx)) {
        const session = adminSessions[ctx.from.id];
        if (!session || session.step !== 'awaiting_rule_name') {
          return ctx.answerCbQuery("جلسه منقضی شده است.");
        }

        const { target, action } = session.data;
        const defaultName = action === 'ALWAYS_NOTIFY' ? 'شخص ویژه (VIP)' : 'بلاک‌شده';

        if (!state.config.userRules) state.config.userRules = [];
        const cleanTarget = String(target).toLowerCase().replace(/^@/, "");
        const existingIdx = state.config.userRules.findIndex(r => r.target.toLowerCase().replace(/^@/, "") === cleanTarget);

        const newRule: UserRule = {
          id: existingIdx !== -1 ? state.config.userRules[existingIdx].id : 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          target,
          name: defaultName,
          action,
          enabled: true,
          forwardMessage: true,
          createdAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
          state.config.userRules[existingIdx] = newRule;
        } else {
          state.config.userRules.push(newRule);
        }
        saveState();
        delete adminSessions[ctx.from.id];

        await ctx.answerCbQuery("✅ قانون با موفقیت ذخیره شد!");
        await ctx.reply(`✅ شخص با تارگت \`${target}\` با موفقیت به لیست قوانین اضافه شد.`, { parse_mode: 'Markdown' });
        showRulesMenu(ctx, 0, 'ALL');
      }
    });

    // Backup actions via Glass Buttons
    bot.action("backup_json_download", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery("در حال ساخت بکاپ کامل JSON...");
        try {
          const { backupData, filename } = generateFullBackup();
          const jsonBuffer = Buffer.from(JSON.stringify(backupData, null, 2), "utf-8");

          await ctx.replyWithDocument({
            source: jsonBuffer,
            filename: filename
          }, {
            caption: `💾 *فایل پشتیبان جامع JSON (زمان‌دار)*\n\n` +
                     `📅 *زمان بکاپ:* \`${backupData.backupDatePersian}\`\n` +
                     `📦 *تعداد اقلام انبار:* *${backupData.summary.inventoryCount} کالا*\n` +
                     `👥 *تعداد قوانین اشخاص:* *${backupData.summary.userRulesCount} شخص*\n` +
                     `📋 *سوابق مشتریان:* *${backupData.summary.customersCount}*\n` +
                     `👥 *گروه‌ها:* *${backupData.summary.groupsCount}*\n\n` +
                     `💡 *جهت بازگردانی (Restore):* کافیست همین فایل را در آینده مستقیماً به همین چت ارسال نمایید.`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "👥 مدیریت اشخاص", callback_data: "menu_rules", style: "primary" }, { text: "📦 مشاهده انبار", callback_data: "menu_inventory", style: "primary" }]
              ]
            }
          });
        } catch (err: any) {
          console.error("JSON Backup generation error:", err);
          ctx.reply("❌ خطا در ساخت فایل بکاپ JSON: " + err.message);
        }
      }
    });

    bot.action("backup_excel_download", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery("در حال تولید فایل اکسل...");
        try {
          const wb = XLSX.utils.book_new();
          
          // Sheet 1: Inventory
          const wsInv = XLSX.utils.json_to_sheet(state.inventory || []);
          XLSX.utils.book_append_sheet(wb, wsInv, "Inventory");

          // Sheet 2: UserRules
          const wsRules = XLSX.utils.json_to_sheet(state.config?.userRules || []);
          XLSX.utils.book_append_sheet(wb, wsRules, "UserRules");

          // Sheet 3: Customers
          const wsCust = XLSX.utils.json_to_sheet(state.customers || []);
          XLSX.utils.book_append_sheet(wb, wsCust, "Customers");

          const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

          await ctx.replyWithDocument({
            source: buffer,
            filename: `robotdatyar_backup_${new Date().toISOString().split('T')[0]}.xlsx`
          }, {
            caption: `📊 *فایل پشتیبان اکسل (Excel)*\nشامل شیت‌های موجودی انبار، قوانین اشخاص و سوابق مشتریان.`,
            parse_mode: 'Markdown'
          });
        } catch (e: any) {
          console.error("Excel Backup generation error:", e);
          ctx.reply("❌ خطا در ساخت بکاپ اکسل: " + e.message);
        }
      }
    });

    bot.action("backup_restore_guide", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery();
        ctx.reply(
          "📤 *راهنمای بازگردانی نسخه پشتیبان (Restore):*\n\n" +
          "۱. برای بازیابی کامل انبار، قوانین اشخاص، تنظیمات و مشتریان، کافیست فایل بکاپ با فرمت `.json` را مستقیماً همینجا در چت تلگرام بفرستید.\n\n" +
          "۲. ربات بلافاصله فایل را اعتبارسنجی کرده و تمام اطلاعات را بازیابی و ذخیره می‌کند.\n\n" +
          "۳. همچنین با ارسال فایل‌های اکسل `.xlsx` می‌توانید موجودی انبار را بازگردانی و همگام‌سازی کنید.",
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "📥 دریافت بکاپ کامل فعلی (JSON)", callback_data: "backup_json_download", style: "success" }],
                [{ text: "⚙️ بازگشت به تنظیمات", callback_data: "menu_settings", style: "primary" }]
              ]
            }
          }
        );
      }
    });

    bot.action("toggle_scan", async (ctx: any) => {
      if (isAdmin(ctx)) {
        state.config.botEnabled = state.config.botEnabled === false ? true : false;
        saveState();
        await ctx.answerCbQuery(`پایش اسکن کد کالا به ${state.config.botEnabled ? "روشن" : "خاموش"} تغییر یافت.`);
        showAdminSettingsKeyboard(ctx, true);
      } else {
        await ctx.answerCbQuery("❌ دسترسی غیرمجاز", { show_alert: true });
      }
    });

    bot.action("toggle_pm", async (ctx: any) => {
      if (isAdmin(ctx)) {
        state.config.disableCustomerPm = !state.config.disableCustomerPm;
        saveState();
        await ctx.answerCbQuery(`ارسال پیام به خریدار ${state.config.disableCustomerPm ? "غیرفعال" : "فعال"} شد.`);
        showAdminSettingsKeyboard(ctx, true);
      } else {
        await ctx.answerCbQuery("❌ دسترسی غیرمجاز", { show_alert: true });
      }
    });

    bot.action("toggle_grp_access", async (ctx: any) => {
      if (isAdmin(ctx)) {
        state.config.groupAccess = state.config.groupAccess === 'admin' ? 'all' : 'admin';
        saveState();
        const label = state.config.groupAccess === 'admin' ? '🔒 فقط گروه هدف' : '🌐 تمام گروه‌ها';
        await ctx.answerCbQuery(`حوزه پایش به «${label}» تغییر یافت.`);
        showAdminSettingsKeyboard(ctx, true);
      }
    });

    bot.action("edit_msg_template", async (ctx: any) => {
      if (isAdmin(ctx)) {
        await ctx.answerCbQuery();
        ctx.reply(
          "✍️ *دستور تغییر متن ارسالی به خریدار:*\n\n" +
          "برای ثبت قالب دلخواه جدید، دستور `/setmsg` را در ابتدای پیام قرار داده و در ادامه متن مدنظرتان را بنویسید.\n\n" +
          "👉 `/setmsg سلام سفارش کالا {name} با موفقیت ثبت شد.`\n\n" +
          "💡 *نکته:* می‌توانید در متن از کلمات کلیدی `{code}` و `{name}` استفاده کنید تا خودکار جایگزین شوند.",
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.answerCbQuery("❌ دسترسی غیرمجاز", { show_alert: true });
      }
    });

    bot.command("setmsg", (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        const text = ctx.message.text || "";
        const pfx = "/setmsg";
        const newMsg = text.slice(pfx.length).trim();
        if (!newMsg) {
          return ctx.reply("❌ لطفاً قالب متن مدنظرتان را بعد از دستور `/setmsg` بنویسید.\n\nمثال:\n`/setmsg سفارش خرید کالا {name} ثبت شد.`", { parse_mode: 'Markdown' });
        }
        state.config.customerMessage = newMsg;
        saveState();
        ctx.reply(`✅ قالب متن پیام خریدار با موفقیت بروزرسانی شد:\n\n«${newMsg}»`);
      }
    });

    bot.command('add', (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        const text = ctx.message.text || "";
        const parts = text.slice(5).split('|'); // skip '/add '
        if (parts.length < 2) {
          return ctx.reply(
            "✍️ *راهنمای ثبت و ویرایش دستی کالا:*\n\n" +
            "فرمت دستور به شکل زیر است:\n" +
            "👉 `/add کد کالا | نام کالا | تعداد موجودی`\n\n" +
            "مثال: `/add SH-101 | تیشرت نخی قرمز | 15`"
          );
        }

        const code = parts[0].trim();
        const name = parts[1].trim();
        const stockStr = parts[2] ? parts[2].trim() : "1";
        const stock = isNaN(Number(stockStr)) ? 1 : Number(stockStr);

        if (!state.inventory) state.inventory = [];
        const existingIdx = state.inventory.findIndex(item => sanitizeCode(item.code) === sanitizeCode(code));

        if (existingIdx !== -1) {
          state.inventory[existingIdx] = { code, name, stock };
          ctx.reply(`✅ کالا با موفقیت ویرایش شد:\nکد: \`${code}\`\nنام: ${name}\nموجودی جدید: ${stock}`);
        } else {
          state.inventory.push({ code, name, stock });
          ctx.reply(`✅ کالا با موفقیت افزوده شد:\nکد: \`${code}\`\nنام: ${name}\nموجودی: ${stock}`);
        }
        saveState();
      } else {
        if (ctx.chat.type === "private") {
          ctx.reply("❌ این دستور مخصوص مدیر ربات است.");
        }
      }
    });

    bot.command('delete', (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        const text = ctx.message.text || "";
        const targetQuery = text.slice(7).trim(); // skip '/delete'
        if (!targetQuery) {
          return ctx.reply(
            "✍️ *راهنمای حذف دستی کالا:*\n\n" +
            "کافیست دستور را به همراه کد یا نام محصول قرار دهید:\n" +
            "👈 `/delete کد یا نام کالا`\n\n" +
            "مثال: `/delete SH-101` یا `/delete تیشرت`"
          );
        }

        if (!state.inventory) state.inventory = [];
        const querySanitized = sanitizeCode(targetQuery);
        const queryNormalized = normalizePersianArabicNumbers(targetQuery).toLowerCase();

        const existingItems = state.inventory.filter(item => {
          const codeSan = sanitizeCode(item.code);
          const nameSan = sanitizeCode(item.name);
          const codeNorm = normalizePersianArabicNumbers(item.code || "").toLowerCase();
          const nameNorm = normalizePersianArabicNumbers(item.name || "").toLowerCase();

          return codeSan === querySanitized ||
                 nameSan === querySanitized ||
                 codeNorm === queryNormalized ||
                 nameNorm === queryNormalized ||
                 (queryNormalized.length >= 2 && (codeNorm.includes(queryNormalized) || nameNorm.includes(queryNormalized)));
        });

        if (existingItems.length > 0) {
          const deletedListStr = existingItems.map(i => `${i.code} (${i.name})`).join(', ');
          state.inventory = state.inventory.filter(item => !existingItems.includes(item));
          saveState();
          ctx.reply(`✅ کالا(های) زیر با موفقیت از انبار حذف شد(ند):\n\n${deletedListStr}`);
        } else {
          ctx.reply(`❌ کالایی با کد یا نام \`${targetQuery}\` در لیست انبار یافت نشد.`);
        }
      } else {
        if (ctx.chat.type === "private") {
          ctx.reply("❌ این دستور مخصوص مدیر ربات است.");
        }
      }
    });

    bot.command('addrule', (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        const text = (ctx.message.text || "").trim();
        const parts = text.split(/\s+/);
        // /addrule [ALWAYS|NEVER] [target] [name...]
        if (parts.length < 3) {
          return ctx.reply(
            "✍️ *راهنمای ثبت قانون شخص خاص:*\n\n" +
            "فرمت دستور:\n" +
            "👉 `/addrule [ALWAYS یا NEVER] [آیدی یا @یوزرنیم] [نام یا برچسب]`\n\n" +
            "مثال‌ها:\n" +
            "🌟 `/addrule ALWAYS 123456789 همکار ویژه` (تحت هر شرایطی حتی در صورت عدم تطابق کالا اطلاع بده)\n" +
            "🚫 `/addrule NEVER @baduser اکانت تبلیغاتی` (حتی در صورت وجود کالا نادیده بگیر)",
            { parse_mode: 'Markdown' }
          );
        }

        const rawAction = parts[1].toUpperCase();
        const action: "ALWAYS_NOTIFY" | "NEVER_NOTIFY" = rawAction.includes("NEVER") || rawAction.includes("BLOCK") || rawAction.includes("MUTE")
          ? "NEVER_NOTIFY"
          : "ALWAYS_NOTIFY";
        const target = parts[2].trim();
        const name = parts.slice(3).join(" ").trim() || (action === "ALWAYS_NOTIFY" ? "شخص ویژه" : "بلاک‌شده");

        if (!state.config.userRules) state.config.userRules = [];
        const cleanTarget = target.toLowerCase().replace(/^@/, "");
        const existingIdx = state.config.userRules.findIndex(r => r.target.toLowerCase().replace(/^@/, "") === cleanTarget);

        const newRule: UserRule = {
          id: existingIdx !== -1 ? state.config.userRules[existingIdx].id : 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          target,
          name,
          action,
          enabled: true,
          forwardMessage: true,
          createdAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
          state.config.userRules[existingIdx] = newRule;
        } else {
          state.config.userRules.push(newRule);
        }
        saveState();

        ctx.reply(
          `✅ قانون با موفقیت ذخیره شد:\n\n` +
          `🎯 *تارگت:* \`${target}\`\n` +
          `📝 *نام:* ${name}\n` +
          `⚙️ *نوع قانون:* ${action === 'ALWAYS_NOTIFY' ? '🌟 اطلاع‌رسانی تحت هر شرایطی (VIP)' : '🚫 نادیده گرفتن کامل (بلاک)'}\n\n` +
          `💡 برای مشاهده تمام قوانین دستور \`/rules\` را ارسال کنید.`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    bot.command('delrule', (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        const text = (ctx.message.text || "").trim();
        const targetQuery = text.slice(8).trim().toLowerCase().replace(/^@/, "");
        if (!targetQuery) {
          return ctx.reply("❌ لطفاً آیدی عددی یا نام کاربری قانون را وارد کنید:\n\nمثال: `/delrule 123456789` یا `/delrule @spammer`", { parse_mode: 'Markdown' });
        }

        if (!state.config.userRules) state.config.userRules = [];
        const initialCount = state.config.userRules.length;
        state.config.userRules = state.config.userRules.filter(r => r.target.toLowerCase().replace(/^@/, "") !== targetQuery && r.id !== targetQuery);

        if (state.config.userRules.length < initialCount) {
          saveState();
          ctx.reply(`✅ قانون مربوط به \`${targetQuery}\` با موفقیت حذف گردید.`);
        } else {
          ctx.reply(`❌ قانونی برای \`${targetQuery}\` پیدا نشد.`);
        }
      }
    });

    bot.command('help', (ctx: any) => {
      if (ctx.chat.type === "private") {
        if (isAdmin(ctx)) {
          ctx.reply("💡 راهنمای استفاده از ربات مانیتورینگ موجودی کالا:\n\n۱. برای شروع، ربات را در گروه‌های کاری خود عضو کنید.\n۲. هر کدی که در چت گروه نوشته شود و دقیقاً با یکی از کدهای تعریف‌ شده در انبار همخوانی داشته باشد توسط ربات اسکن می‌گردد.\n۳. بلافاصله مشخصات محصول برای کاربر ارسال شده و برای مدیر نیز یک پیام اطلاع‌رسانی فرستاده خواهد شد.\n۴. در صورتی که کاربر ربات را استارت نکرده باشد، ربات در همان گروه به او یادآوری می‌کند تا ابتدا ربات را استارت نماید.");
        } else {
          ctx.reply(`سلام! این ربات برای پیدا کردن کدهای انبار در گروه‌های مبادله‌ای تعریف شده است. پیامی شامل کد صحیح محصول بفرستید تا اطلاعات خرید به چت شخصی شما فرستاده شود.`);
        }
      }
    });

    // Helper commands to get Group ID or User ID easily
    bot.command(['myid', 'getid', 'groupid', 'id'], async (ctx: any) => {
      const senderId = String(ctx.from.id);
      const adminId = state.config.adminId;

      if (ctx.chat.type === "private") {
        ctx.reply(`🆔 آیدی عددی شما: \`${ctx.from.id}\``, { parse_mode: 'Markdown' });
        return;
      }

      // In group/supergroup: Only answer if sender is the bot admin to prevent regular members access
      if (adminId && senderId === adminId) {
        ctx.reply(
          `👥 *اطلاعات گروه فعلی شما:*\n\n` +
          `🔹 *عنوان گروه:* ${ctx.chat.title || 'بدون نام'}\n` +
          `🆔 *آیدی عددی گروه:* \`${ctx.chat.id}\` ${ctx.chat.username ? `\n🔗 *یوزرنیم گروه:* @${ctx.chat.username}` : ""}\n\n` +
          `💡 برای اینکه اسکن کالاها محدود به همین گروه شود، این آیدی عددی را در بخش گروه هدف پنل مدیریت ذخیره کنید.`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // Event listener when bot is added to a new group/supergroup
    bot.on("new_chat_members", async (ctx: any) => {
      const meAdmin = botMe?.username;
      const addedMembers = ctx.message?.new_chat_members || [];
      const wasBotAdded = addedMembers.some((member: any) => member.username === meAdmin);

      if (wasBotAdded && ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        const grpId = String(ctx.chat.id);
        const grpTitle = ctx.chat.title || "گروه بدون نام";
        const grpUsername = ctx.chat.username ? String(ctx.chat.username) : "";

        if (!state.groups) state.groups = [];
        const existingGrpIdx = state.groups.findIndex(g => String(g.id) === grpId);
        const groupInfo = {
          id: grpId,
          title: grpTitle,
          username: grpUsername ? `@${grpUsername}` : undefined,
          lastActive: new Date().toISOString()
        };

        if (existingGrpIdx !== -1) {
          state.groups[existingGrpIdx] = groupInfo;
        } else {
          state.groups.push(groupInfo);
        }
        saveState();

        // Inform admin about newly joined group ID securely in PV
        if (state.config.adminId) {
          try {
            await bot.telegram.sendMessage(state.config.adminId, 
              `🔔 *ربات به گروه جدیدی اضافه شد!*\n\n` +
              `👥 نام گروه: *${grpTitle}*\n` +
              `🆔 آیدی عددی گروه (Group ID): \`${grpId}\` ${grpUsername ? `\n🔗 یوزرنیم گروه: @${grpUsername}` : ""}\n\n` +
              `💡 برای اسکن کالاها فقط در این گروه خاص، می‌توانید این آیدی عددی را کپی کرده و در بخش تنظیمات پنل مدیریت ذخیره کنید تا فعال شود.`,
              { parse_mode: 'Markdown' }
            );
          } catch (err) {
            console.error("Failed to notify admin on new_chat_members", err);
          }
        }
      }
    });

    // Document listener for both JSON Restore and Excel Updates
    bot.on("document", async (ctx: any) => {
      if (ctx.chat.type === "private" && isAdmin(ctx)) {
        const doc = ctx.message.document;
        const fileName = (doc.file_name || "").toLowerCase();
        const mimeType = (doc.mime_type || "").toLowerCase();

        // 1. JSON Backup Restore
        if (fileName.endsWith('.json') || mimeType === 'application/json' || mimeType.includes('json')) {
          ctx.reply("📥 فایل پشتیبان JSON دریافت شد. در حال پردازش و بازگردانی (Restore)...");
          try {
            const fileLink = await ctx.telegram.getFileLink(doc.file_id);
            const response = await fetch(fileLink.toString());
            const jsonText = await response.text();
            const parsedData = JSON.parse(jsonText);

            const result = restoreFromBackupData(parsedData);
            if (!result.success) {
              return ctx.reply("❌ خطا در بازگردانی فایل پشتیبان: " + (result.error || "فرمت فایل نامعتبر است."));
            }

            let successReport = `🎉 *پشتیبان با موفقیت بازگردانی (Restore) شد!*\n\n`;
            successReport += `📅 *تاریخ فایل نسخه پشتیبان:* \`${result.summary.backupTimestamp}\`\n`;
            successReport += `📦 *تعداد اقلام انبار بازیابی‌شده:* *${result.summary.inventoryCount} کالا*\n`;
            successReport += `👥 *تعداد قوانین اشخاص بازیابی‌شده:* *${result.summary.userRulesCount} شخص*\n`;
            successReport += `📋 *سوابق مشتریان بازیابی‌شده:* *${result.summary.customersCount} مورد*\n\n`;
            successReport += `✅ تمام تنظیمات، قوانین اشخاص و کالاهای انبار با موفقیت روی ربات و سرور اعمال گردید.`;

            return ctx.reply(successReport, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: "👥 مشاهده اشخاص و قوانین", callback_data: "menu_rules", style: "primary" }],
                  [{ text: "📦 مشاهده انبار", callback_data: "menu_inventory", style: "primary" }],
                  [{ text: "⚙️ تنظیمات ربات", callback_data: "menu_settings", style: "primary" }]
                ]
              }
            });
          } catch (e: any) {
            console.error("JSON restore error in telegram bot:", e);
            return ctx.reply("❌ خطا در پردازش فایل JSON پشتیبان: " + e.message);
          }
        }

        // 2. Excel Inventory Update
        if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
           ctx.reply("📊 در حال بررسی و بروزرسانی موجودی انبار از فایل اکسل...");
           try {
              const fileLink = await ctx.telegram.getFileLink(doc.file_id);
              const response = await fetch(fileLink.toString());
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              
              const wb = XLSX.read(buffer, { type: 'buffer' });
              const wsname = wb.SheetNames[0];
              const ws = wb.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
              
              if (data.length < 2) {
                return ctx.reply("❌ فایل اکسل خالی است یا ستون‌های مناسب را ندارد.");
              }

              const headers = data[0].map((h: string) => h?.toString().toLowerCase().trim());
              const codeIdx = headers.findIndex((h: string) => h === 'کد' || h === 'code');
              const nameIdx = headers.findIndex((h: string) => h === 'نام' || h === 'name' || h === 'title' || h === 'عنوان');
              const stockIdx = headers.findIndex((h: string) => h === 'موجودی' || h === 'stock' || h === 'qty' || h === 'تعداد');

              if (codeIdx === -1) {
                return ctx.reply("❌ ستون 'کد' (یا code) در ردیف اول فایل اکسل پیدا نشد.");
              }

              const existingInventory = [...(state.inventory || [])];
              let addedCount = 0;
              let updatedCount = 0;

              for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (!row || row.length === 0 || !row[codeIdx]) continue;
                
                const rawCode = String(row[codeIdx]).trim();
                const rawName = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : 'بدون نام';
                
                let itemStock = 1;
                if (stockIdx !== -1 && row[stockIdx] !== undefined && row[stockIdx] !== null && String(row[stockIdx]).trim() !== "") {
                  const numValue = Number(row[stockIdx]);
                  itemStock = isNaN(numValue) ? 0 : numValue;
                }

                const sanitizedInputCode = sanitizeCode(rawCode);
                const existingIdx = existingInventory.findIndex(item => sanitizeCode(item.code) === sanitizedInputCode);

                if (existingIdx !== -1) {
                  existingInventory[existingIdx] = {
                    code: rawCode,
                    name: rawName !== 'بدون نام' ? rawName : existingInventory[existingIdx].name,
                    stock: itemStock
                  };
                  updatedCount++;
                } else {
                  existingInventory.push({
                    code: rawCode,
                    name: rawName,
                    stock: itemStock
                  });
                  addedCount++;
                }
              }

              // Also check if UserRules sheet exists in this Excel
              let restoredRulesCount = 0;
              if (wb.Sheets["UserRules"]) {
                const rulesData = XLSX.utils.sheet_to_json(wb.Sheets["UserRules"]) as any[];
                if (Array.isArray(rulesData) && rulesData.length > 0) {
                  state.config.userRules = rulesData;
                  restoredRulesCount = rulesData.length;
                }
              }

              state.inventory = existingInventory;
              saveState();
              let msg = `✅ *موجودی انبار با موفقیت بروزرسانی شد:*\n\n` +
                        `➕ تعداد کالاهای جدید: *${addedCount}*\n` +
                        `✏️ تعداد کالاهای بروزرسانی‌شده: *${updatedCount}*\n` +
                        `📦 کل کالاهای موجود در انبار: *${state.inventory.length}*`;
              if (restoredRulesCount > 0) {
                msg += `\n👥 قوانین اشخاص همگام‌شده: *${restoredRulesCount}*`;
              }
              ctx.reply(msg, { parse_mode: 'Markdown' });
           } catch (e: any) {
              console.error(e);
              ctx.reply("❌ خطا در پردازش فایل اکسل: " + e.message);
           }
        } else if (!fileName.endsWith('.json')) {
           ctx.reply("❌ لطفاً یک فایل با فرمت `.json` (پشتیبان کامل) یا `.xlsx` (فایل اکسل انبار) ارسال نمایید.");
        }
      }
    });

    bot.on("text", async (ctx: any) => {
      const text = ctx.message.text || "";

      if (ctx.chat.type === "private") {
        if (isAdmin(ctx)) {
          
          const session = adminSessions[ctx.from.id];
          if (session) {
            // Rule Add Wizard Sessions
            if (session.step === 'awaiting_rule_target') {
              const targetInput = text.trim();
              if (!targetInput) {
                return ctx.reply("❌ لطفاً آیدی عددی یا نام کاربری معتبر وارد کنید:");
              }

              session.data.target = targetInput;
              session.step = 'awaiting_rule_action';

              return ctx.reply(
                `🎯 *تارگت دریافت شد:* \`${targetInput}\`\n\n` +
                `⚙️ *مرحله ۲ از ۳: لطفاً نوع عملکرد ربات برای این شخص را انتخاب کنید:*`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: "🌟 شخص ویژه (VIP - اطلاع‌رسانی اجباری)", callback_data: "rule_set_type_vip", style: "success" }
                      ],
                      [
                        { text: "🚫 بلاک‌لیست (نادیده‌گیری کامل)", callback_data: "rule_set_type_never", style: "danger" }
                      ],
                      [
                        { text: "❌ انصراف", callback_data: "rule_wizard_cancel", style: "primary" }
                      ]
                    ]
                  }
                }
              );
            } else if (session.step === 'awaiting_rule_name') {
              const nameInput = text.trim();
              const { target, action } = session.data;
              const ruleName = nameInput || (action === 'ALWAYS_NOTIFY' ? 'شخص ویژه (VIP)' : 'بلاک‌شده');

              if (!state.config.userRules) state.config.userRules = [];
              const cleanTarget = String(target).toLowerCase().replace(/^@/, "");
              const existingIdx = state.config.userRules.findIndex(r => r.target.toLowerCase().replace(/^@/, "") === cleanTarget);

              const newRule: UserRule = {
                id: existingIdx !== -1 ? state.config.userRules[existingIdx].id : 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                target,
                name: ruleName,
                action,
                enabled: true,
                forwardMessage: true,
                createdAt: new Date().toISOString()
              };

              if (existingIdx !== -1) {
                state.config.userRules[existingIdx] = newRule;
              } else {
                state.config.userRules.push(newRule);
              }
              saveState();
              delete adminSessions[ctx.from.id];

              await ctx.reply(
                `🎉 *قانون با موفقیت ثبت شد!*\n\n` +
                `🎯 *تارگت:* \`${target}\`\n` +
                `📝 *عنوان/نام:* ${ruleName}\n` +
                `⚙️ *نوع قانون:* ${action === 'ALWAYS_NOTIFY' ? '🌟 شخص ویژه (VIP - ارسال تحت هر شرایطی)' : '🚫 لیست سیاه (بلاک)'}`,
                { parse_mode: 'Markdown' }
              );
              return showRulesMenu(ctx, 0, 'ALL');
            }

            // Inventory Add / Edit Sessions
            if (session.step === 'awaiting_product_code') {
              session.data.code = text.trim();
              session.step = 'awaiting_product_name';
              return ctx.reply("✅ کد دریافت شد.\n\n📝 حالا **نام کالا** را وارد کنید:\n\n(برای انصراف از دکمه زیر استفاده کنید)", {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]]
                }
              });
            } else if (session.step === 'awaiting_product_name') {
              session.data.name = text.trim();
              session.step = 'awaiting_product_stock';
              return ctx.reply("✅ نام دریافت شد.\n\n📝 لطفاً **موجودی** را به صورت عدد وارد کنید:\n\n(برای انصراف از دکمه زیر استفاده کنید)", {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]]
                }
              });
            } else if (session.step === 'awaiting_product_stock') {
              const stock = parseInt(normalizePersianArabicNumbers(text.trim()), 10);
              if (isNaN(stock)) {
                return ctx.reply("❌ لطفا موجودی را فقط به صورت عدد صحیح وارد کنید:", {
                  reply_markup: {
                    inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_add_product", style: "danger" }]]
                  }
                });
              }
              const { code, name } = session.data;
              
              if (!state.inventory) state.inventory = [];
              const existingIdx = state.inventory.findIndex(item => sanitizeCode(item.code) === sanitizeCode(code));

              if (existingIdx !== -1) {
                state.inventory[existingIdx] = { code, name, stock };
                ctx.reply(`✅ کالا با موفقیت ویرایش شد:\nکد: \`${code}\`\nنام: ${name}\nموجودی جدید: ${stock}`, { parse_mode: 'Markdown' });
              } else {
                state.inventory.push({ code, name, stock });
                ctx.reply(`✅ کالا با موفقیت افزوده شد:\nکد: \`${code}\`\nنام: ${name}\nموجودی: ${stock}`, { parse_mode: 'Markdown' });
              }
              saveState();
              delete adminSessions[ctx.from.id];
              return;
            } else if (session.step === 'awaiting_add_stock') {
              const stockToAdd = parseInt(normalizePersianArabicNumbers(text.trim()), 10);
              if (isNaN(stockToAdd)) {
                return ctx.reply("❌ لطفا تعداد موجودی جدید را به صورت عدد وارد کنید:");
              }
              const { code } = session.data;
              const existingIdx = state.inventory.findIndex(item => sanitizeCode(item.code) === sanitizeCode(code));
              if (existingIdx !== -1) {
                state.inventory[existingIdx].stock = stockToAdd;
                saveState();
                ctx.reply(`✅ موجودی کالا بروز شد.\nکد: \`${code}\`\nموجودی جدید: ${state.inventory[existingIdx].stock}`, { parse_mode: 'Markdown' });
              } else {
                ctx.reply("❌ کالا یافت نشد.");
              }
              delete adminSessions[ctx.from.id];
              return;
            } else if (session.step === 'awaiting_search_query') {
              const queryRaw = text.trim();
              const queryNormalized = normalizePersianArabicNumbers(queryRaw).toLowerCase();
              const querySanitized = sanitizeCode(queryRaw);

              const results = state.inventory.filter(item => {
                const codeRaw = String(item.code || "");
                const codeNormalized = normalizePersianArabicNumbers(codeRaw).toLowerCase();
                const codeSanitized = sanitizeCode(codeRaw);

                const nameRaw = String(item.name || "");
                const nameNormalized = normalizePersianArabicNumbers(nameRaw).toLowerCase();

                return codeNormalized.includes(queryNormalized) || 
                       nameNormalized.includes(queryNormalized) || 
                       (querySanitized && codeSanitized.includes(querySanitized));
              }).slice(0, 20);

              if (results.length === 0) {
                ctx.reply(`❌ کالایی با مشخصات "${queryRaw}" یافت نشد.`);
              } else {
                let replyText = `🔎 نتایج جستجو برای "${queryRaw}":\n\n`;
                const buttons: any[][] = [];
                results.forEach(item => {
                  replyText += `🔹 *کد:* \`${item.code}\`\n📝 *نام:* ${item.name}\n📦 *موجودی:* ${item.stock}\n\n`;
                  buttons.push([
                    { text: `🗑️ حذف ${item.code}`, callback_data: `inv_del_${item.code}`, style: 'danger' },
                    { text: `✏️ ویرایش ${item.code}`, callback_data: `inv_edit_${item.code}`, style: 'primary' },
                    { text: `➕ موجودی ${item.code}`, callback_data: `inv_addstock_${item.code}`, style: 'success' }
                  ]);
                });
                ctx.reply(replyText, {
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: buttons }
                });
              }
              delete adminSessions[ctx.from.id];
              return;
            } else if (session.step === 'awaiting_delete_search') {
              const queryRaw = text.trim();
              const queryNormalized = normalizePersianArabicNumbers(queryRaw).toLowerCase();
              const querySanitized = sanitizeCode(queryRaw);

              const results = state.inventory.filter(item => {
                const codeRaw = String(item.code || "");
                const codeNormalized = normalizePersianArabicNumbers(codeRaw).toLowerCase();
                const codeSanitized = sanitizeCode(codeRaw);

                const nameRaw = String(item.name || "");
                const nameNormalized = normalizePersianArabicNumbers(nameRaw).toLowerCase();

                return codeNormalized.includes(queryNormalized) || 
                       nameNormalized.includes(queryNormalized) || 
                       (querySanitized && codeSanitized.includes(querySanitized));
              }).slice(0, 20);

              if (results.length === 0) {
                ctx.reply(`❌ کالایی با مشخصات "${queryRaw}" برای حذف یافت نشد.`);
              } else {
                let replyText = `🗑️ نتایج یافت‌شده برای حذف کالا "${queryRaw}":\n\n`;
                const buttons: any[][] = [];
                results.forEach(item => {
                   replyText += `🔹 *کد:* \`${item.code}\`\n📝 *نام:* ${item.name}\n📦 *موجودی:* ${item.stock}\n\n`;
                   buttons.push([
                     { text: `🗑️ حذف قطعی ${item.code}`, callback_data: `inv_del_${item.code}`, style: 'danger' }
                   ]);
                });
                ctx.reply(replyText, {
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: buttons }
                });
              }
              delete adminSessions[ctx.from.id];
              return;
            }
          }

          // If admin types a raw text message that doesn't match our custom menu buttons
          const btnTitles = [
            "✍️ ثبت و ویرایش دستی کالا", "📦 لیست کالاهای موجود", "🔎 جستجوی کالا", "🗑️ حذف دستی کالا",
            "📤 آپلود موجودی انبار (اکسل)", "📥 دریافت فایل پشتیبان انبار", "⚙️ تنظیمات ربات", "💡 راهنمای کامل",
            "👥 مدیریت اشخاص و VIP", "💾 پشتیبان‌گیری و بازگردانی"
          ];
          if (!text.startsWith('/') && !btnTitles.some(b => text.includes(b))) {
             ctx.reply("مدیر گرامی، برای مدیریت از دکمه‌های شیشه‌ای منو استفاده فرمایید یا فایل اکسل/JSON خود را مستقیماً به همینجا ارسال نمایید.");
          }
          return;
        } else {
          ctx.reply("⚠️ شما دسترسی به پنل مدیریت یا اطلاعات در پی‌وی ندارید.\nاین ربات صرفاً فرمان‌های پایش کد کالا را در گروه‌های کاری متصل‌شده پردازش می‌کند.");
          return;
        }
      }

      // Ignore all slash commands in groups to prevent command clutter and false scanners
      if (text.startsWith('/')) {
        return;
      }

      // Check if scanner bot scanning is disabled (turned off)
      if (state.config.botEnabled === false) {
        return;
      }

      // Enqueue group processing so sequential messaging works beautifully without rate limits or data races
      enqueueGroupMessageTask(async () => {
        // Automatically register group for auto-discovery
        if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
          const grpId = String(ctx.chat.id);
          const grpTitle = ctx.chat.title || "گروه بدون نام";
          const grpUsername = ctx.chat.username ? String(ctx.chat.username) : "";

          if (!state.groups) state.groups = [];
          const existingGrpIdx = state.groups.findIndex(g => String(g.id) === grpId);
          const groupInfo = {
            id: grpId,
            title: grpTitle,
            username: grpUsername ? `@${grpUsername}` : undefined,
            lastActive: new Date().toISOString()
          };

          if (existingGrpIdx !== -1) {
            state.groups[existingGrpIdx] = groupInfo;
          } else {
            state.groups.push(groupInfo);
            saveState();

            // Securing notice to admin on discovering a new group in background
            if (state.config.adminId) {
              try {
                await bot.telegram.sendMessage(state.config.adminId, 
                  `🔔 *ربات در گروه جدیدی فعالیت خود را آغاز کرد!*\n\n` +
                  `👥 نام گروه: *${grpTitle}*\n` +
                  `🆔 آیدی عددی گروه (Group ID): \`${grpId}\` ${grpUsername ? `\n🔗 یوزرنیم گروه: @${grpUsername}` : ""}\n\n` +
                  `💡 برای محدود کردن اسکن کالاها به همین گروه، می‌توانید هم‌اکنون این آیدی را در تنظیمات پنل کپی و ذخیره کنید.`,
                  { parse_mode: 'Markdown' }
                );
              } catch (err) {
                console.error("Failed to notify admin on group text detection", err);
              }
            }
          }
        }

        // Optional Group ID restriction check
        if (state.config.groupId && state.config.groupId.trim() !== "") {
           const configGroup = state.config.groupId.trim();
           const currentChatId = String(ctx.chat.id);
           const currentChatUsername = ctx.chat.username ? String(ctx.chat.username) : "";

           const isGroupMatch = currentChatId === configGroup || 
                               (currentChatUsername && (configGroup === `@${currentChatUsername}` || configGroup === currentChatUsername));
           
           if (!isGroupMatch) {
              return; // Ignore updates from other non-registered groups
           }
        }

        // Check specific person rules (قوانین اشخاص خاص در ربات معمولی)
        const senderId = String(ctx.from?.id || "");
        const senderUsername = ctx.from?.username || "";
        const senderFullName = ((ctx.from?.first_name || "") + " " + (ctx.from?.last_name || "")).trim();
        const matchedUserRule = findMatchingUserRule(senderId, senderUsername, state.config.userRules);

        if (matchedUserRule) {
          if (matchedUserRule.action === "NEVER_NOTIFY") {
            console.log(`[Bot] Muted/Ignored message from ${senderId} (@${senderUsername}) per rule: ${matchedUserRule.name || matchedUserRule.target}`);
            return;
          }

          if (matchedUserRule.action === "ALWAYS_NOTIFY") {
            console.log(`[Bot] ALWAYS_NOTIFY triggered for ${senderId} (@${senderUsername}) per rule: ${matchedUserRule.name || matchedUserRule.target}`);
            
            const normalizedText = normalizePersianArabicNumbers(text);
            const foundItems = state.inventory.filter((item) => {
              if (matchCodeInText(normalizedText, item.code)) return true;
              if (item.name && item.name !== "بدون نام" && matchCodeInText(normalizedText, item.name)) return true;
              return false;
            });

            let vipNotifyMsg = `🌟 <b>اطلاع‌رسانی ویژه: پیام از شخص تحت پایش اختصاصی (VIP)!</b>\n\n`;
            if (matchedUserRule.name) {
              vipNotifyMsg += `🏷️ <b>عنوان قانون:</b> <code>${escapeHtml(matchedUserRule.name)}</code>\n`;
            }
            vipNotifyMsg += `👥 <b>مشخصات گروه:</b> ${escapeHtml(ctx.chat.title || "بدون نام")}\n`;
            vipNotifyMsg += `🆔 <b>آیدی گروه:</b> <code>${ctx.chat.id}</code>\n\n`;
            vipNotifyMsg += `👤 <b>مشخصات فرستنده:</b>\n`;
            vipNotifyMsg += `🔹 نام: <a href="tg://user?id=${senderId}"><b>${escapeHtml(senderFullName || "ناشناس")}</b></a>\n`;
            vipNotifyMsg += `🔹 نام کاربری: <a href="tg://user?id=${senderId}">${senderUsername ? `@${escapeHtml(senderUsername)}` : "بدون‌یوزرنیم"}</a>\n`;
            vipNotifyMsg += `🆔 <b>آیدی عددی:</b> <a href="tg://user?id=${senderId}"><code>${senderId}</code></a>\n\n`;

            if (foundItems.length > 0) {
              vipNotifyMsg += `📦 <b>کالاهای تطبیق‌یافته در انبار:</b>\n\n`;
              for (const item of foundItems) {
                if (!state.customers) state.customers = [];
                state.customers.push({
                  userId: senderId,
                  username: senderUsername || "بدون‌نام",
                  chatId: String(ctx.chat.id),
                  chatTitle: ctx.chat.title || "گروه ناشناس",
                  itemCode: String(item.code),
                  itemName: String(item.name),
                  date: new Date().toISOString()
                });
                vipNotifyMsg += `✅ <b>کد:</b> <code>${escapeHtml(item.code)}</code> | <b>نام:</b> ${escapeHtml(item.name)} | <b>موجودی:</b> <b>${escapeHtml(String(item.stock))}</b>\n`;
              }
            } else {
              vipNotifyMsg += `ℹ️ <i>کدهای پیام در انبار شما نبود، ولی طبق قانون شخص ویژه (Always Notify) برای شما ارسال شد.</i>\n\n`;
            }

            vipNotifyMsg += `\n📝 <b>متن کامل پیام فرستنده:</b>\n« ${escapeHtml(text)} »\n\n`;
            saveState();

            try {
              await bot?.telegram.sendMessage(state.config.adminId, vipNotifyMsg, { parse_mode: 'HTML' });
              if (matchedUserRule.forwardMessage !== false && ctx.message && ctx.message.message_id) {
                try {
                  await bot?.telegram.forwardMessage(state.config.adminId, ctx.chat.id, ctx.message.message_id);
                } catch (fe) {
                  console.warn("Could not forward VIP message to admin", fe);
                }
              }
            } catch (err) {
              console.error("Failed to notify admin via bot on VIP rule", err);
            }
            return;
          }
        }

        // Secure purchase intent confirmation check
        if (!isPurchaseRequest(text)) {
          return; // Ignore
        }

        const normalizedText = normalizePersianArabicNumbers(text);

        const foundItems = state.inventory.filter((item) => {
           if (matchCodeInText(normalizedText, item.code)) return true;
           if (item.name && item.name !== "بدون نام" && matchCodeInText(normalizedText, item.name)) return true;
           return false;
        });

        if (foundItems.length > 0) {
          let adminNotifyMsg = `📥 <b>ثبت درخواست خرید جدید در گروه!</b>\n\n`;
          adminNotifyMsg += `👥 <b>مشخصات گروه:</b> ${escapeHtml(ctx.chat.title || "بدون نام")}\n`;
          adminNotifyMsg += `🆔 <b>آیدی گروه:</b> <code>${ctx.chat.id}</code>\n\n`;
          adminNotifyMsg += `👤 <b>مشخصات خریدار:</b>\n`;
          adminNotifyMsg += `🔹 نام: <a href="tg://user?id=${ctx.from.id}"><b>${escapeHtml((ctx.from.first_name || "") + " " + (ctx.from.last_name || "").trim())}</b></a>\n`;
          adminNotifyMsg += `🔹 نام کاربری: <a href="tg://user?id=${ctx.from.id}">${ctx.from.username ? `@${escapeHtml(ctx.from.username)}` : "بدون‌یوزرنیم"}</a>\n`;
          adminNotifyMsg += `🆔 <b>آیدی عددی خریدار:</b> <a href="tg://user?id=${ctx.from.id}"><code>${ctx.from.id}</code></a>\n\n`;
          adminNotifyMsg += `📦 <b>کالاهای اسکن‌شده:</b> \n\n`;

          let hasAvailable = false;
          
          for (const item of foundItems) {
            if (Number(item.stock) > 0) {
              hasAvailable = true;
              
              // Add customer request record to local database
              if (!state.customers) state.customers = [];
              state.customers.push({
                 userId: String(ctx.from.id),
                 username: ctx.from.username || "بدون‌نام",
                 chatId: String(ctx.chat.id),
                 chatTitle: ctx.chat.title || "گروه ناشناس",
                 itemCode: String(item.code),
                 itemName: String(item.name),
                 date: new Date().toISOString()
              });

              adminNotifyMsg += `✅ <b>کد محصول:</b> <code>${escapeHtml(item.code)}</code>\n`;
              adminNotifyMsg += `🔸 <b>نام محصول:</b> ${escapeHtml(item.name)}\n`;
              adminNotifyMsg += `🔢 <b>موجودی در انبار:</b> <b>${escapeHtml(String(item.stock))}</b>\n\n`;

              // Prepare customized private message text to customer
              let pmText = state.config.customerMessage && state.config.customerMessage.trim() !== ""
                ? state.config.customerMessage
                : `سلام دوست گرامی، درخواست شما برای خرید کالای «<b>{name}</b>» با کد «<b>{code}</b>» با موفقیت ثبت شد.\nمدیریت ربات به زودی برای هماهنگی‌های لازم با شما ارتباط می‌گیرد.🌸`;
              
              pmText = pmText
                .replace(/{code}/g, item.code)
                .replace(/{name}/g, item.name);

              // Send in private chat with user (PV) unless disabled by admin
              if (state.config.disableCustomerPm === true) {
                console.log("Customer PM alerts are disabled, forwarding only to admin");
              } else {
                try {
                  await bot.telegram.sendMessage(ctx.from.id, pmText, { parse_mode: 'HTML' });
                } catch (pvError: any) {
                  console.warn("Failed to send PM directly to user, completely silent in group per admin preference.", pvError);
                }
              }
            }
          }

          if (hasAvailable) {
            saveState();

            adminNotifyMsg += `📝 <b>متن پیام خریدار:</b>\n« ${escapeHtml(text)} »\n\n`;

            try {
              await bot?.telegram.sendMessage(state.config.adminId, adminNotifyMsg, { parse_mode: 'HTML' });
              
              // Forward the original triggering message from the group to the admin PV
              if (ctx.message && ctx.message.message_id) {
                 try {
                    await bot?.telegram.forwardMessage(state.config.adminId, ctx.chat.id, ctx.message.message_id);
                 } catch (fwdErr) {
                    // Forwarding might fail if the user hid their account or the group restricts forwarding.
                    console.warn("Could not forward original message", fwdErr);
                 }
              }
            } catch (err) {
              console.error("Failed to forward requesting message to admin", err);
            }
          }
        }
      });
    });

    bot.catch((err: any) => {
      console.error("Bot Error", err);
      // ONLY set state.isRunning to false on absolute unauthorized failures (invalid token).
      // Keep state.isRunning to true on conflicts or network issues, allowing the supervisor to recover it nicely.
      if (err.message && (err.message.includes("Unauthorized") || err.message.includes("401"))) {
         console.warn("Fatal unauthorized bot log. Stopping bot permanently...");
         try { bot.stop(); } catch(e){}
         bot = null;
         state.isRunning = false;
         saveState();
      } else {
         console.warn("Transient or conflict bot connection error detected. Resetting bot instance but keeping isRunning=true for supervisor recovery...");
         try { bot.stop(); } catch(e){}
         bot = null;
      }
    });

    // We use long polling
    await bot.launch();
    state.isRunning = true;
    saveState();
    console.log("Bot started successfully");
    return true;
  } catch (e: any) {
    console.error("Failed to start bot", e);
    // Crucial fix: Do NOT set state.isRunning to false on connection/network/polling/conflict errors.
    // Setting bot to null triggers the supervisor restart.
    bot = null;
    
    // Check if it is a fatal token error (like 401 Unauthorized)
    if (e.message && (e.message.includes("401") || e.message.includes("Unauthorized"))) {
      state.isRunning = false;
      saveState();
    }
    return false;
  }
}

// Reconnection supervisor
let isReconnecting = false;
let lastUserbotStartAttempt = 0;

async function checkAndRecoverBot() {
  if (isReconnecting) return;
  isReconnecting = true;
  try {
    // 1. Recover main Telegraf bot if active but instance is null/stopped
    if (state.isRunning && !bot) {
      console.log("🔄 Background Supervisor: Bot was supposed to be running but is inactive. Recovering...");
      await startBot();
    }
    
    // 2. Recover userbot client if it gets disconnected or connection drops
    if (state.config.userbotSession && state.config.userbotEnabled !== false) {
      if (!userbotClient) {
        const now = Date.now();
        if (now - lastUserbotStartAttempt > 60000) {
          console.log("🔄 Background Supervisor: Userbot client is null. Re-initializing...");
          lastUserbotStartAttempt = now;
          await startUserbot();
        } else {
          console.log("🔄 Background Supervisor: Userbot is null but rate-limited reconnect wait. Skipping...");
        }
      } else if (!userbotClient.connected) {
        console.log("🔄 Background Supervisor: Userbot is disconnected. Attempting safe .connect()...");
        try {
          // Gently call connect() to let GramJS resume its active session
          await userbotClient.connect();
          console.log("🔄 Background Supervisor: Safe .connect() succeeded!");
        } catch (connErr) {
          console.error("🔄 Background Supervisor: Safe .connect() failed. Attempting full startUserbot...", connErr);
          const now = Date.now();
          if (now - lastUserbotStartAttempt > 60000) {
            lastUserbotStartAttempt = now;
            await startUserbot();
          } else {
            console.log("🔄 Background Supervisor: Skipping startUserbot to prevent connection spamming.");
          }
        }
      }
    }
  } catch (err) {
    console.error("🔄 Background Supervisor: Error trying to recover bots:", err);
  } finally {
    isReconnecting = false;
  }
}

// Check every 30 seconds to make sure the bot is up and running if intended
setInterval(checkAndRecoverBot, 30000);

// Auto-start on boot if configured and wasn't explicitly shut down by user
if (state.isRunning !== false && state.config.token && state.config.adminId) {
  console.log("🚀 Server boot: Auto-starting bot since it was previously active...");
  startBot().catch(console.error);
} else {
  console.log("⚠️ Server boot: Bot registration ignored or previously disabled.");
}

if (state.config.userbotSession && state.config.userbotEnabled !== false) {
  console.log("🚀 Server boot: Auto-starting userbot since it is configured...");
  startUserbot().catch(console.error);
}

// API Routes
app.get("/api/cron-keepalive", async (req, res) => {
  console.log("⏰ Cron Keepalive ping received.");
  await checkAndRecoverBot();
  res.json({
    success: true,
    status: state.isRunning ? "running" : "stopped",
    botActive: !!bot,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/state", (req, res) => {
  loadState(true);
  res.json({
    config: state.config,
    inventory: state.inventory,
    customers: state.customers || [],
    groups: state.groups || [],
    isRunning: state.isRunning,
  });
});

app.get("/api/download-deploy", (req, res) => {
  const possiblePaths = [
    path.join(process.cwd(), "dist", "cpanel-deploy.zip"),
    path.join(__dirname, "dist", "cpanel-deploy.zip"),
    path.join(__dirname, "cpanel-deploy.zip"),
    path.resolve("dist", "cpanel-deploy.zip"),
    "/dist/cpanel-deploy.zip"
  ];
  
  let validPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      validPath = p;
      break;
    }
  }

  if (validPath) {
    res.download(validPath, "cpanel-deploy.zip");
  } else {
    res.status(404).send("فایل زیپ بیلد هنوز ساخته نشده است. لطفا پروژه را در AI Studio مجدداً کامپایل/بیلد کنید.");
  }
});

app.post("/api/config", async (req, res) => {
  loadState(true);
  state.config = { ...state.config, ...req.body };
  if (state.config.adminId) state.config.adminId = String(state.config.adminId).trim();
  if (state.config.groupId) state.config.groupId = String(state.config.groupId).trim();
  if (state.config.proxyUrl !== undefined) state.config.proxyUrl = String(state.config.proxyUrl).trim();
  
  // If token and adminId are supplied and it wasn't explicitly disabled, let's target to run
  if (state.isRunning !== false && state.config.token && state.config.adminId) {
    state.isRunning = true;
  }
  
  saveState();
  
  let started = false;
  if (state.isRunning) {
    started = await startBot();
  }

  // Restart userbot if configured
  if (state.config.userbotSession) {
    await startUserbot().catch(console.error);
  }
  
  res.json({ success: true, isRunning: started });
});

app.post("/api/proxy/test", async (req, res) => {
  const rawProxy = String(req.body?.proxyUrl || state.config.proxyUrl || process.env.PROXY_URL || process.env.TELEGRAM_PROXY || "").trim();
  if (!rawProxy) {
    return res.status(400).json({ success: false, error: "لطفاً آدرس پروکسی را وارد نمایید." });
  }

  const start = Date.now();
  try {
    const agent = getTelegrafProxyAgent(rawProxy);
    if (!agent) {
      return res.status(400).json({ 
        success: false, 
        error: "فرمت آدرس پروکسی نامعتبر است. نمونه‌های مجاز: socks5://127.0.0.1:10808 یا http://127.0.0.1:10809" 
      });
    }

    const https = await import("https");
    const testPromise = new Promise<{ statusCode: number }>((resolve, reject) => {
      const request = https.get(
        "https://api.telegram.org",
        { agent, timeout: 8000 },
        (response) => {
          resolve({ statusCode: response.statusCode || 200 });
        }
      );
      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy(new Error("مهلت زمان اتصال به پروکسی (Timeout 8 ثانیه) به پایان رسید."));
      });
    });

    const result = await testPromise;
    const latency = Date.now() - start;
    return res.json({
      success: true,
      latency,
      statusCode: result.statusCode,
      message: `ارتباط با سرورهای تلگرام از طریق پروکسی با موفقیت برقرار شد (پینگ: ${latency} میلی‌ثانیه)`
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: `خطا در اتصال به تلگرام از طریق پروکسی: ${err?.message || "خطای اتصال"}`
    });
  }
});

function translateTelegramError(errorStr: string): string {
  const upperError = String(errorStr).toUpperCase();
  
  if (upperError.includes("AUTH_USER_CANCEL") || upperError.includes("USER_CANCEL")) {
    return "ورود تایید نشد. درخواست ورود در تلگرام توسط شما یا یک دستگاه دیگر لغو (Cancel) شد. لطفا چند لحظه دیگر مجدداً دکمه ارسال کد را لمس نموده و این‌بار درخواست ورود را تایید کنید.";
  }
  if (upperError.includes("PHONE_CODE_EXPIRED")) {
    return "کد تایید تلگرام منقضی شده است. لطفا مجددا درخواست کد جدید بدهید.";
  }
  if (upperError.includes("PHONE_CODE_INVALID") || upperError.includes("CODE_INVALID")) {
    return "کد تایید تلگرام وارد شده صحیح نمی باشد. لطفا دوباره بررسی نمایید.";
  }
  if (upperError.includes("PASSWORD_HASH_INVALID") || upperError.includes("PASSWORD_INVALID")) {
    return "رمز عبور دو مرحله‌ای (2FA) نادرست است.";
  }
  if (upperError.includes("FLOOD_WAIT")) {
    return "محدودیت زمانی موقت تلگرام (Flood Wait). تعداد دفعات تلاش شما بیش از حد مجاز بوده است. لطفا چند دقیقه صبر کرده و سپس اقدام به ورود کنید.";
  }
  if (upperError.includes("PHONE_NUMBER_INVALID")) {
    return "شماره تلفن وارد شده صحیح نیست یا در سیستم تلگرام به عنوان حساب فعال شناخته نشده است.";
  }
  if (upperError.includes("SESSION_PASSWORD_NEEDED")) {
    return "رمز دو مرحله‌ای برای این حساب تلگرام فعال است. لطفا آن را وارد کنید.";
  }
  if (upperError.includes("API_ID_INVALID") || upperError.includes("API_HASH_INVALID") || upperError.includes("API_ID_PUBLISHED_LIMIT")) {
    return "مشخصات API ID или API Hash اشتباه است یا به حد لیمیت رسیده است. از بای‌پس پیش‌فرض یا اطلاعات معتبر استفاده کنید.";
  }
  
  return errorStr || "خطای نامشخص در احراز هویت تلگرام.";
}

const pendingUserbots = new Map<string, {
  client: any;
  apiId: number;
  apiHash: string;
  codePromise: Promise<string>;
  resolveCode?: (code: string) => void;
  passwordPromise: Promise<string>;
  resolvePassword?: (pass: string) => void;
  status: "pending_code" | "pending_password" | "success" | "error";
  error?: string;
  requiresPassword?: boolean;
  sentCodeType?: string;
  emailPattern?: string;
  codeLength?: number;
}>();

// 1. Send authentication code
app.post("/api/userbot/send-code", async (req, res) => {
  const { apiId, apiHash, phoneNumber } = req.body;
  if (!phoneNumber) {
    res.status(400).json({ error: "شماره تلفن الزامی است." });
    return;
  }

  // Fallback to official Telegram Desktop credentials if not provided
  // This bypasses errors/blocks on my.telegram.org for the user
  const finalApiId = apiId ? Number(apiId) : 2040;
  const finalApiHash = apiHash ? String(apiHash).trim() : "b18441a1ff607e10a989891a5462e627";

  const cleanPhone = String(phoneNumber).trim();

  try {
    const existing = pendingUserbots.get(cleanPhone);
    if (existing) {
      try { await existing.client.disconnect(); } catch (e) {}
    }

    const proxyConfig = getGramJsProxyConfig(state.config.proxyUrl);
    const client = new TelegramClient(
      new StringSession(""),
      finalApiId,
      finalApiHash,
      { 
        connectionRetries: 5,
        ...(proxyConfig ? { proxy: proxyConfig } : {})
      }
    );

    await client.connect();

    let resolveCode: ((code: string) => void) | undefined;
    const codePromise = new Promise<string>((resolve) => {
      resolveCode = resolve;
    });

    let resolvePassword: ((pass: string) => void) | undefined;
    const passwordPromise = new Promise<string>((resolve) => {
      resolvePassword = resolve;
    });

    const pendingSession: {
      client: any;
      apiId: number;
      apiHash: string;
      codePromise: Promise<string>;
      resolveCode?: (code: string) => void;
      passwordPromise: Promise<string>;
      resolvePassword?: (pass: string) => void;
      status: "pending_code" | "pending_password" | "success" | "error";
      error?: string;
      requiresPassword?: boolean;
      sentCodeType?: string;
      emailPattern?: string;
      codeLength?: number;
    } = {
      client,
      apiId: finalApiId,
      apiHash: finalApiHash,
      codePromise,
      resolveCode,
      passwordPromise,
      resolvePassword,
      status: "pending_code",
      requiresPassword: false,
      error: undefined,
      sentCodeType: undefined,
      emailPattern: undefined,
      codeLength: undefined
    };

    // Capture the type of verification code (SMS, App, or Email)
    const originalInvoke = client.invoke.bind(client);
    client.invoke = async (request: any, ...args: any[]) => {
      const result = await originalInvoke(request, ...args);
      if (result && result.className === "auth.SentCode") {
        console.log("Captured Telegram SentCode Response:", JSON.stringify({
          className: result.className,
          type: result.type?.className,
          emailPattern: result.type?.emailPattern,
          length: result.type?.length
        }));
        pendingSession.sentCodeType = result.type?.className;
        pendingSession.emailPattern = result.type?.emailPattern;
        pendingSession.codeLength = result.type?.length;
      }
      return result;
    };

    pendingUserbots.set(cleanPhone, pendingSession);

    // Call high-level signInUser, which triggers sendCode and then waits on our callbacks
    client.signInUser(
      { apiId: finalApiId, apiHash: finalApiHash },
      {
        phoneNumber: cleanPhone,
        phoneCode: async () => {
          return await codePromise;
        },
        password: async () => {
          pendingSession.requiresPassword = true;
          pendingSession.status = "pending_password";
          return await passwordPromise;
        },
        onError: async (err: Error) => {
          console.error("Userbot authenticating error callback:", err);
          pendingSession.status = "error";
          pendingSession.error = err.message;
          return true; // Stop authorization
        }
      }
    ).then((user) => {
      console.log("signInUser success");
      pendingSession.status = "success";
    }).catch((err: any) => {
      console.error("signInUser background catch:", err);
      pendingSession.status = "error";
      pendingSession.error = err.message || String(err);
    });

    // Wait a brief moment to ensure client.sendCode has been executed inside client.signInUser
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (pendingSession.status === "error") {
      const friendlyError = translateTelegramError(pendingSession.error || "خطا در تنظیم و ارسال کد تایید با سرور تلگرام.");
      res.status(400).json({ error: friendlyError });
      try { await client.disconnect(); } catch (e) {}
      pendingUserbots.delete(cleanPhone);
      return;
    }

    res.json({
      success: true,
      message: "کد تایید با موفقیت ارسال شد.",
      sentCodeType: pendingSession.sentCodeType,
      emailPattern: pendingSession.emailPattern,
      codeLength: pendingSession.codeLength
    });
  } catch (err: any) {
    console.error("Failed to setup userbot code send", err);
    const friendlyError = translateTelegramError(err.message || String(err));
    res.status(500).json({ error: friendlyError });
  }
});

// 2. Verify authentication code
app.post("/api/userbot/verify-code", async (req, res) => {
  const { phoneNumber, code, password } = req.body;
  if (!phoneNumber || !code) {
    res.status(400).json({ error: "شماره تلفن و کد تایید الزامی هستند." });
    return;
  }

  const cleanPhone = String(phoneNumber).trim();
  const sessionData = pendingUserbots.get(cleanPhone);

  if (!sessionData) {
    res.status(400).json({ error: "جلسه منقضی شده یا یافت نشد. لطفا کد تایید را مجدداً درخواست کنید." });
    return;
  }

  try {
    // 1. Resolve code promise to unblock client.signInUser
    if (sessionData.resolveCode) {
      sessionData.resolveCode(String(code).trim());
    }

    // 2. Wait for status to change from "pending_code" (e.g. to "pending_password", "success", or "error")
    let checks = 0;
    while (sessionData.status === "pending_code" && checks < 40) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      checks++;
    }

    // 3. See if we require password (2FA) and password was not provided yet
    if (sessionData.status === "pending_password" && !password) {
      sessionData.requiresPassword = true;
      res.json({ success: false, requiresPassword: true, message: "رمز عبور دو مرحله‌ای (2FA) الزامی است." });
      return;
    }

    // 4. If password provided, resolve passwordPromise
    if (sessionData.status === "pending_password" && password && sessionData.resolvePassword) {
      sessionData.resolvePassword(String(password).trim());
      // Wait for status to change from pending_password to success or error
      let passChecks = 0;
      while (sessionData.status === "pending_password" && passChecks < 40) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        passChecks++;
      }
    }

    // 5. If we faced an error
    if (sessionData.status === "error") {
      throw new Error(sessionData.error || "خطای تایید هویت در سمت تلگرام.");
    }

    if (sessionData.status !== "success") {
      throw new Error("پاسخی از سرور تلگرام دریافت نشد یا تایید هویت هنوز کامل نشده است. لطفاً دوباره تلاش کنید.");
    }

    const { client } = sessionData;
    const sessionString = (client.session as any).save() as string;

    state.config.userbotApiId = String(sessionData.apiId);
    state.config.userbotApiHash = sessionData.apiHash;
    state.config.userbotSession = sessionString;
    state.config.userbotEnabled = true;

    saveState();
    pendingUserbots.delete(cleanPhone);

    await startUserbot().catch(console.error);

    res.json({ success: true, message: "ربات کاربر با موفقیت متصل و فعال شد!" });
  } catch (err: any) {
    console.error("Failed to verify userbot code", err);
    try {
      if (sessionData && sessionData.client) {
        await sessionData.client.disconnect();
      }
    } catch (e) {}
    pendingUserbots.delete(cleanPhone);
    const friendlyError = translateTelegramError(err.message || String(err));
    res.status(500).json({ error: friendlyError });
  }
});

// 3. Logout/Disconnect userbot
app.post("/api/userbot/logout", async (req, res) => {
  try {
    await stopUserbot();

    state.config.userbotApiId = undefined;
    state.config.userbotApiHash = undefined;
    state.config.userbotSession = undefined;
    state.config.userbotEnabled = false;
    saveState();

    res.json({ success: true, message: "ربات کاربر با موفقیت قطع ارتباط شد." });
  } catch (err: any) {
    console.error("Failed to logout userbot", err);
    res.status(500).json({ error: err.message || "خطا در قطع ارتباط ربات کاربر." });
  }
});

// 4. List userbot groups/dialogs
app.get("/api/userbot/dialogs", async (req, res) => {
  if (!userbotClient) {
    if (state.config.userbotSession && state.config.userbotApiId && state.config.userbotApiHash) {
      console.log("Userbot client is null but session exists. Attempting to start userbot...");
      try {
        await startUserbot();
      } catch (e) {
        res.status(400).json({ error: "ربات کاربر متصل نیست و تلاش برای راه‌اندازی خودکار با خطا مواجه شد." });
        return;
      }
    } else {
      res.status(400).json({ error: "ربات کاربر متصل نیست. لطفا ابتدا وارد حساب کاربری خود شوید." });
      return;
    }
  }

  try {
    if (userbotClient && !userbotClient.connected) {
      await userbotClient.connect();
    }
    
    // GramJS getDialogs retrieves active chats
    const dialogs = await userbotClient!.getDialogs({});
    const groups = [];
    
    for (const d of dialogs) {
      if (d.isGroup || d.isChannel) {
        let username = "";
        const entity = d.entity as any;
        if (entity && entity.username) {
          username = String(entity.username);
        }
        
        // Skip deleted, left, kicked, or empty/forbidden groups/channels
        if (entity) {
          if (entity.left || entity.kicked || entity.deactivated) continue;
          const className = entity.className || "";
          if (className.includes("Forbidden") || className.includes("Empty")) continue;
        }
        
        const title = d.title || "";
        const lowerTitle = title.toLowerCase();
        if (
          lowerTitle.includes("deleted account") || 
          lowerTitle.includes("deactivated") || 
          lowerTitle.includes("حذف شده") || 
          lowerTitle.includes("حذفی")
        ) {
          continue;
        }
        
        groups.push({
          id: String(d.id),
          title: title || "بدون نام",
          username: username,
          isChannel: !!d.isChannel
        });
      }
    }
    
    res.json({ success: true, groups });
  } catch (err: any) {
    console.error("Failed to fetch userbot dialogs", err);
    res.status(500).json({ error: err.message || "خطا در دریافت لیست گروه‌ها از تلگرام." });
  }
});

app.post("/api/bot/stop", (req, res) => {
  loadState(true);
  if (bot) {
    try { bot.stop(); } catch(e) {}
  }
  state.isRunning = false;
  saveState();
  res.json({ success: true, isRunning: false });
});

app.post("/api/bot/start", async (req, res) => {
  loadState(true);
  state.isRunning = true;
  saveState();
  const started = await startBot();
  res.json({ success: started, isRunning: state.isRunning });
});

app.post("/api/inventory", (req, res) => {
  loadState(true);
  if (!Array.isArray(req.body)) {
    res.status(400).json({ error: "Invalid inventory format" });
    return;
  }
  state.inventory = req.body;
  saveState();
  res.json({ success: true, inventoryCount: state.inventory.length });
});

app.post("/api/customers", (req, res) => {
  loadState(true);
  if (!Array.isArray(req.body)) {
    res.status(400).json({ error: "Invalid customers format" });
    return;
  }
  state.customers = req.body;
  saveState();
  res.json({ success: true, count: state.customers.length });
});

app.get("/api/user-rules", (req, res) => {
  loadState(true);
  res.json({ success: true, rules: state.config.userRules || [] });
});

app.post("/api/user-rules", (req, res) => {
  loadState(true);
  const rules = req.body?.rules || req.body;
  if (!Array.isArray(rules)) {
    res.status(400).json({ error: "فرمت لیست قوانین نامعتبر است." });
    return;
  }
  state.config.userRules = rules;
  saveState();
  res.json({ success: true, count: state.config.userRules.length, rules: state.config.userRules });
});

// JSON Backup Download (Timed / Timestamped)
app.get("/api/backup/download-json", (req, res) => {
  try {
    const { backupData, filename } = generateFullBackup();
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backupData, null, 2));
  } catch (err: any) {
    console.error("Failed to generate JSON backup:", err);
    res.status(500).json({ error: "خطا در تولید فایل پشتیبان JSON: " + err.message });
  }
});

// System Health Endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    isRunning: state.isRunning,
    port: PORT
  });
});

// Git Status & System Diagnostics
app.get("/api/system/git-status", (req, res) => {
  const envRepo = process.env.GITHUB_REPO_URL || "https://github.com/meh732/-.git";
  let remoteUrl = envRepo;
  let branch = "main";
  let commitHash = "";
  let commitMessage = "";
  let commitAuthor = "";
  let commitDate = "";
  let isGitRepo = false;

  try {
    if (fs.existsSync(path.join(process.cwd(), ".git"))) {
      isGitRepo = true;
      try {
        const origin = execSync("git config --get remote.origin.url", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
        if (origin) remoteUrl = origin;
      } catch (e) {}

      try {
        const b = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
        if (b) branch = b;
      } catch (e) {}

      try {
        commitHash = execSync("git log -1 --format=%h", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
        commitMessage = execSync("git log -1 --format=%s", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
        commitAuthor = execSync("git log -1 --format=%an", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
        commitDate = execSync("git log -1 --format=%cd", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
      } catch (e) {}
    }
  } catch (err: any) {
    console.warn("Git status inspection note:", err.message);
  }

  res.json({
    success: true,
    isGitRepo,
    repoUrl: remoteUrl || envRepo,
    branch,
    commitHash: commitHash || "v1.0.0-prod",
    commitMessage: commitMessage || "Initial release",
    commitAuthor: commitAuthor || "Maintainer",
    commitDate: commitDate || new Date().toLocaleString("fa-IR"),
    nodeVersion: process.version,
    platform: process.platform,
    port: PORT,
    botRunning: state.isRunning,
    userbotActive: !!userbotClient?.connected
  });
});

// Update Git Repository URL
app.post("/api/system/git-config", (req, res) => {
  const { repoUrl } = req.body || {};
  if (!repoUrl || typeof repoUrl !== "string") {
    return res.status(400).json({ error: "آدرس مخزن گیت‌هاب معتبر نیست." });
  }

  const cleanUrl = repoUrl.trim();
  process.env.GITHUB_REPO_URL = cleanUrl;

  try {
    const envPath = path.join(process.cwd(), ".env");
    let content = "";
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf8");
    }

    if (content.includes("GITHUB_REPO_URL=")) {
      content = content.replace(/GITHUB_REPO_URL=.*/g, `GITHUB_REPO_URL=${cleanUrl}`);
    } else {
      content = `${content.trim()}\nGITHUB_REPO_URL=${cleanUrl}\n`;
    }
    fs.writeFileSync(envPath, content, "utf8");

    if (fs.existsSync(path.join(process.cwd(), ".git"))) {
      try {
        execSync(`git remote set-url origin "${cleanUrl}"`, { stdio: ["pipe", "pipe", "ignore"] });
      } catch (e) {
        try {
          execSync(`git remote add origin "${cleanUrl}"`, { stdio: ["pipe", "pipe", "ignore"] });
        } catch (err) {}
      }
    }

    console.log(`[Git Config] Updated GitHub repository URL to: ${cleanUrl}`);
    res.json({ success: true, message: "آدرس مخزن گیت‌هاب با موفقیت بروز شد.", repoUrl: cleanUrl });
  } catch (err: any) {
    console.error("Failed to update git config:", err);
    res.status(500).json({ error: "خطا در ذخیره آدرس گیت‌هاب: " + err.message });
  }
});

// Perform Git Update from Web Dashboard
app.post("/api/system/git-update", (req, res) => {
  const logs: string[] = [];
  const addLog = (msg: string) => {
    logs.push(`[${new Date().toLocaleTimeString('fa-IR')}] ${msg}`);
    console.log(`[Git Update] ${msg}`);
  };

  addLog("شروع فرآیند بروزرسانی از مخزن گیت‌هاب...");

  const repoUrl = (req.body?.repoUrl || process.env.GITHUB_REPO_URL || "https://github.com/meh732/-.git").trim();
  addLog(`مخزن هدف: ${repoUrl}`);

  try {
    // 1. Git pull
    if (fs.existsSync(path.join(process.cwd(), ".git"))) {
      addLog("دریافت آخرین کدهای ثبت شده از Git...");
      try {
        execSync(`git remote set-url origin "${repoUrl}"`, { stdio: ["pipe", "pipe", "ignore"] });
      } catch (e) {}

      try {
        const pullOutput = execSync("git pull origin main || git pull origin master || git pull", { encoding: "utf8", shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });
        addLog(`نتیجه دریافت: ${pullOutput.trim()}`);
      } catch (pullErr: any) {
        addLog(`هشدار pull: ${pullErr.message}. تلاش با git fetch...`);
        try {
          execSync("git fetch --all && (git reset --hard origin/main || git reset --hard origin/master)", { stdio: ["pipe", "pipe", "ignore"], shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });
          addLog("هماهنگ‌سازی با آخرین کامیت گیت‌هاب انجام شد.");
        } catch (resetErr: any) {
          addLog(`نکته: بروزرسانی سورس با فایل‌های فعلی ادامه می‌یابد (${resetErr.message})`);
        }
      }
    } else {
      addLog("محیط پوشه .git مستقل نیست؛ بروزرسانی بسته‌ها و کامپایل مجدد آغاز شد.");
    }

    // 2. Build assets
    addLog("کامپایل و بهینه‌سازی دارایی‌های وب و سرور (npm run build)...");
    try {
      execSync("npm run build", { stdio: "inherit" });
      addLog("✅ بیلد و کامپایل با موفقیت پایان یافت.");
    } catch (buildErr: any) {
      addLog(`نکته بیلد: ${buildErr.message}`);
    }

    addLog("🎉 فرآیند بروزرسانی کامل شد. تنظیمات اعمال گردیدند.");

    res.json({
      success: true,
      message: "بروزرسانی از گیت‌هاب با موفقیت انجام شد!",
      logs,
      updatedAt: new Date().toISOString()
    });
  } catch (err: any) {
    addLog(`❌ خطا در بروزرسانی: ${err.message}`);
    res.status(500).json({
      success: false,
      error: "خطا در اجرای فرآیند بروزرسانی: " + err.message,
      logs
    });
  }
});

// Restart Service or Bot from UI
app.post("/api/system/service-action", async (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === "restart") {
      console.log("[Service Action] Restarting Bot and Userbot...");
      loadState(true);
      if (bot) {
        try { bot.stop(); } catch (e) {}
      }
      if (userbotClient) {
        try { await userbotClient.disconnect(); } catch (e) {}
      }

      state.isRunning = true;
      saveState();

      await startBot().catch(console.error);
      if (state.config.userbotEnabled && state.config.userbotSession) {
        await startUserbot().catch(console.error);
      }

      res.json({ success: true, message: "سرویس‌های ربات و مانیتورینگ با موفقیت مجدداً راه‌اندازی شدند." });
    } else if (action === "stop") {
      console.log("[Service Action] Stopping services...");
      loadState(true);
      if (bot) {
        try { bot.stop(); } catch (e) {}
      }
      if (userbotClient) {
        try { await userbotClient.disconnect(); } catch (e) {}
      }
      state.isRunning = false;
      saveState();
      res.json({ success: true, message: "سرویس‌های ربات متوقف شدند." });
    } else {
      res.json({
        success: true,
        isRunning: state.isRunning,
        userbotConnected: !!userbotClient?.connected
      });
    }
  } catch (err: any) {
    console.error("Failed service action:", err);
    res.status(500).json({ error: "خطا در اجرای دستور سرویس: " + err.message });
  }
});

// Live System Logs API
app.get("/api/system/logs", (req, res) => {
  res.json({
    success: true,
    logs: systemLogBuffer,
    count: systemLogBuffer.length
  });
});

// Download Windows & PC Management Scripts Package (ZIP)
app.get("/api/system/download-scripts-zip", (req, res) => {
  try {
    const zip = new AdmZip();
    const filesToInclude = [
      "menu.bat",
      "manager.bat",
      "menu.js",
      "install.bat",
      "start.bat",
      "stop.bat",
      "install-windows-service.bat",
      "uninstall-windows-service.bat",
      "run-hidden.vbs",
      "windows-service-install.js",
      "windows-service-uninstall.js",
      "setup.js",
      "install.sh",
      ".env.example"
    ];

    for (const fileName of filesToInclude) {
      const fullPath = path.join(process.cwd(), fileName);
      if (fs.existsSync(fullPath)) {
        zip.addLocalFile(fullPath);
      }
    }

    // Add a helpful README.txt inside the zip
    const readmeContent = `================================================================
Telegram Inventory Bot - Windows & PC Management Package
سامانه مدیریت، نصب و بروزرسانی ربات تلگرام در کامپیوتر ویندوز
================================================================

راهنمای سریع استفاده در کامپیوتر:
1. برای باز کردن منوی تعاملی و هوشمند (مشابه لینوکس):
   - روی فایل menu.bat یا manager.bat دو بار کلیک کنید.
   
2. امکانات منو:
   - دریافت آدرس گیت‌هاب و نصب کامل خودکار (گزینه 1)
   - بروزرسانی سریع آخرین کدها از گیت‌هاب (گزینه 2)
   - تغییر آدرس مخزن گیت‌هاب (گزینه 3)
   - راه‌اندازی، توقف و بررسی وضعیت سلامت ربات (گزینه‌های 4، 5 و 6)
   - تنظیم پورت، پروکسی ضد فیلتر و متغیرهای سرور (گزینه 8)
   - اجرای نامرئی و خودکار پس‌زمینه در ویندوز (گزینه 9)

3. برای شروع سریع سرور:
   - فایل start.bat را اجرا کنید تا وب‌پنل در مرورگر باز شود.
================================================================
`;
    zip.addFile("README.txt", Buffer.from(readmeContent, "utf8"));

    const zipBuffer = zip.toBuffer();
    res.setHeader("Content-Disposition", 'attachment; filename="telegram-inventory-pc-manager.zip"');
    res.setHeader("Content-Type", "application/zip");
    res.send(zipBuffer);
  } catch (err: any) {
    console.error("Failed to generate scripts zip:", err);
    res.status(500).json({ error: "خطا در تولید فایل فشرده اسکریپت‌ها: " + err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === "development") {
    const vite = await import("vite").then(m => (m as any).createServer({
      server: { middlewareMode: true },
      appType: "spa",
    }));
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Support Vue/React router proxy to index.html
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (typeof PORT === "string" && (PORT.startsWith("/") || PORT.startsWith("\\") || !/^\d+$/.test(PORT))) {
    // Unix domain socket for cPanel / Phusion Passenger (or named socket)
    app.listen(PORT, () => {
      console.log(`Server running on Unix socket: ${PORT}`);
    });
  } else {
    // Standard TCP port
    const numericPort = Number(PORT) || 3000;
    app.listen(numericPort, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${numericPort}`);
    });
  }
}

startServer();
