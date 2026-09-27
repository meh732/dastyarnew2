import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  Bot, Upload, Settings, List, Save, Play, Square, Server, CheckCircle2, 
  AlertCircle, Info, Users, Plus, Edit, Trash, FileDown, DownloadCloud, 
  Globe, Wifi, RefreshCw, Star, Ban, ShieldCheck, UserCheck, UserX, Copy, Check, Filter, Search, ArrowRight,
  Database, FolderArchive, Clock, FileText, CheckSquare, Sparkles, Terminal, Laptop, GitBranch, GitPullRequest,
  HardDrive, Cpu, Activity, ExternalLink, ArrowDownToLine, Wrench
} from 'lucide-react';
import type { AppState, BotConfig, InventoryItem, CustomerRequest, UserRule, FullBackupData, GitStatusInfo, SystemLogEntry } from './types';

const normalizePersianArabicNumbers = (str: string | undefined | null): string => {
  if (!str) return "";
  const persianNumbers = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicNumbers  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let res = String(str);
  for (let i = 0; i < 10; i++) {
    res = res.replace(persianNumbers[i], String(i)).replace(arabicNumbers[i], String(i));
  }
  res = res.replace(/ي/g, "ی").replace(/ك/g, "ک");
  res = res.replace(/[\u200c\u200d\u200e\u200f\u0640\ufeff]/g, " ");
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

export default function App() {
  const [activeTab, setActiveTab] = useState<'settings' | 'inventory' | 'customers' | 'rules' | 'backups' | 'system_manager'>('settings');
  const [state, setState] = useState<AppState>({
    config: { token: '', adminId: '', groupId: '', customerMessage: '', groupAccess: 'all', userRules: [] },
    inventory: [],
    customers: [],
    isRunning: false,
    groups: []
  });
  const [config, setConfig] = useState<BotConfig>({
    token: '',
    adminId: '',
    groupId: '',
    customerMessage: '',
    groupAccess: 'all',
    botEnabled: true,
    disableCustomerPm: false,
    userbotApiId: '',
    userbotApiHash: '',
    userbotSession: '',
    userbotEnabled: false,
    userbotGroups: '',
    proxyUrl: '',
    userRules: []
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // States for Git & PC Management Console
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [gitRepoInput, setGitRepoInput] = useState('');
  const [isSavingGitRepo, setIsSavingGitRepo] = useState(false);
  const [isUpdatingGit, setIsUpdatingGit] = useState(false);
  const [gitUpdateLogs, setGitUpdateLogs] = useState<string[]>([]);
  const [gitUpdateSuccess, setGitUpdateSuccess] = useState<boolean | null>(null);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const [isExecutingServiceAction, setIsExecutingServiceAction] = useState(false);

  // States for Proxy testing
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // States for interactive Userbot registration & configuration
  const [userbotPhone, setUserbotPhone] = useState('');
  const [userbotApiIdInput, setUserbotApiIdInput] = useState('');
  const [userbotApiHashInput, setUserbotApiHashInput] = useState('');
  const [userbotStep, setUserbotStep] = useState<'request_code' | 'verify_code'>('request_code');
  const [userbotCodeInput, setUserbotCodeInput] = useState('');
  const [userbot2FaInput, setUserbot2FaInput] = useState('');
  const [userbotStatusMsg, setUserbotStatusMsg] = useState('');
  const [userbotIsConnecting, setUserbotIsConnecting] = useState(false);
  const [userbotUseBypass, setUserbotUseBypass] = useState(true);
  const [userbotSentCodeType, setUserbotSentCodeType] = useState<string | null>(null);
  const [userbotEmailPattern, setUserbotEmailPattern] = useState<string | null>(null);
  const [userbotCodeLength, setUserbotCodeLength] = useState<number | null>(null);

  // Userbot Dialogs selection states
  const [dialogGroups, setDialogGroups] = useState<Array<{ id: string, title: string, username?: string, isChannel?: boolean }>>([]);
  const [isLoadingDialogs, setIsLoadingDialogs] = useState(false);
  const [dialogSearch, setDialogSearch] = useState('');

  // States for manual product entry
  const [manualCode, setManualCode] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStock, setManualStock] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // States for User Rules (VIP / Blacklist)
  const [ruleTarget, setRuleTarget] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [ruleAction, setRuleAction] = useState<'ALWAYS_NOTIFY' | 'NEVER_NOTIFY'>('ALWAYS_NOTIFY');
  const [ruleForward, setRuleForward] = useState(true);
  const [ruleNotes, setRuleNotes] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleFilter, setRuleFilter] = useState<'ALL' | 'ALWAYS_NOTIFY' | 'NEVER_NOTIFY'>('ALL');
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);

  // States for Backup & Restore Engine
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [backupPreview, setBackupPreview] = useState<FullBackupData | null>(null);
  const [jsonFileName, setJsonFileName] = useState('');

  useEffect(() => {
    fetchState();
  }, []);

  const fetchDialogGroups = async () => {
    setIsLoadingDialogs(true);
    try {
      const res = await fetch('/api/userbot/dialogs');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.groups) {
          setDialogGroups(data.groups);
        }
      }
    } catch (err) {
      console.error("Failed to load userbot dialogs:", err);
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const handleToggleGroup = (groupId: string) => {
    const currentGroups = config.userbotGroups
      ? config.userbotGroups.split(',').map(x => x.trim()).filter(Boolean)
      : [];
    
    let updated: string[];
    if (currentGroups.includes(groupId)) {
      updated = currentGroups.filter(g => g !== groupId);
    } else {
      updated = [...currentGroups, groupId];
    }
    
    setConfig(prev => ({
      ...prev,
      userbotGroups: updated.join(', ')
    }));
  };

  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      const data: AppState = await res.json();
      
      let needsRestore = false;
      let restoredConfig = data.config;

      // 1. Auto-restore configuration if container restarted and wiped state on ephemeral container disk
      if (!data.config?.token || !data.config?.adminId) {
        const backupStr = localStorage.getItem('bot_config_backup');
        if (backupStr) {
          try {
            const backupConfig = JSON.parse(backupStr);
            if (backupConfig.token && backupConfig.adminId) {
              console.log("Restoring bot configuration from browser localStorage backup...");
              const restoreRes = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backupConfig),
              });
              if (restoreRes.ok) {
                restoredConfig = backupConfig;
                needsRestore = true;
              }
            }
          } catch (e) {
            console.error("Failed to restore config backup from localStorage", e);
          }
        }
      } else {
        // We have valid server-side config. Store it in localStorage as a backup
        localStorage.setItem('bot_config_backup', JSON.stringify(data.config));
      }

      // 2. Auto-restore inventory if empty and we have a valid config token
      if ((!data.inventory || data.inventory.length === 0) && restoredConfig?.token) {
        const backupInvStr = localStorage.getItem('bot_inventory_backup');
        if (backupInvStr) {
          try {
            const backupInv = JSON.parse(backupInvStr);
            if (Array.isArray(backupInv) && backupInv.length > 0) {
              console.log("Restoring inventory from browser localStorage backup...");
              const restoreInvRes = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backupInv),
              });
              if (restoreInvRes.ok) {
                needsRestore = true;
              }
            }
          } catch (e) {
            console.error("Failed to restore inventory backup from localStorage", e);
          }
        }
      } else if (data.inventory && data.inventory.length > 0) {
        // We have valid server-side inventory. Store it in localStorage as a backup
        localStorage.setItem('bot_inventory_backup', JSON.stringify(data.inventory));
      }

      // 3. Auto-restore customers if empty
      if ((!data.customers || data.customers.length === 0) && restoredConfig?.token) {
        const backupCustStr = localStorage.getItem('bot_customers_backup');
        if (backupCustStr) {
          try {
            const backupCust = JSON.parse(backupCustStr);
            if (Array.isArray(backupCust) && backupCust.length > 0) {
              console.log("Restoring customers from browser localStorage backup...");
              const restoreCustRes = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backupCust),
              });
              if (restoreCustRes.ok) {
                needsRestore = true;
              }
            }
          } catch (e) {
            console.error("Failed to restore customers backup from localStorage", e);
          }
        }
      } else if (data.customers && data.customers.length > 0) {
        // We have valid server-side customers. Store it in localStorage as a backup
        localStorage.setItem('bot_customers_backup', JSON.stringify(data.customers));
      }

      // 4. Auto-restore user rules if empty
      if ((!data.config?.userRules || data.config.userRules.length === 0) && restoredConfig?.token) {
        const backupRulesStr = localStorage.getItem('bot_rules_backup');
        if (backupRulesStr) {
          try {
            const backupRules = JSON.parse(backupRulesStr);
            if (Array.isArray(backupRules) && backupRules.length > 0) {
              console.log("Restoring user rules from browser localStorage backup...");
              const restoreRulesRes = await fetch('/api/user-rules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backupRules),
              });
              if (restoreRulesRes.ok) {
                needsRestore = true;
              }
            }
          } catch (e) {
            console.error("Failed to restore user rules backup from localStorage", e);
          }
        }
      } else if (data.config?.userRules && data.config.userRules.length > 0) {
        localStorage.setItem('bot_rules_backup', JSON.stringify(data.config.userRules));
      }

      if (needsRestore) {
        // Re-fetch state once restore triggers complete
        setTimeout(() => {
          fetchState();
        }, 150);
        return;
      }

      setState(data);
      
      const loadedApiId = data.config?.userbotApiId || '';
      const loadedApiHash = data.config?.userbotApiHash || '';
      
      setUserbotApiIdInput(loadedApiId);
      setUserbotApiHashInput(loadedApiHash);

      setConfig({
        token: data.config?.token || '',
        adminId: data.config?.adminId || '',
        groupId: data.config?.groupId || '',
        customerMessage: data.config?.customerMessage || '',
        groupAccess: data.config?.groupAccess || 'all',
        botEnabled: data.config?.botEnabled !== false,
        disableCustomerPm: !!data.config?.disableCustomerPm,
        userbotApiId: loadedApiId,
        userbotApiHash: loadedApiHash,
        userbotSession: data.config?.userbotSession || '',
        userbotEnabled: data.config?.userbotEnabled !== false,
        userbotGroups: data.config?.userbotGroups || '',
        proxyUrl: data.config?.proxyUrl || '',
        userRules: data.config?.userRules || []
      });

      if (data.config?.userbotSession) {
        // Fetch groups list on mount if already has session
        setTimeout(() => {
          fetchDialogGroups();
        }, 100);
      }
    } catch (err) {
      console.error(err);
      showMessage('خطا در دریافت اطلاعات از سرور', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'system_manager') {
      fetchGitStatus();
      fetchSystemLogs();
    }
  }, [activeTab]);

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const downloadSampleExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const sheetData = [
        ["کد", "نام", "موجودی"],
        ["SH-101", "تیشرت مشکی مردانه", "15"],
        ["SH-102", "شلوار جین آبی", "5"],
        ["SH-103", "کفش ورزشی سفید (موجودی صفر یعنی ناموجود)", "0"],
        ["SH-104", "جوراب نخی (نام اختیاری - بدون موجودی یعنی موجود)", ""]
      ];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, "Inventory_Template");
      XLSX.writeFile(wb, "Inventory_Sample_Template.xlsx");
      showMessage('فایل نمونه اکسل با موفقیت دانلود شد', 'success');
    } catch (err) {
      showMessage('خطا در ایجاد و دانلود فایل نمونه', 'error');
    }
  };

  const handleAddOrUpdateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) {
      showMessage('کد کالا الزامی است', 'error');
      return;
    }
    
    if (!state) return;
    
    const formattedCode = manualCode.trim();
    const formattedName = manualName.trim() || 'بدون نام';
    const formattedStock = manualStock.trim() === '' ? 1 : Number(manualStock);

    let updatedInventory = [...(state.inventory || [])];
    const existingIndex = updatedInventory.findIndex(item => sanitizeCode(item.code) === sanitizeCode(formattedCode));

    if (existingIndex !== -1) {
      // Update existing
      updatedInventory[existingIndex] = {
        code: formattedCode,
        name: formattedName,
        stock: formattedStock
      };
      showMessage('کالا با موفقیت بروزرسانی شد', 'success');
    } else {
      // Add new
      updatedInventory.push({
        code: formattedCode,
        name: formattedName,
        stock: formattedStock
      });
      showMessage('کالا جدید با موفقیت اضافه شد', 'success');
    }

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedInventory),
      });
      if (res.ok) {
        setState(prev => ({ ...prev, inventory: updatedInventory }));
        localStorage.setItem('bot_inventory_backup', JSON.stringify(updatedInventory));
        setManualCode('');
        setManualName('');
        setManualStock('');
        setIsEditing(false);
      } else {
         showMessage('خطا در همگام‌سازی با سرور', 'error');
      }
    } catch (err) {
       showMessage('خطا در ذخیره کالای جدید', 'error');
    }
  };

  const handleDeleteItem = async (codeToDelete: string) => {
    if (!state) return;
    if (!window.confirm('آیا از حذف این کالا اطمینان دارید؟')) return;

    const querySanitized = sanitizeCode(codeToDelete);
    const updatedInventory = (state.inventory || []).filter(item => {
      return item.code !== codeToDelete && sanitizeCode(item.code) !== querySanitized && sanitizeCode(item.name) !== querySanitized;
    });

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedInventory),
      });
      if (res.ok) {
        setState(prev => ({ ...prev, inventory: updatedInventory }));
        localStorage.setItem('bot_inventory_backup', JSON.stringify(updatedInventory));
        showMessage('کالا با موفقیت حذف شد', 'success');
      } else {
        showMessage('خطا در بروزرسانی لیست کالاها روی هاست', 'error');
      }
    } catch (err) {
      showMessage('خطا در برقراری ارتباط با سرور', 'error');
    }
  };

  const handleSelectForEdit = (item: InventoryItem) => {
    setManualCode(String(item.code || ''));
    setManualName(item.name === 'بدون نام' ? '' : item.name);
    setManualStock(String(item.stock));
    setIsEditing(true);
  };

  const handleAddOrUpdateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClean = ruleTarget.trim();
    if (!targetClean) {
      showMessage('لطفاً آیدی عددی یا یوزرنیم شخص را وارد کنید.', 'error');
      return;
    }

    const existingRules = [...(config.userRules || [])];
    let updatedRules: UserRule[];

    if (editingRuleId) {
      updatedRules = existingRules.map(r => {
        if (r.id === editingRuleId) {
          return {
            ...r,
            target: targetClean,
            name: ruleName.trim() || (ruleAction === 'ALWAYS_NOTIFY' ? 'شخص ویژه (VIP)' : 'بلاک‌شده'),
            action: ruleAction,
            forwardMessage: ruleForward,
            notes: ruleNotes.trim()
          };
        }
        return r;
      });
      showMessage('قانون شخص با موفقیت بروزرسانی شد.', 'success');
    } else {
      const newRule: UserRule = {
        id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        target: targetClean,
        name: ruleName.trim() || (ruleAction === 'ALWAYS_NOTIFY' ? 'شخص ویژه (VIP)' : 'بلاک‌شده'),
        action: ruleAction,
        enabled: true,
        forwardMessage: ruleForward,
        notes: ruleNotes.trim(),
        createdAt: new Date().toISOString()
      };
      updatedRules = [newRule, ...existingRules];
      showMessage('قانون جدید با موفقیت اضافه شد.', 'success');
    }

    setConfig(prev => ({ ...prev, userRules: updatedRules }));
    setState(prev => prev ? { ...prev, config: { ...prev.config, userRules: updatedRules } } : null);
    localStorage.setItem('bot_rules_backup', JSON.stringify(updatedRules));

    try {
      await fetch('/api/user-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRules)
      });
    } catch (err) {
      console.error('Failed to save rules to server:', err);
    }

    // Reset form
    setRuleTarget('');
    setRuleName('');
    setRuleAction('ALWAYS_NOTIFY');
    setRuleForward(true);
    setRuleNotes('');
    setEditingRuleId(null);
  };

  const handleToggleRule = async (ruleId: string) => {
    const existingRules = [...(config.userRules || [])];
    const updatedRules = existingRules.map(r => {
      if (r.id === ruleId) {
        return { ...r, enabled: r.enabled === false ? true : false };
      }
      return r;
    });

    setConfig(prev => ({ ...prev, userRules: updatedRules }));
    setState(prev => prev ? { ...prev, config: { ...prev.config, userRules: updatedRules } } : null);
    localStorage.setItem('bot_rules_backup', JSON.stringify(updatedRules));

    try {
      await fetch('/api/user-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRules)
      });
      showMessage('وضعیت قانون تغییر یافت.', 'success');
    } catch (err) {
      showMessage('خطا در ذخیره تغییرات وضعیت.', 'error');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm('آیا از حذف این قانون اطمینان دارید؟')) return;
    const existingRules = [...(config.userRules || [])];
    const updatedRules = existingRules.filter(r => r.id !== ruleId);

    setConfig(prev => ({ ...prev, userRules: updatedRules }));
    setState(prev => prev ? { ...prev, config: { ...prev.config, userRules: updatedRules } } : null);
    localStorage.setItem('bot_rules_backup', JSON.stringify(updatedRules));

    if (editingRuleId === ruleId) {
      setRuleTarget('');
      setRuleName('');
      setRuleAction('ALWAYS_NOTIFY');
      setRuleForward(true);
      setRuleNotes('');
      setEditingRuleId(null);
    }

    try {
      await fetch('/api/user-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRules)
      });
      showMessage('قانون با موفقیت حذف شد.', 'success');
    } catch (err) {
      showMessage('خطا در حذف قانون.', 'error');
    }
  };

  const handleSelectForEditRule = (rule: UserRule) => {
    setRuleTarget(rule.target);
    setRuleName(rule.name || '');
    setRuleAction(rule.action);
    setRuleForward(rule.forwardMessage !== false);
    setRuleNotes(rule.notes || '');
    setEditingRuleId(rule.id);
  };

  const handleCancelEditRule = () => {
    setRuleTarget('');
    setRuleName('');
    setRuleAction('ALWAYS_NOTIFY');
    setRuleForward(true);
    setRuleNotes('');
    setEditingRuleId(null);
  };

  const handleDownloadJsonBackup = () => {
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeFormatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      
      let persianDate = "";
      try {
        persianDate = new Intl.DateTimeFormat('fa-IR', {
          dateStyle: 'full',
          timeStyle: 'medium',
          timeZone: 'Asia/Tehran'
        }).format(now);
      } catch (e) {
        persianDate = now.toLocaleString('fa-IR');
      }

      const backupData: FullBackupData = {
        app: "robotdatyar",
        version: "2.0.0",
        backupTimestamp: now.toISOString(),
        backupDatePersian: persianDate,
        summary: {
          inventoryCount: (state?.inventory || []).length,
          userRulesCount: (config.userRules || []).length,
          customersCount: (state?.customers || []).length,
          groupsCount: (state?.groups || []).length
        },
        inventory: state?.inventory || [],
        userRules: config.userRules || [],
        config: {
          adminId: config.adminId,
          groupId: config.groupId,
          customerMessage: config.customerMessage,
          groupAccess: config.groupAccess,
          botEnabled: config.botEnabled,
          disableCustomerPm: config.disableCustomerPm,
          userbotEnabled: config.userbotEnabled,
          userbotGroups: config.userbotGroups,
          proxyUrl: config.proxyUrl
        },
        customers: state?.customers || [],
        groups: state?.groups || []
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `robotdatyar_backup_${timeFormatted}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showMessage(`فایل پشتیبان کامل JSON با نام robotdatyar_backup_${timeFormatted}.json با موفقیت دانلود شد.`, 'success');
    } catch (err: any) {
      console.error(err);
      showMessage('خطا در تولید فایل پشتیبان JSON', 'error');
    }
  };

  const handleDownloadExcelBackup = () => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Inventory
      const wsInv = XLSX.utils.json_to_sheet(state?.inventory || []);
      XLSX.utils.book_append_sheet(wb, wsInv, "Inventory");

      // Sheet 2: UserRules
      const wsRules = XLSX.utils.json_to_sheet(config.userRules || []);
      XLSX.utils.book_append_sheet(wb, wsRules, "UserRules");

      // Sheet 3: Customers
      const wsCust = XLSX.utils.json_to_sheet(state?.customers || []);
      XLSX.utils.book_append_sheet(wb, wsCust, "Customers");

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeFormatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      XLSX.writeFile(wb, `robotdatyar_backup_${timeFormatted}.xlsx`);
      showMessage('فایل پشتیبان اکسل با موفقیت دانلود شد.', 'success');
    } catch (err: any) {
      console.error(err);
      showMessage('خطا در ساخت فایل اکسل پشتیبان', 'error');
    }
  };

  const handleJsonFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setJsonFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed: FullBackupData = JSON.parse(content);

        if (!parsed || typeof parsed !== 'object') {
          throw new Error('فایل انتخاب‌شده یک JSON معتبر نیست.');
        }

        const invCount = Array.isArray(parsed.inventory) ? parsed.inventory.length : 0;
        const rulesCount = Array.isArray(parsed.userRules) 
          ? parsed.userRules.length 
          : (Array.isArray(parsed.config?.userRules) ? parsed.config.userRules.length : 0);
        const custCount = Array.isArray(parsed.customers) ? parsed.customers.length : 0;

        if (invCount === 0 && rulesCount === 0 && !parsed.config) {
          throw new Error('فایل JSON شامل اطلاعات سازگار با ساختار پشتیبان ربات نمی‌باشد.');
        }

        setBackupPreview({
          app: parsed.app || "robotdatyar",
          version: parsed.version || "2.0.0",
          backupTimestamp: parsed.backupTimestamp || new Date().toISOString(),
          backupDatePersian: parsed.backupDatePersian || new Date().toLocaleDateString('fa-IR'),
          summary: {
            inventoryCount: invCount,
            userRulesCount: rulesCount,
            customersCount: custCount,
            groupsCount: Array.isArray(parsed.groups) ? parsed.groups.length : 0
          },
          inventory: parsed.inventory || [],
          userRules: parsed.userRules || parsed.config?.userRules || [],
          config: parsed.config || {},
          customers: parsed.customers || [],
          groups: parsed.groups || []
        });

        showMessage(`فایل ${file.name} بررسی شد. پیش‌نمایش آماده بازگردانی است.`, 'success');
      } catch (err: any) {
        setBackupPreview(null);
        showMessage(err.message || 'خطا در بررسی فایل JSON', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmRestoreJson = async () => {
    if (!backupPreview) return;
    setIsRestoringBackup(true);
    try {
      const res = await fetch('/api/backup/restore-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupPreview),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Sync local storage backups
        if (backupPreview.inventory && backupPreview.inventory.length > 0) {
          localStorage.setItem('bot_inventory_backup', JSON.stringify(backupPreview.inventory));
        }
        if (backupPreview.userRules && backupPreview.userRules.length > 0) {
          localStorage.setItem('bot_rules_backup', JSON.stringify(backupPreview.userRules));
        }
        if (backupPreview.config && backupPreview.config.token) {
          localStorage.setItem('bot_config_backup', JSON.stringify({ ...config, ...backupPreview.config }));
        }

        showMessage('🎉 بازگردانی اطلاعات پشتیبان با موفقیت کامل انجام شد!', 'success');
        setBackupPreview(null);
        setJsonFileName('');
        await fetchState();
      } else {
        showMessage(data.error || 'خطا در اعمال نسخه پشتیبان روی سرور', 'error');
      }
    } catch (err: any) {
      console.error(err);
      showMessage('خطا در برقراری ارتباط با سرور برای بازگردانی', 'error');
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleCancelRestoreJson = () => {
    setBackupPreview(null);
    setJsonFileName('');
  };

  const handleSaveConfig = async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setState(prev => prev ? { ...prev, config, isRunning: data.isRunning } : null);
      showMessage('تنظیمات با موفقیت ذخیره شد!', 'success');
    } catch (err) {
      showMessage('خطا در ذخیره تنظیمات', 'error');
    }
  };

  const handleTestProxy = async () => {
    if (!config.proxyUrl || !config.proxyUrl.trim()) {
      setProxyTestResult({
        success: false,
        message: 'لطفاً ابتدا آدرس یا پورت پروکسی را وارد کنید (یا از گزینه‌های آماده زیر انتخاب نمایید).'
      });
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const res = await fetch('/api/proxy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyUrl: config.proxyUrl })
      });
      const data = await res.json();
      if (data.success) {
        setProxyTestResult({ success: true, message: data.message });
      } else {
        setProxyTestResult({ success: false, message: data.error || 'خطا در اتصال به تلگرام از طریق پروکسی' });
      }
    } catch (err: any) {
      setProxyTestResult({ success: false, message: 'خطا در ارتباط با سرور یا انقضای مهلت اتصال.' });
    } finally {
      setIsTestingProxy(false);
    }
  };

  const fetchGitStatus = async () => {
    try {
      const res = await fetch('/api/system/git-status');
      const data = await res.json();
      if (data.success) {
        setGitStatus(data);
        if (!gitRepoInput && data.repoUrl) {
          setGitRepoInput(data.repoUrl);
        }
      }
    } catch (err) {
      console.error('Failed to fetch git status', err);
    }
  };

  const fetchSystemLogs = async () => {
    setIsRefreshingLogs(true);
    try {
      const res = await fetch('/api/system/logs');
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        setSystemLogs(data.logs);
      }
    } catch (err) {
      console.error('Failed to fetch system logs', err);
    } finally {
      setIsRefreshingLogs(false);
    }
  };

  const handleSaveGitRepo = async () => {
    if (!gitRepoInput.trim()) {
      showMessage('لطفاً آدرس مخزن گیت‌هاب را وارد کنید.', 'error');
      return;
    }
    setIsSavingGitRepo(true);
    try {
      const res = await fetch('/api/system/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: gitRepoInput.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage('آدرس مخزن گیت‌هاب با موفقیت ذخیره شد!', 'success');
        fetchGitStatus();
      } else {
        showMessage(data.error || 'خطا در ذخیره آدرس گیت‌هاب', 'error');
      }
    } catch (err: any) {
      showMessage('خطا در ارتباط با سرور', 'error');
    } finally {
      setIsSavingGitRepo(false);
    }
  };

  const handleRunGitUpdate = async () => {
    setIsUpdatingGit(true);
    setGitUpdateLogs(['[شروع] برقراری ارتباط با مخزن گیت‌هاب...']);
    setGitUpdateSuccess(null);
    try {
      const res = await fetch('/api/system/git-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: gitRepoInput || gitStatus?.repoUrl })
      });
      const data = await res.json();
      if (data.logs && Array.isArray(data.logs)) {
        setGitUpdateLogs(data.logs);
      }
      if (res.ok && data.success) {
        setGitUpdateSuccess(true);
        showMessage('🎉 بروزرسانی با موفقیت از گیت‌هاب اعمال شد!', 'success');
        fetchGitStatus();
        fetchSystemLogs();
      } else {
        setGitUpdateSuccess(false);
        showMessage(data.error || 'خطا در فرآیند بروزرسانی', 'error');
      }
    } catch (err: any) {
      setGitUpdateSuccess(false);
      setGitUpdateLogs(prev => [...prev, `[خطا] عدم توانایی در اتصال به سرور: ${err.message}`]);
      showMessage('خطا در ارسال درخواست به سرور', 'error');
    } finally {
      setIsUpdatingGit(false);
    }
  };

  const handleServiceAction = async (action: 'restart' | 'stop') => {
    setIsExecutingServiceAction(true);
    try {
      const res = await fetch('/api/system/service-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage(data.message || 'عملیات با موفقیت انجام شد.', 'success');
        fetchState();
        fetchGitStatus();
        fetchSystemLogs();
      } else {
        showMessage(data.error || 'خطا در اجرای عملیات سرویس', 'error');
      }
    } catch (err) {
      showMessage('خطا در ارتباط با سرور', 'error');
    } finally {
      setIsExecutingServiceAction(false);
    }
  };

  const handleDownloadScriptsZip = () => {
    window.location.href = '/api/system/download-scripts-zip';
  };

  const handleUserbotSendCode = async () => {
    if (!userbotPhone) {
      showMessage('لطفاً شماره تلفن اکانت تلگرام را وارد کنید.', 'error');
      return;
    }
    if (!userbotUseBypass && (!userbotApiIdInput || !userbotApiHashInput)) {
      showMessage('لطفاً آیدی API و هش API را وارد کنید یا گزینه اتصال سریع را فعال نمایید.', 'error');
      return;
    }
    setUserbotIsConnecting(true);
    setUserbotStatusMsg('درحال ارسال کد تایید...');
    setUserbotSentCodeType(null);
    setUserbotEmailPattern(null);
    setUserbotCodeLength(null);
    try {
      const res = await fetch('/api/userbot/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiId: userbotUseBypass ? "" : userbotApiIdInput.trim(),
          apiHash: userbotUseBypass ? "" : userbotApiHashInput.trim(),
          phoneNumber: userbotPhone.trim()
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUserbotStep('verify_code');
        
        let destinationMsg = 'کد تایید تلگرام با موفقیت ارسال شد. لطفاً آن را وارد کنید.';
        if (data.sentCodeType === 'auth.SentCodeTypeEmailCode') {
          destinationMsg = `یک کد تایید ${data.codeLength || '۵'} رقمی به آدرس ایمیل شما (${data.emailPattern || 'مربوطه'}) ارسال شده است. لطفاً صندوق ورودی (Inbox) یا هرزنامه (Spam) ایمیل خود را بررسی کنید.`;
        } else if (data.sentCodeType === 'auth.SentCodeTypeSetUpEmailRequired') {
          destinationMsg = 'تایید یا اتصال آدرس ایمیل برای ورود به این حساب در تلگرام الزامی است.';
        } else if (data.sentCodeType === 'auth.SentCodeTypeApp') {
          destinationMsg = 'کد تایید به اپلیکیشن تلگرام فعال شما ارسال شد. لطفاً آن را در کادر زیر وارد کنید.';
        } else if (data.sentCodeType === 'auth.SentCodeTypeSms') {
          destinationMsg = 'کد تایید به صورت پیامک (SMS) برای شما ارسال شد. لطفاً آن را در کادر زیر وارد کنید.';
        }
        
        setUserbotStatusMsg(destinationMsg);
        setUserbotSentCodeType(data.sentCodeType || null);
        setUserbotEmailPattern(data.emailPattern || null);
        setUserbotCodeLength(data.codeLength || null);
        showMessage('کد تایید با موفقیت ارسال شد!', 'success');
      } else {
        setUserbotStatusMsg(data.error || 'خطا در ارسال کد تایید');
        showMessage(data.error || 'خطا در ارسال کد تایید', 'error');
      }
    } catch (e) {
      setUserbotStatusMsg('خطا در برقراری ارتباط با سرور.');
      showMessage('خطا در برقراری ارتباط', 'error');
    } finally {
      setUserbotIsConnecting(false);
    }
  };

  const handleUserbotVerifyCode = async () => {
    if (!userbotCodeInput) {
      showMessage('لطفاً کد تایید را وارد کنید.', 'error');
      return;
    }
    setUserbotIsConnecting(true);
    setUserbotStatusMsg('در حال تایید کد و اتصال به تلگرام...');
    try {
      const res = await fetch('/api/userbot/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: userbotPhone.trim(),
          code: userbotCodeInput.trim(),
          password: userbot2FaInput.trim() || undefined
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage('ربات کاربری با موفقیت فعال شد!', 'success');
        setUserbotStatusMsg('');
        setUserbotStep('request_code');
        setUserbotCodeInput('');
        setUserbot2FaInput('');
        fetchState();
      } else if (data.requiresPassword) {
        setUserbotStatusMsg('اکانت شما دارای تایید دو مرحله‌ای است. لطفاً گذرواژه ابری خود را وارد کنید.');
        showMessage('تایید دو مرحله‌ای الزامی است.', 'error');
      } else {
        setUserbotStatusMsg(data.error || 'کد تایید نامعتبر است.');
        showMessage(data.error || 'خطا در تایید کد', 'error');
      }
    } catch (e) {
      setUserbotStatusMsg('خطا در اتصال به سرور.');
      showMessage('خطا در تایید کد تایید', 'error');
    } finally {
      setUserbotIsConnecting(false);
    }
  };

  const handleUserbotLogout = async () => {
    if (!window.confirm('آیا مطمئن هستید که می‌خواهید ربات کاربری (سلف) را قطع اتصال کنید؟')) {
      return;
    }
    try {
      const res = await fetch('/api/userbot/logout', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage('ربات کاربر با موفقیت قطع اتصال شد.', 'success');
        fetchState();
      } else {
        showMessage('خطا در قطع اتصال', 'error');
      }
    } catch (e) {
      showMessage('خطا در اتصال به سرور', 'error');
    }
  };

  const toggleBot = async () => {
    if (!state) return;
    const action = state.isRunning ? 'stop' : 'start';
    try {
      const res = await fetch(`/api/bot/${action}`, { method: 'POST' });
      const data = await res.json();
      setState(prev => prev ? { ...prev, isRunning: data.isRunning } : null);
      showMessage(data.isRunning ? 'ربات روشن شد' : 'ربات خاموش شد', 'success');
    } catch (err) {
      showMessage('خطا در تغییر وضعیت ربات', 'error');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Convert to array of arrays first to map correctly
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        if (data.length < 2) throw new Error("فایل اکسل خالی است یا فرمت مناسبی ندارد");
        
        // Find column indices
        const headers = data[0].map((h: string) => h?.toString().toLowerCase().trim());
        const codeIdx = headers.findIndex(h => h === 'کد' || h === 'code');
        const nameIdx = headers.findIndex(h => h === 'نام' || h === 'name' || h === 'title' || h === 'عنوان');
        const stockIdx = headers.findIndex(h => h === 'موجودی' || h === 'stock' || h === 'qty' || h === 'تعداد');

        if (codeIdx === -1) {
          throw new Error("ستون 'کد' (یا code) در ردیف اول فایل اکسل پیدا نشد.");
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

        // Send the updated merged inventory to the server
        const res = await fetch('/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(existingInventory),
        });
        
        if (res.ok) {
          setState(prev => prev ? ({ ...prev, inventory: existingInventory }) : null);
          showMessage(`همگام‌سازی اکسل با انبار موفقیت‌آمیز بود! تعداد ${addedCount} کالا اضافه و ${updatedCount} کالا بروزرسانی شد.`, 'success');
        } else {
          throw new Error("خطا در ذخیره در سرور");
        }
      } catch (err: any) {
        showMessage(err.message || 'خطا در پردازش فایل اکسل', 'error');
      } finally {
        setIsUploading(false);
        // Reset input
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      showMessage('خطا در خواندن فایل', 'error');
      setIsUploading(false);
    };
    reader.readAsBinaryString(file);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-800" dir="rtl"><span className="text-xl">در حال بارگذاری...</span></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <Bot size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold">پنل ربات دستیار MEH tel:@mohammadeh7</h1>
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className={`flex items-center gap-1 ${state?.isRunning ? 'text-green-600 font-semibold' : 'text-red-500'}`}>
                  {state?.isRunning ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/>}
                  {state?.isRunning ? 'ربات در حال اجرا است' : 'ربات خاموش است'}
                </span>
                <span className="text-gray-300">|</span>
                <span className="flex items-center gap-1 text-gray-500">
                  <Globe size={13} className={config.proxyUrl ? 'text-sky-600' : 'text-gray-400'} />
                  {config.proxyUrl ? 'پروکسی فعال' : 'اتصال مستقیم'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Status Controls */}
          <div className="flex items-center gap-3">
            <button 
              onClick={toggleBot}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors
                ${state?.isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}
              `}
            >
              {state?.isRunning ? <Square size={16} className="fill-current" /> : <Play size={16} className="fill-current" />}
              {state?.isRunning ? 'توقف ربات' : 'اجرای ربات'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {message.type === 'success' ? <CheckCircle2 size={20}/> : <AlertCircle size={20}/>}
            {message.text}
          </div>
        )}

        {/* Custom Tabs */}
        <div className="flex flex-wrap gap-2.5 mb-8">
          {[
            { id: 'settings', icon: Settings, label: 'تنظیمات ربات' },
            { id: 'rules', icon: ShieldCheck, label: 'قوانین اشخاص خاص (VIP / بلاک)' },
            { id: 'inventory', icon: List, label: 'موجودی کالاها' },
            { id: 'customers', icon: Users, label: 'مشتریان' },
            { id: 'backups', icon: Database, label: 'پشتیبان‌گیری و بازگردانی (JSON / اکسل)' },
            { id: 'system_manager', icon: Terminal, label: '🖥️ مدیریت سیستم و بروزرسانی گیت‌هاب (PC & Git)' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm transition-all shadow-xs cursor-pointer
                ${activeTab === tab.id 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                }
              `}
            >
              <tab.icon size={18} />
              {tab.label}
              {tab.id === 'rules' && config.userRules && config.userRules.length > 0 && (
                <span className={`px-2 py-0.5 text-xs rounded-full ${activeTab === 'rules' ? 'bg-white text-blue-700 font-extrabold' : 'bg-purple-100 text-purple-700 font-bold'}`}>
                  {config.userRules.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          
          {activeTab === 'settings' && (
            <div className="p-6">
              {/* Bot status card */}
              <div className="mb-8 bg-gray-50 border border-gray-200 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-gray-800 flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full animate-pulse ${state?.isRunning ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    وضعیت فعلی ربات تلگرام
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {state?.isRunning 
                      ? 'ربات متصل است و در گروه‌ها پیام‌ها را به دنبال کدهای تعریف شده اسکن می‌کند.' 
                      : 'ربات غیرفعال است و اسکن کد کالاها متوقف شده است.'}
                  </p>
                </div>
                <div>
                  <div className="flex gap-3 items-center">
                    <button 
                      onClick={toggleBot}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white shadow-sm transition-all
                        ${state?.isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}
                      `}
                    >
                      {state?.isRunning ? <Square size={16} className="fill-current" /> : <Play size={16} className="fill-current" />}
                      {state?.isRunning ? 'خاموش کردن / غیرفعال‌سازی ربات' : 'روشن کردن / فعال‌سازی ربات'}
                    </button>
                  </div>
                </div>
              </div>

              <h2 className="text-lg font-bold mb-6 text-gray-800">تنظیمات و پیکربندی ربات</h2>
              
              <div className="space-y-6 max-w-2xl">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">توکن ربات (Bot Token)</label>
                    <input 
                      type="password"
                      value={config.token}
                      onChange={e => setConfig({...config, token: e.target.value})}
                      placeholder="1234567890:AAH..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-left dir-ltr"
                    />
                    <p className="mt-2 text-xs text-gray-500">این توکن را از BotFather@ در تلگرام دریافت کنید.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">آیدی عددی مدیر (Admin Chat ID)</label>
                    <input 
                      type="text"
                      value={config.adminId}
                      onChange={e => setConfig({...config, adminId: e.target.value})}
                      placeholder="12345678"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-left font-mono"
                    />
                    <p className="mt-2 text-xs text-gray-500">برای پیدا کردن آیدی خود، از ربات userinfobot@ استفاده کنید. درخواست سفارشات به این آیدی ارسال می‌شود.</p>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">آیدی گروه هدف جهت اسکن (Telegram Group ID / Username) <span className="text-gray-400 text-xs font-normal">(اختیاری)</span></label>
                  <input 
                    type="text"
                    value={config.groupId || ''}
                    onChange={e => setConfig({...config, groupId: e.target.value})}
                    placeholder="مثال: -100123456789 یا my_group_username"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-left font-mono"
                  />
                  <p className="mt-2 text-xs text-gray-500">اگر می‌خواهید اسکن کد فقط به یک گروه خاص محدود شود، آیدی عددی (شروع با ۱۰۰-) یا یوزرنیم گروه را بنویسید. در صورت خالی بودن، ربات مستقیماً تمام گروه‌هایی را که در آن‌ها عضو است اسکن می‌کند.</p>
                  
                  {/* Step-by-Step Helper Guide removed */}

                  {/* Discovered Groups Helper list */}
                  {state.groups && state.groups.length > 0 && (
                    <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <span className="font-bold text-blue-800 text-sm block mb-3 flex items-center gap-1.5">
                        <Users size={16} />
                        گروه‌های شناسایی‌شده خودکار (کافیست کلیک کنید):
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {state.groups.map(g => (
                          <div key={g.id} className="flex items-center justify-between bg-white px-3 py-2.5 rounded-lg border border-blue-100 shadow-xs">
                            <div className="overflow-hidden">
                              <span className="font-bold text-gray-800 text-sm block truncate">{g.title}</span>
                              <span className="text-xs text-mono text-gray-500 font-mono truncate block mt-0.5" dir="ltr">{g.id}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setConfig(prev => ({ ...prev, groupId: g.id }));
                                showMessage(`گروه «${g.title}» انتخاب شد. لطفاً دکمه ذخیره تنظیمات را بزنید.`, 'success');
                              }}
                              className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-2.5 rounded transition-all cursor-pointer select-none"
                            >
                              انتخاب
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">محدودیت و امنیت دسترسی در گروه‌ها</label>
                  <select 
                    value={config.groupAccess || 'all'}
                    onChange={e => setConfig({...config, groupAccess: e.target.value as any})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white transition-all text-sm"
                  >
                    <option value="all">🌐 همه اعضا (هر کسی در گروه پیام حاوی کد معتبر بفرستد، اسکن و ثبت شود)</option>
                    <option value="group_admins">👮 فقط ادمین‌های گروه (فقط مدیران و ادمین‌های گروه بتوانند کالاها را در گروه اسکن کنند)</option>
                    <option value="admin">🔒 فقط مدیر ربات (فقط شما به عنوان مدیر کل ربات بتوانید با ارسال کد در داخل گروه اسکن را تریگر کنید)</option>
                  </select>
                  <p className="mt-2 text-xs text-gray-500">برای برطرف کردن نگرانی دسترسی بقیه افراد گروه به ربات، می‌توانید دسترسی را محدود به ادمین‌های گروه یا فقط حساب خودتان (مدیر کل) نمایید.</p>
                </div>

                <div className="border-t border-gray-100 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl">
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      id="botEnabled"
                      checked={config.botEnabled !== false}
                      onChange={e => setConfig({...config, botEnabled: e.target.checked})}
                      className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                    <div>
                      <label htmlFor="botEnabled" className="block text-sm font-bold text-gray-800 cursor-pointer">
                        🟢 پایش و اسکن هوشمند فعال باشد
                      </label>
                      <p className="mt-1 text-xs text-gray-500">
                        در صورت غیرفعال بودن این گزینه، ربات اسکن کدهای خرید را موقتاً متوقف می‌کند.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      id="disableCustomerPm"
                      checked={!!config.disableCustomerPm}
                      onChange={e => setConfig({...config, disableCustomerPm: e.target.checked})}
                      className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                    <div>
                      <label htmlFor="disableCustomerPm" className="block text-sm font-bold text-gray-800 cursor-pointer">
                        📴 غیرفعال کردن پیام به خریدار
                      </label>
                      <p className="mt-1 text-xs text-gray-500">
                        با فعال کردن این گزینه، پس از سفارش هیچ پیامی به مشتری فرستاده نمی‌شود و سفارش خریدار مستقیماً و مخفیانه فقط در پی‌وی شما (ادمین) ثبت می‌گردد.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">متن اطلاعات ارسالی در پی‌وی مشتری (Customer PV Message Template)</label>
                  <textarea 
                    value={config.customerMessage || ''}
                    onChange={e => setConfig({...config, customerMessage: e.target.value})}
                    placeholder="نمونه: سلام! درخواست شما برای خرید {name} با کد {code} ثبت شد. به زودی در خدمتتان هستیم."
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-right text-sm leading-relaxed"
                  />
                  <p className="mt-2 text-xs text-gray-500">شما می‌توانید از متغیرهای <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-blue-600">{`{code}`}</code> برای کد کالا و <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-blue-600">{`{name}`}</code> برای نام کالا استفاده کنید تا اطلاعات به صورت خودکار جایگذاری شوند.</p>
                </div>

                {/* 🤖 Userbot (Self-Bot) Secure Settings Section */}
                <div className="border-t border-gray-200 pt-8 mt-8">
                  <h4 className="text-md font-bold text-gray-900 mb-2 flex items-center gap-2">
                    <span className="p-1 px-2 rounded-md bg-purple-100 text-purple-700 text-xs">سلف / کاربر</span>
                    🤖 تنظیمات ربات کاربری مبارز با محدودیت ربات‌ها (Telegram Userbot / Self Bot)
                  </h4>
                  <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                    با اتصال اکانت شخصی خود از طریق API رسمی تلگرام، پیام‌های گروه‌های کاری را اسکن کنید. این روش برخلاف ربات‌های معمولی، محدودیت‌های اضافه کردن ربات به گروه‌های قفل‌شده را دور می‌زند و امنیت فوق‌العاده بالایی دارد.
                  </p>

                  <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-6 space-y-6">
                    {/* Active Session Status */}
                    {config.userbotSession ? (
                      <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-lg border border-purple-200">
                          <div>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                              فعال و متصل به تلگرام
                            </span>
                            <p className="text-xs text-gray-500 mt-2">
                              ربات کاربری فعال شده است و با موفقیت در پس‌زمینه سرور اطلاعات گروه‌ها را بررسی می‌کند.
                            </p>
                            <div className="mt-2 text-xs font-mono text-purple-600 bg-purple-50 px-2 py-1 rounded inline-block">
                              API ID: {config.userbotApiId}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleUserbotLogout}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                          >
                            خروج و قطع اتصال اکانت
                          </button>
                        </div>

                        {/* Interactive Group Selector */}
                        <div className="bg-white p-5 rounded-lg border border-purple-200 space-y-4 text-right">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                              <h5 className="text-sm font-bold text-purple-900 flex items-center gap-1.5">
                                <span className="w-1.5 h-3 bg-purple-600 rounded"></span>
                                📋 لیست گروه‌ها و کانال‌های تلگرام شما
                              </h5>
                              <p className="text-3xs text-gray-500 mt-1">
                                گروه‌هایی را که تمایل دارید پیام‌هایشان برای کدهای خرید پایش شود انتخاب کنید:
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={fetchDialogGroups}
                              disabled={isLoadingDialogs}
                              className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer text-center shadow-sm"
                            >
                              {isLoadingDialogs ? 'درحال بارگذاری...' : '🔄 بارگذاری و بروزرسانی گروه‌ها'}
                            </button>
                          </div>

                          {/* Spinner or Content */}
                          {isLoadingDialogs ? (
                            <div className="flex flex-col items-center justify-center py-8 text-xs text-gray-500 space-y-3">
                              <span className="w-8 h-8 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin"></span>
                              <p>در حال دریافت لیست مخاطبان، گروه‌ها و سوپرگروه‌ها از تلگرام اکانت شما...</p>
                            </div>
                          ) : dialogGroups.length === 0 ? (
                            <div className="border border-dashed border-purple-200 rounded-lg py-8 px-4 text-center bg-purple-50/10">
                              <p className="text-xs text-gray-500">لیست گروه‌ها هنوز دریافت نشده است یا در حال حاضر خالی است.</p>
                              <button
                                type="button"
                                onClick={fetchDialogGroups}
                                className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold py-1.5 px-4 rounded-lg transition-all mx-auto block mt-2 shadow-sm"
                              >
                                دریافت و بروزرسانی لیست گروه‌ها
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-3 font-sans">
                              {/* Search tool */}
                              <input
                                type="text"
                                value={dialogSearch}
                                onChange={e => setDialogSearch(e.target.value)}
                                placeholder="🎯 جستجو در نام گروه یا یوزرنیم..."
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 text-xs text-right"
                              />

                              {/* Selected List badges */}
                              <div className="flex flex-wrap gap-1.5 p-2 bg-purple-50/50 rounded-lg border border-purple-100/50 text-xs">
                                <span className="text-[11px] text-purple-900 font-bold self-center">گروه‌های انتخاب‌شده برای اسکن:</span>
                                {(() => {
                                  const currentSelected = config.userbotGroups
                                    ? config.userbotGroups.split(',').map(x => x.trim()).filter(Boolean)
                                    : [];
                                  if (currentSelected.length === 0) {
                                    return <span className="text-3xs text-amber-600 self-center">هیچ گروهی انتخاب نشده است (همه گروه‌ها اسکن خواهند شد - پایش عمومی)</span>;
                                  }
                                  return (
                                    <div className="flex flex-wrap gap-1">
                                      {currentSelected.map(id => {
                                        const grp = dialogGroups.find(g => g.id === id);
                                        const displayName = grp ? grp.title : (id.startsWith('@') ? id : `آیدی: ${id}`);
                                        return (
                                          <span key={id} className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded-full select-none">
                                            {displayName}
                                            <button
                                              type="button"
                                              onClick={() => handleToggleGroup(id)}
                                              className="text-purple-600 hover:text-purple-900 font-bold text-xs mr-0.5"
                                            >
                                              ×
                                            </button>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Scrollable list & Selection */}
                              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 text-xs">
                                {(() => {
                                  const filtered = dialogGroups.filter(grp => {
                                    const name = grp.title.toLowerCase();
                                    const user = (grp.username || '').toLowerCase();
                                    const term = dialogSearch.toLowerCase();
                                    return name.includes(term) || user.includes(term);
                                  });

                                  if (filtered.length === 0) {
                                    return <p className="p-4 text-center text-gray-400">گروهی با این مشخصات یافت نشد.</p>;
                                  }

                                  return filtered.map(grp => {
                                    const currentSelected = config.userbotGroups
                                      ? config.userbotGroups.split(',').map(x => x.trim()).filter(Boolean)
                                      : [];
                                    const isChecked = currentSelected.includes(grp.id);

                                    return (
                                      <label
                                        key={grp.id}
                                        className={`flex items-center justify-between p-3 hover:bg-purple-50/20 cursor-pointer transition-all ${isChecked ? 'bg-purple-50/40' : ''}`}
                                      >
                                        <div className="flex items-center gap-2.5">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => handleToggleGroup(grp.id)}
                                            className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer"
                                          />
                                          <div>
                                            <span className="font-bold text-gray-800 block text-right">{grp.title}</span>
                                            {grp.username && (
                                              <span className="text-3xs text-gray-400 block font-mono text-right" dir="ltr">
                                                @{grp.username}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-3xs">
                                          {grp.isChannel ? (
                                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-md font-bold">کانال</span>
                                          ) : (
                                            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded-md font-bold">گروه</span>
                                          )}
                                          <span className="text-gray-400 font-mono text-[10px]">{grp.id}</span>
                                        </div>
                                      </label>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Selector for connection mode */}
                        <div className="flex flex-col sm:flex-row gap-2 p-1 bg-purple-100/50 rounded-lg max-w-lg">
                          <button
                            type="button"
                            onClick={() => setUserbotUseBypass(true)}
                            className={`flex-1 text-center py-2 px-3 rounded-md text-xs font-bold transition-all cursor-pointer ${userbotUseBypass ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-700 hover:bg-purple-100'}`}
                          >
                            🚀 اتصال سریع و بدون خطا (پیشنهادی - بدون نیاز به ساخت فایل)
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserbotUseBypass(false)}
                            className={`flex-1 text-center py-2 px-3 rounded-md text-xs font-bold transition-all cursor-pointer ${!userbotUseBypass ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-700 hover:bg-purple-100'}`}
                          >
                            ⚙️ وارد کردن دستی api_id و api_hash
                          </button>
                        </div>

                        {userbotUseBypass ? (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-3.5 text-xs text-green-800 leading-relaxed space-y-1">
                            <p className="font-bold">✅ حالت اتصال سریع و هوشمند فعال است!</p>
                            <p>در این روش، تلگرام از کدهای شناسایی رسمی و ایمن دسکتاپ استفاده می‌کند. نیازی به ورود به سایت <span className="font-mono">my.telegram.org</span> ندارید و با هیچ اروری در ساخت برنامه مواجه نخواهید شد.</p>
                            <p className="text-gray-500 text-[11px] mt-1">توضیح: کافیست شماره خود را وارد کنید، کد تایید دریافتی از تلگرام را بنویسید و کار تمام است!</p>
                          </div>
                        ) : (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 leading-relaxed">
                            ⚠️ <strong>روش دستی:</strong> برای فعال‌سازی با روش سنتی به <strong>api_id</strong> و <strong>api_hash</strong> نیاز دارید که باید به صورت رایگان از سایت رسمی <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="underline font-bold">my.telegram.org</a> دریافت گردد.
                          </div>
                        )}

                        {userbotStep === 'request_code' ? (
                          <div className={`grid grid-cols-1 ${userbotUseBypass ? 'max-w-md' : 'md:grid-cols-3'} gap-4`}>
                            {!userbotUseBypass && (
                              <>
                                <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1.5">آیدی API (api_id)</label>
                                  <input
                                    type="text"
                                    value={userbotApiIdInput}
                                    onChange={e => setUserbotApiIdInput(e.target.value)}
                                    placeholder="مثال: 123456"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-left font-mono text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1.5">هش API (api_hash)</label>
                                  <input
                                    type="text"
                                    value={userbotApiHashInput}
                                    onChange={e => setUserbotApiHashInput(e.target.value)}
                                    placeholder="مثال: e34f9a3f..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-left font-mono text-sm"
                                  />
                                </div>
                              </>
                            )}
                            <div>
                              <label className="block text-xs font-bold text-gray-700 mb-1.5">شماره تلفن اکانت تلگرام</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={userbotPhone}
                                  onChange={e => setUserbotPhone(e.target.value)}
                                  placeholder="989123456789+"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-left font-mono text-sm"
                                  dir="ltr"
                                />
                                <button
                                  type="button"
                                  disabled={userbotIsConnecting}
                                  onClick={handleUserbotSendCode}
                                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
                                >
                                  {userbotIsConnecting ? 'درحال ارسال...' : 'ارسال کد'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white p-4 rounded-lg border border-purple-200 space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-purple-700 block">📥 تایید هویت دو مرحله‌ای تلگرام</span>
                              {userbotSentCodeType === 'auth.SentCodeTypeEmailCode' && (
                                <span className="bg-amber-100 text-amber-800 text-[10px] px-2.5 py-0.5 rounded-full font-bold">
                                  ارسال شده به ایمیل
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                                  {userbotSentCodeType === 'auth.SentCodeTypeEmailCode' ? 'کد تایید دریافتی از ایمیل' : 'کد تایید دریافتی تلگرام'}
                                </label>
                                <input
                                  type="text"
                                  value={userbotCodeInput}
                                  onChange={e => setUserbotCodeInput(e.target.value)}
                                  placeholder={userbotSentCodeType === 'auth.SentCodeTypeEmailCode' ? 'کد ارسالی به ایمیل شما' : 'کد پیامک یا پیام تلگرام'}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-center font-mono text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1.5">رمز عبور دو مرحله‌ای (گذرواژه ابری) <span className="text-gray-400 font-normal">(در صورت فعال بودن)</span></label>
                                <input
                                  type="password"
                                  value={userbot2FaInput}
                                  onChange={e => setUserbot2FaInput(e.target.value)}
                                  placeholder="گذرواژه تایید دو مرحله‌ای"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-center font-mono text-sm"
                                />
                              </div>
                              <div className="flex items-end gap-2">
                                <button
                                  type="button"
                                  disabled={userbotIsConnecting}
                                  onClick={handleUserbotVerifyCode}
                                  className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white py-2.5 rounded-lg text-xs font-bold transition-all"
                                >
                                  {userbotIsConnecting ? 'درحال اتصال...' : 'تایید هویت و فعالسازی'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setUserbotStep('request_code');
                                    setUserbotStatusMsg('');
                                    setUserbotCodeInput('');
                                    setUserbot2FaInput('');
                                    setUserbotSentCodeType(null);
                                    setUserbotEmailPattern(null);
                                    setUserbotCodeLength(null);
                                  }}
                                  className="px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all shrink-0 shadow-sm cursor-pointer"
                                >
                                  بازگشت
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {userbotStatusMsg && (
                          <p className="text-xs font-bold text-purple-700 bg-purple-50 p-2.5 rounded-lg border border-purple-100">
                            ℹ️ {userbotStatusMsg}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Configuration settings applied online */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-purple-100 pt-4">
                      <div>
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            id="userbotEnabled"
                            checked={config.userbotEnabled || false}
                            onChange={e => setConfig({ ...config, userbotEnabled: e.target.checked })}
                            className="mt-1 h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer"
                          />
                          <div>
                            <label htmlFor="userbotEnabled" className="block text-xs font-bold text-purple-900 cursor-pointer">
                              پایش و اسکن ربات کاربر (سلف) روشن باشد
                            </label>
                            <p className="text-3xs text-gray-500 mt-1">
                              با خاموش کردن این گزینه، فعالیت ربات کاربر (سلف) در پس‌زمینه متوقف می‌شود.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-purple-900 mb-1">
                          گروه‌های تحت اسکن سلف (Watchlist) <span className="text-gray-400 text-3xs font-normal">(پیشنهادی: فقط ۱ الی ۲ گروه)</span>
                        </label>
                        <input
                          type="text"
                          value={config.userbotGroups || ''}
                          onChange={e => setConfig({ ...config, userbotGroups: e.target.value })}
                          placeholder="مثال: -100122332, @my_watch_group"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-xs text-left"
                        />
                        <p className="text-3xs text-gray-500 mt-1 leading-relaxed">
                          آیدی عددی (شروع با ۱۰۰-) یا آیدی یوزرنیم گروه‌ها را با ویرگول فرنگی (<code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-purple-600">,</code>) جدا کنید. حتماً فقط گروه‌های مورد نظر را بنویسید تا ریسک استفاده از سلف کاهش یابد.
                        </p>
                      </div>
                    </div>

                    {/* Quick Rules Banner for Userbot */}
                    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center shrink-0">
                          <ShieldCheck size={18} />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-purple-950 block">👥 فیلتر و قوانین اشخاص خاص (VIP / بلاک‌لیست)</span>
                          <span className="text-[11px] text-purple-800">
                            {config.userRules && config.userRules.length > 0 
                              ? `${config.userRules.filter(r => r.action === 'ALWAYS_NOTIFY').length} شخص ویژه (VIP) و ${config.userRules.filter(r => r.action === 'NEVER_NOTIFY').length} شخص بلاک‌شده تعریف شده است.`
                              : 'هنوز قانونی برای افراد خاص تعریف نکرده‌اید. با تعریف افراد می‌توانید پیام‌هایشان را تحت هر شرایطی دریافت یا بلاک کنید.'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('rules')}
                        className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold py-1.5 px-3.5 rounded-lg transition-all shadow-xs cursor-pointer flex items-center gap-1 shrink-0"
                      >
                        مدیریت قوانین اشخاص
                        <ArrowRight size={13} className="rotate-180" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 🌐 Network & Proxy Settings Section */}
                <div className="border-t border-gray-200 pt-8 mt-8">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-md font-bold text-gray-900 flex items-center gap-2">
                      <span className="p-1 px-2 rounded-md bg-sky-100 text-sky-700 text-xs font-semibold">پروکسی و ضد فیلتر</span>
                      🌐 تنظیمات پروکسی و شبکه تلگرام (Telegram Proxy)
                    </h4>
                  </div>
                  <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                    اگر ربات یا سلف‌بات روی سیستم ویندوز یا سرور شما به دلیل محدودیت‌های اینترنت به سرورهای تلگرام متصل نمی‌شود، پروکسی نرم‌افزار خود (مانند v2rayN یا Clash) را در این بخش فعال کنید.
                  </p>

                  <div className="bg-sky-50/40 border border-sky-100 rounded-xl p-6 space-y-5">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">
                        آدرس و پورت پروکسی (Proxy URL):
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={config.proxyUrl || ''}
                          onChange={e => {
                            setConfig({ ...config, proxyUrl: e.target.value });
                            setProxyTestResult(null);
                          }}
                          placeholder="مثال: socks5://127.0.0.1:10808 یا http://127.0.0.1:10809"
                          className="flex-1 px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none font-mono text-xs text-left"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          onClick={handleTestProxy}
                          disabled={isTestingProxy}
                          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer whitespace-nowrap"
                        >
                          <Wifi size={15} className={isTestingProxy ? 'animate-pulse' : ''} />
                          {isTestingProxy ? 'در حال تست اتصال...' : 'تست اتصال به تلگرام'}
                        </button>
                      </div>
                    </div>

                    {/* Presets */}
                    <div>
                      <div className="text-2xs font-semibold text-gray-500 mb-2">میانبرهای پرکاربرد (پورت‌های پیش‌فرض ویندوز):</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({ ...config, proxyUrl: 'socks5://127.0.0.1:10808' });
                            setProxyTestResult(null);
                          }}
                          className="px-2.5 py-1.5 bg-white hover:bg-sky-50 border border-sky-200 text-sky-800 rounded-md text-2xs font-mono font-medium transition cursor-pointer"
                        >
                          ⚡ v2rayN (Socks5: 10808)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({ ...config, proxyUrl: 'http://127.0.0.1:10809' });
                            setProxyTestResult(null);
                          }}
                          className="px-2.5 py-1.5 bg-white hover:bg-sky-50 border border-sky-200 text-sky-800 rounded-md text-2xs font-mono font-medium transition cursor-pointer"
                        >
                          ⚡ v2rayN (HTTP: 10809)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({ ...config, proxyUrl: 'http://127.0.0.1:7890' });
                            setProxyTestResult(null);
                          }}
                          className="px-2.5 py-1.5 bg-white hover:bg-sky-50 border border-sky-200 text-sky-800 rounded-md text-2xs font-mono font-medium transition cursor-pointer"
                        >
                          ⚡ Clash / Sing-box (:7890)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({ ...config, proxyUrl: '' });
                            setProxyTestResult(null);
                          }}
                          className="px-2.5 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-md text-2xs font-medium transition cursor-pointer"
                        >
                          🚫 اتصال مستقیم (بدون پروکسی)
                        </button>
                      </div>
                    </div>

                    {/* Test result display */}
                    {proxyTestResult && (
                      <div className={`p-3 rounded-lg text-xs flex items-start gap-2.5 ${
                        proxyTestResult.success 
                          ? 'bg-green-50 text-green-800 border border-green-200' 
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}>
                        {proxyTestResult.success ? (
                          <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
                        ) : (
                          <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
                        )}
                        <span className="leading-relaxed">{proxyTestResult.message}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                  <button 
                    onClick={handleSaveConfig}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold transition-all shadow-sm cursor-pointer"
                  >
                    <Save size={18} />
                    ذخیره تنظیمات
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="p-6 space-y-8">
              {/* Main title & Guide banner */}
              <div className="border-b border-gray-100 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                      <ShieldCheck className="text-purple-600" size={24} />
                      مدیریت و فیلتر هوشمند اشخاص خاص در گروه‌ها (VIP / بلاک‌لیست)
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-relaxed">
                      در حالت پایش سلف‌بات و ربات، می‌توانید اشخاص معینی را تعریف کنید تا پیام‌هایشان تحت هر شرایطی به شما برسد یا به طور کامل نادیده گرفته شود.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-purple-50 text-purple-700 font-bold px-3 py-1.5 rounded-lg border border-purple-200">
                      تعداد کل قوانین: {(config.userRules || []).length}
                    </span>
                  </div>
                </div>

                {/* Feature Explanations Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Star size={20} className="fill-current" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-amber-950">🌟 حالت شخص ویژه (VIP - Always Notify)</h4>
                      <p className="text-xs text-amber-900 mt-1 leading-relaxed">
                        پیام‌های این شخص در گروه پایش‌شده، <strong>تحت هر شرایطی</strong> (حتی اگر کالا و کد در لیست انبار شما نباشد) بلافاصله همراه با متن کامل و فوروارد پیام به پی‌وی شما فرستاده می‌شود.
                      </p>
                    </div>
                  </div>

                  <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-4 flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Ban size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-rose-950">🚫 حالت نادیده گرفتن کامل (Never Notify / Blacklist)</h4>
                      <p className="text-xs text-rose-900 mt-1 leading-relaxed">
                        پیام‌های این شخص در گروه، <strong>نادیده گرفته می‌شود</strong> و مسدود است (حتی اگر پیامی با کد معتبر موجود در انبار بفرستد، هیچ اطلاعی برای شما ارسال نخواهد شد).
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add / Edit Form */}
              <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-5">
                  <div className="flex items-center gap-2 text-purple-700 font-bold text-sm">
                    {editingRuleId ? <Edit size={18} className="text-amber-600" /> : <Plus size={18} />}
                    <h4>{editingRuleId ? 'ویرایش قانون شخص' : '➕ تعریف قانون جدید برای شخص خاص'}</h4>
                  </div>
                  {editingRuleId && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full font-semibold">
                      در حال ویرایش
                    </span>
                  )}
                </div>

                <form onSubmit={handleAddOrUpdateRule} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">
                        آیدی عددی (User ID) یا نام کاربری (@username) شخص <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="مثال: 123456789 یا @my_partner"
                        value={ruleTarget}
                        onChange={e => setRuleTarget(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm font-mono text-left"
                        dir="ltr"
                      />
                      <p className="text-3xs text-gray-500 mt-1">
                        می‌توانید آیدی عددی تلگرام کاربر را بنویسید (از طریق دستور <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-purple-600">/id</code> یا فوروارد به userinfobot@) یا نام کاربری با علامت @.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">
                        نام، عنوان یا یادداشت شخص <span className="text-gray-400 font-normal">(جهت تشخیص در گزارشات)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="مثال: همکار معتمد / رقیب تجاری / مشتری عمده"
                        value={ruleName}
                        onChange={e => setRuleName(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                      />
                      <p className="text-3xs text-gray-500 mt-1">
                        این نام در اعلان ارسالی به تلگرام شما نمایش داده می‌شود.
                      </p>
                    </div>
                  </div>

                  {/* Mode Selector Cards */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-2">
                      نوع عملکرد و رفتار ربات در قبال این شخص: <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label
                        onClick={() => setRuleAction('ALWAYS_NOTIFY')}
                        className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3 select-none ${
                          ruleAction === 'ALWAYS_NOTIFY'
                            ? 'border-amber-500 bg-amber-50/60 shadow-xs ring-2 ring-amber-100'
                            : 'border-gray-200 hover:border-gray-300 bg-gray-50/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="ruleAction"
                          value="ALWAYS_NOTIFY"
                          checked={ruleAction === 'ALWAYS_NOTIFY'}
                          onChange={() => setRuleAction('ALWAYS_NOTIFY')}
                          className="mt-1 h-4 w-4 text-amber-600 border-gray-300 focus:ring-amber-500"
                        />
                        <div>
                          <span className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                            🌟 اطلاع‌رسانی تحت هر شرایطی (VIP)
                          </span>
                          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                            حتی اگر کالایی در لیست انبار پیدا نشود، پیام کامل این شخص و فوروارد آن سریعاً به پی‌وی شما ارسال شود.
                          </p>
                        </div>
                      </label>

                      <label
                        onClick={() => setRuleAction('NEVER_NOTIFY')}
                        className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3 select-none ${
                          ruleAction === 'NEVER_NOTIFY'
                            ? 'border-rose-500 bg-rose-50/60 shadow-xs ring-2 ring-rose-100'
                            : 'border-gray-200 hover:border-gray-300 bg-gray-50/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="ruleAction"
                          value="NEVER_NOTIFY"
                          checked={ruleAction === 'NEVER_NOTIFY'}
                          onChange={() => setRuleAction('NEVER_NOTIFY')}
                          className="mt-1 h-4 w-4 text-rose-600 border-gray-300 focus:ring-rose-500"
                        />
                        <div>
                          <span className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                            🚫 نادیده گرفتن کامل (بلاک / سکوت)
                          </span>
                          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                            حتی اگر کالا و کد معتبر در پیام این شخص باشد، به هیچ وجه ثبت یا به پی‌وی اطلاع داده نشود.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Extra options */}
                  <div className="bg-gray-50/80 p-3.5 rounded-lg border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-gray-800 select-none">
                      <input
                        type="checkbox"
                        checked={ruleForward}
                        onChange={e => setRuleForward(e.target.checked)}
                        className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                      />
                      <span>📬 فوروارد مستقیم پیام اصلی فرستنده از گروه به پی‌وی ادمین (در حالت VIP)</span>
                    </label>
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm text-white transition-all shadow-sm cursor-pointer ${
                        editingRuleId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-purple-600 hover:bg-purple-700'
                      }`}
                    >
                      <Save size={16} />
                      {editingRuleId ? 'بروزرسانی و ذخیره قانون' : 'ثبت و ذخیره قانون شخص'}
                    </button>
                    {editingRuleId && (
                      <button
                        type="button"
                        onClick={handleCancelEditRule}
                        className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-sm transition-all cursor-pointer"
                      >
                        انصراف
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Rules List & Filter Controls */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
                <div className="p-4 bg-gray-50/80 border-b border-gray-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                      <Users size={17} className="text-purple-600" />
                      لیست اشخاص و قوانین ثبت‌شده
                    </h4>
                  </div>

                  {/* Filter Pills and Search */}
                  <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 sm:w-56">
                      <input
                        type="text"
                        placeholder="🔍 جستجو در قوانین..."
                        value={ruleSearch}
                        onChange={e => setRuleSearch(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                      />
                    </div>

                    {/* Filter Pills */}
                    <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setRuleFilter('ALL')}
                        className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                          ruleFilter === 'ALL' ? 'bg-purple-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        همه ({(config.userRules || []).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setRuleFilter('ALWAYS_NOTIFY')}
                        className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                          ruleFilter === 'ALWAYS_NOTIFY' ? 'bg-amber-500 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        🌟 ویژه ({(config.userRules || []).filter(r => r.action === 'ALWAYS_NOTIFY').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setRuleFilter('NEVER_NOTIFY')}
                        className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                          ruleFilter === 'NEVER_NOTIFY' ? 'bg-rose-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        🚫 بلاک ({(config.userRules || []).filter(r => r.action === 'NEVER_NOTIFY').length})
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table for desktop / Cards for mobile */}
                <div className="overflow-x-auto">
                  {(() => {
                    const allRules = config.userRules || [];
                    const filteredRules = allRules.filter(r => {
                      if (ruleFilter !== 'ALL' && r.action !== ruleFilter) return false;
                      if (ruleSearch.trim()) {
                        const term = ruleSearch.toLowerCase().trim();
                        const matchTarget = (r.target || '').toLowerCase().includes(term);
                        const matchName = (r.name || '').toLowerCase().includes(term);
                        return matchTarget || matchName;
                      }
                      return true;
                    });

                    if (filteredRules.length === 0) {
                      return (
                        <div className="py-12 px-4 text-center">
                          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Users size={24} />
                          </div>
                          <p className="text-sm font-bold text-gray-700">هیچ قانونی در این لیست وجود ندارد</p>
                          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                            با استفاده از فرم بالا می‌توانید اشخاص خاص (همکاران مهم، تامین‌کنندگان یا افراد مزاحم) را تعریف نمایید.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <table className="w-full text-right text-xs">
                        <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                          <tr>
                            <th className="px-5 py-3.5 font-bold">تارگت (آیدی / یوزرنیم)</th>
                            <th className="px-5 py-3.5 font-bold">نام و عنوان شخص</th>
                            <th className="px-5 py-3.5 font-bold">نوع قانون و رفتار</th>
                            <th className="px-5 py-3.5 font-bold text-center">وضعیت</th>
                            <th className="px-5 py-3.5 font-bold text-center">عملیات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredRules.map(rule => {
                            const isVip = rule.action === 'ALWAYS_NOTIFY';
                            const isEnabled = rule.enabled !== false;
                            const isCopied = copiedRuleId === rule.id;

                            return (
                              <tr key={rule.id} className={`hover:bg-gray-50/80 transition-colors ${!isEnabled ? 'opacity-60 bg-gray-50/30' : ''}`}>
                                <td className="px-5 py-4 font-mono font-bold text-gray-800">
                                  <div className="flex items-center gap-2">
                                    <span dir="ltr" className="select-all">{rule.target}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(rule.target);
                                        setCopiedRuleId(rule.id);
                                        setTimeout(() => setCopiedRuleId(null), 2000);
                                      }}
                                      className="text-gray-400 hover:text-gray-700 p-1 rounded transition"
                                      title="کپی آیدی"
                                    >
                                      {isCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                    </button>
                                  </div>
                                </td>

                                <td className="px-5 py-4">
                                  <span className="font-bold text-gray-900 block">{rule.name || 'بدون عنوان'}</span>
                                  <span className="text-3xs text-gray-400 mt-0.5 block">
                                    {rule.forwardMessage !== false ? '📬 فوروارد پیام فعال' : 'پیام فوروارد نمی‌شود'}
                                  </span>
                                </td>

                                <td className="px-5 py-4">
                                  {isVip ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 shadow-3xs">
                                      <Star size={13} className="fill-amber-500 text-amber-500" />
                                      اطلاع‌رسانی تحت هر شرایطی (VIP)
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-300 shadow-3xs">
                                      <Ban size={13} className="text-rose-600" />
                                      نادیده گرفتن کامل (بلاک)
                                    </span>
                                  )}
                                </td>

                                <td className="px-5 py-4 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleRule(rule.id)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                      isEnabled
                                        ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200'
                                    }`}
                                  >
                                    <span className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                                    {isEnabled ? 'فعال' : 'غیرفعال'}
                                  </button>
                                </td>

                                <td className="px-5 py-4 text-center">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleSelectForEditRule(rule)}
                                      className="p-1.5 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white rounded-lg transition shadow-3xs cursor-pointer"
                                      title="ویرایش قانون"
                                    >
                                      <Edit size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRule(rule.id)}
                                      className="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded-lg transition shadow-3xs cursor-pointer"
                                      title="حذف قانون"
                                    >
                                      <Trash size={15} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="p-6 space-y-8">
              {/* Main title */}
              <div className="border-b border-gray-100 pb-4">
                <h2 className="text-xl font-bold text-gray-800">مدیریت لیست محصولات انبار</h2>
                <p className="text-sm text-gray-500 mt-1">با استفاده از ابزارهای زیر، کالاها و لیست انبار ربات را بارگذاری، بروزرسانی و مدیریت کنید.</p>
              </div>

              {/* Three Separate Administrative Panels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Panel A: Download Template Excel */}
                <div className="p-6 bg-teal-50/50 border border-teal-200 rounded-xl shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-teal-800 font-bold mb-2">
                      <FileDown size={20} />
                      <h4>۱. دانلود فایل پیش‌فرض نمونه اکسل</h4>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-4">
                      جهت تعریف کالاها به صورت دسته‌جمعی، ابتدا این قالب اکسل نمونه را دانلود نمایید و اطلاعات کالاها را در ستون‌های تنظیم‌شده وارد کنید.
                    </p>
                  </div>
                  <button 
                    onClick={downloadSampleExcel}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold bg-teal-600 hover:bg-teal-700 text-white shadow-sm text-sm transition-all"
                  >
                    <FileDown size={18} />
                    دانلود فایل نمونه اکسل (xlsx)
                  </button>
                </div>

                {/* Panel B: Upload Excel File */}
                <div className="p-6 bg-blue-50/50 border border-blue-200 rounded-xl shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-blue-800 font-bold mb-2">
                      <Upload size={20} />
                      <h4>۲. آپلود لیست کالاها از فایل اکسل</h4>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-4">
                      یک فایل اکسل پر شده آپلود کنید. لیست تمام موجودی‌های قبلی ربات با محصولات فایل جدید جایگزین شده و بلافاصله آماده اسکن می‌شود.
                    </p>
                  </div>
                  <div className="relative">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      disabled={isUploading}
                    />
                    <button className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold text-sm transition-all shadow-sm ${isUploading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                      <Upload size={18} />
                      {isUploading ? 'در حال پردازش فایل...' : 'آپلود فایل اکسل محصولات'}
                    </button>
                  </div>
                </div>

              </div>

              {/* Panel C: Manual Product Registration Form (Separate section) */}
              <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
                <div className="flex items-center gap-2 text-blue-600 font-bold mb-4 border-b border-gray-100 pb-3">
                  {isEditing ? <Edit size={20} className="text-amber-500" /> : <Plus size={20} />}
                  <h4>۳. {isEditing ? 'ویرایش اطلاعات کالا' : 'افزودن و ثبت دستی کالا'}</h4>
                </div>
                
                <form onSubmit={handleAddOrUpdateManual} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">کد کالا <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="مثال: SH-101"
                      value={manualCode}
                      onChange={e => setManualCode(e.target.value)}
                      disabled={isEditing}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm font-mono placeholder:font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">نام کالا (اختیاری)</label>
                    <input 
                      type="text" 
                      placeholder="مثال: تیشرت مشکی" 
                      value={manualName}
                      onChange={e => setManualName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">موجودی کالا (عدد - خالی یعنی ۱ کالا)</label>
                    <input 
                      type="number" 
                      placeholder="مثال: 15" 
                      value={manualStock}
                      onChange={e => setManualStock(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button 
                      type="submit" 
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg font-bold text-sm text-white transition-all shadow-sm ${isEditing ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}`}
                    >
                      <Save size={16} />
                      {isEditing ? 'بروزرسانی کالا' : 'ثبت کالا'}
                    </button>
                    {isEditing && (
                      <button 
                        type="button" 
                        onClick={() => {
                          setManualCode('');
                          setManualName('');
                          setManualStock('');
                          setIsEditing(false);
                        }}
                        className="py-2 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-sm transition-all shadow-sm cursor-pointer"
                      >
                        انصراف
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Inventory Table List */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <h4 className="font-bold text-sm text-gray-800">لیست کل کالاهای تعریف شده</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead className="bg-gray-50 text-gray-600 text-xs border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 font-medium">کد کالا</th>
                        <th className="px-6 py-3 font-medium">نام کالا</th>
                        <th className="px-6 py-3 font-medium">موجودی</th>
                        <th className="px-6 py-3 font-medium">وضعیت</th>
                        <th className="px-6 py-3 font-medium text-center">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                    {state?.inventory && state.inventory.length > 0 ? (
                      state.inventory.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 font-mono text-gray-600">{item.code}</td>
                          <td className="px-6 py-4 font-medium">{item.name}</td>
                          <td className="px-6 py-4">{item.stock}</td>
                          <td className="px-6 py-4">
                            {item.stock > 0 
                              ? <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200">موجود</span>
                              : <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-200">ناموجود</span>
                            }
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="inline-flex gap-2">
                              <button 
                                onClick={() => handleSelectForEdit(item)}
                                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs cursor-pointer"
                                title="ویرایش کالا"
                              >
                                <Edit size={16} />
                              </button>
                              <button 
                                onClick={() => handleDeleteItem(item.code)}
                                className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-xs cursor-pointer"
                                title="حذف کالا"
                              >
                                <Trash size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                          هیچ کالایی در سیستم ثبت نشده است. کالاها را به صورت دستی ثبت کنید یا فایل اکسل خود را آپلود کنید.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

          {activeTab === 'customers' && (
            <div className="p-0">
              <div className="p-6 border-b border-gray-200 bg-gray-50">
                <h2 className="text-lg font-bold">لیست درخواست‌های مشتریان</h2>
                <p className="text-sm text-gray-500 mt-1">اطلاعات کسانی که در گروه‌ها کد کالاهای موجود را ارسال کرده‌اند.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="bg-gray-50 text-gray-600 text-sm border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 font-medium">زمان درخواست</th>
                      <th className="px-6 py-3 font-medium">کاربر</th>
                      <th className="px-6 py-3 font-medium">گروه</th>
                      <th className="px-6 py-3 font-medium">کالا</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {state?.customers && state.customers.length > 0 ? (
                      [...state.customers].reverse().map((req, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-gray-500" dir="ltr">{new Date(req.date).toLocaleString('fa-IR')}</td>
                          <td className="px-6 py-4">
                            <div className="font-medium">@{req.username}</div>
                            <div className="text-xs text-gray-500 font-mono mt-1">{req.userId}</div>
                          </td>
                          <td className="px-6 py-4">{req.chatTitle}</td>
                          <td className="px-6 py-4">
                            <div className="font-medium">{req.itemName}</div>
                            <div className="text-xs text-gray-500 font-mono mt-1">کد: {req.itemCode}</div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                          تا کنون هیچ درخواستی ثبت نشده است.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'backups' && (
            <div className="p-6 space-y-8">
              {/* Header & Overview */}
              <div className="border-b border-gray-100 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                      <Database className="text-indigo-600" size={24} />
                      مرکز پشتیبان‌گیری و بازگردانی اطلاعات (JSON & Excel)
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-relaxed">
                      تهیه نسخه‌های پشتیبان ساخت‌یافته با مُهر زمانی (شامل تمام اقلام انبار، قوانین اشخاص VIP و بلاک‌لیست، تنظیمات و مشتریان) و بازگردانی ۱۰۰٪ مطمئن.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-3 py-1.5 rounded-lg border border-indigo-200 flex items-center gap-1.5">
                      <Clock size={14} />
                      پشتیبان هوشمند زمان‌دار
                    </span>
                  </div>
                </div>

                {/* Quick Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-5">
                  <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3.5">
                    <span className="text-3xs font-semibold text-blue-700 block">📦 کالاهای انبار</span>
                    <span className="text-lg font-bold text-blue-950 font-mono mt-0.5 block">{(state?.inventory || []).length}</span>
                  </div>
                  <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3.5">
                    <span className="text-3xs font-semibold text-purple-700 block">👥 قوانین اشخاص (VIP/بلاک)</span>
                    <span className="text-lg font-bold text-purple-950 font-mono mt-0.5 block">{(config.userRules || []).length}</span>
                  </div>
                  <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5">
                    <span className="text-3xs font-semibold text-emerald-700 block">📋 سوابق مشتریان</span>
                    <span className="text-lg font-bold text-emerald-950 font-mono mt-0.5 block">{(state?.customers || []).length}</span>
                  </div>
                  <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5">
                    <span className="text-3xs font-semibold text-amber-700 block">🌐 گروه‌های متصل</span>
                    <span className="text-lg font-bold text-amber-950 font-mono mt-0.5 block">{(state?.groups || []).length}</span>
                  </div>
                </div>
              </div>

              {/* 1. Export Section (Downloads) */}
              <div>
                <h3 className="font-bold text-sm text-gray-800 mb-3 flex items-center gap-2">
                  <DownloadCloud size={18} className="text-indigo-600" />
                  ۱. دریافت و دانلود فایل‌های پشتیبان (Export):
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card A: Full JSON Timed Backup */}
                  <div className="bg-gradient-to-br from-indigo-50/70 to-purple-50/40 border border-indigo-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex items-center gap-2 text-indigo-900 font-bold mb-1.5">
                        <Sparkles size={18} className="text-indigo-600" />
                        <h4>پشتیبان جامع JSON (پیشنهادی - زمان‌دار)</h4>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed mb-4">
                        این فایل شامل <strong>۱۰۰٪ کل داده‌ها</strong> (انبار، تمام قوانین اشخاص ویژه و بلاک، تنظیمات ربات و سوابق مشتریان) با نام فایل حاوی تاریخ و ساعت دقیق است و می‌توان آن را مستقیماً در این پنل یا چت تلگرام بازگردانی کرد.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadJsonBackup}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-all shadow-sm cursor-pointer"
                    >
                      <DownloadCloud size={16} />
                      دانلود پشتیبان کامل JSON (زمان‌دار)
                    </button>
                  </div>

                  {/* Card B: Excel Multi-Sheet Backup */}
                  <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                    <div>
                      <div className="flex items-center gap-2 text-emerald-900 font-bold mb-1.5">
                        <FileDown size={18} className="text-emerald-600" />
                        <h4>پشتیبان اکسل چند شیته (.xlsx)</h4>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed mb-4">
                        فایل اکسل تفکیک‌شده شامل شیت‌های مجزای موجودی انبار (<code className="bg-white/80 px-1 py-0.5 rounded text-emerald-800">Inventory</code>)، قوانین اشخاص (<code className="bg-white/80 px-1 py-0.5 rounded text-emerald-800">UserRules</code>) و درخواست‌های مشتریان (<code className="bg-white/80 px-1 py-0.5 rounded text-emerald-800">Customers</code>).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadExcelBackup}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-all shadow-sm cursor-pointer"
                    >
                      <FileDown size={16} />
                      دانلود پشتیبان اکسل (.xlsx)
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. Import & Restore Section */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="font-bold text-sm text-gray-800 mb-3 flex items-center gap-2">
                  <Upload size={18} className="text-purple-600" />
                  ۲. بازگردانی اطلاعات از فایل پشتیبان (Restore & Import):
                </h3>

                {/* Restore Dropzone */}
                <div className="bg-white border-2 border-dashed border-purple-200 hover:border-purple-400 rounded-xl p-6 text-center transition-all bg-purple-50/20">
                  <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Database size={22} />
                  </div>
                  <h4 className="font-bold text-sm text-gray-800">انتخاب فایل پشتیبان JSON جهت بازگردانی</h4>
                  <p className="text-xs text-gray-500 mt-1 max-w-lg mx-auto leading-relaxed">
                    فایل پشتیبان JSON خود را انتخاب کنید تا پیش‌نمایش آن بررسی شده و با تایید شما، تمام انبار، اشخاص و تنظیمات فوراً بازیابی شوند.
                  </p>

                  <div className="mt-4 flex justify-center">
                    <label className="relative inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition shadow-sm cursor-pointer">
                      <Upload size={15} />
                      انتخاب فایل پشتیبان (.json)
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={handleJsonFileSelect}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                    </label>
                  </div>
                </div>

                {/* Restore Preview Confirmation Card */}
                {backupPreview && (
                  <div className="mt-5 bg-purple-50 border border-purple-200 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-purple-200/60 pb-3">
                      <div className="flex items-center gap-2 text-purple-900 font-bold text-sm">
                        <CheckSquare size={18} className="text-purple-600" />
                        <h4>پیش‌نمایش محتوای فایل پشتیبان آماده بازگردانی</h4>
                      </div>
                      <span className="text-2xs bg-purple-200/60 text-purple-800 font-mono px-2 py-0.5 rounded">
                        {jsonFileName}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="bg-white p-3 rounded-lg border border-purple-100">
                        <span className="text-gray-500 text-2xs block">تعداد کالا در انبار:</span>
                        <span className="font-bold text-gray-900 font-mono text-sm">{backupPreview.summary.inventoryCount} کالا</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-purple-100">
                        <span className="text-gray-500 text-2xs block">تعداد قوانین اشخاص:</span>
                        <span className="font-bold text-gray-900 font-mono text-sm">{backupPreview.summary.userRulesCount} شخص</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-purple-100">
                        <span className="text-gray-500 text-2xs block">سوابق مشتریان:</span>
                        <span className="font-bold text-gray-900 font-mono text-sm">{backupPreview.summary.customersCount} مورد</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-purple-100">
                        <span className="text-gray-500 text-2xs block">تاریخ ثبت بکاپ:</span>
                        <span className="font-bold text-gray-900 text-2xs block truncate">{backupPreview.backupDatePersian || 'زمان‌دار'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleCancelRestoreJson}
                        disabled={isRestoringBackup}
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold rounded-lg transition cursor-pointer"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmRestoreJson}
                        disabled={isRestoringBackup}
                        className="flex items-center gap-2 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg transition shadow-sm cursor-pointer disabled:bg-gray-400"
                      >
                        <RefreshCw size={14} className={isRestoringBackup ? 'animate-spin' : ''} />
                        {isRestoringBackup ? 'در حال بازیابی اطلاعات...' : 'تایید و بازگردانی قطعی اطلاعات (Restore)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Telegram Bot In-Chat Restore Guide Box */}
              <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-5 flex gap-3.5 items-start">
                <div className="w-9 h-9 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Bot size={20} />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-sky-950">💡 بازگردانی و پشتیبان‌گیری مستقیم از داخل تلگرام:</h4>
                  <p className="text-xs text-sky-900 leading-relaxed">
                    علاوه بر این پنل، می‌توانید مستقیماً در چت خصوصی با ربات تلگرام از دستور <code className="bg-white px-1 py-0.5 rounded font-mono text-sky-800">/backup</code> یا دکمه شیشه‌ای «💾 پشتیبان‌گیری و بازگردانی» استفاده نمایید. همچنین با ارسال هر فایل <code className="bg-white px-1 py-0.5 rounded font-mono text-sky-800">.json</code> یا <code className="bg-white px-1 py-0.5 rounded font-mono text-sky-800">.xlsx</code> در پی‌وی ربات، سیستم فوراً آن را شناسایی و بازگردانی می‌کند.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 6: PC SYSTEM MANAGER & GITHUB INSTALLER / UPDATER                     */}
          {/* ========================================================================= */}
          {activeTab === 'system_manager' && (
            <div className="p-6 space-y-6">
              
              {/* Top Banner / Terminal Aesthetics */}
              <div className="bg-slate-900 text-slate-100 rounded-2xl p-6 shadow-md border border-slate-800 relative overflow-hidden">
                <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-green-400"></div>
                
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-5 mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-600/30 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                      <Terminal size={26} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">کنسول مدیریت سیستم و بروزرسانی گیت‌هاب (PC & Git)</h3>
                        <span className="bg-blue-500/20 text-blue-300 text-xs px-2.5 py-0.5 rounded-full font-mono border border-blue-400/30">
                          v2.0-PC
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        مدیریت یکپارچه کامپیوتر ویندوز، دریافت سورس از مخزن GitHub، بروزرسانی و مدیریت پروسه‌ها
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { fetchGitStatus(); fetchSystemLogs(); }}
                      disabled={isRefreshingLogs}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition cursor-pointer"
                    >
                      <RefreshCw size={13} className={isRefreshingLogs ? 'animate-spin' : ''} />
                      بروزرسانی وضعیت
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadScriptsZip}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-sm cursor-pointer"
                    >
                      <DownloadCloud size={14} />
                      دانلود فایل‌های اجرایی ویندوز (.zip)
                    </button>
                  </div>
                </div>

                {/* System Diagnostics Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/60">
                    <div className="text-slate-400 text-2xs flex items-center gap-1.5">
                      <Laptop size={13} className="text-cyan-400" />
                      سیستم‌عامل و پلتفرم:
                    </div>
                    <div className="font-bold text-slate-200 font-mono text-xs mt-1">
                      {gitStatus?.platform === 'win32' ? '🪟 Windows PC' : (gitStatus?.platform || 'Node.js Engine')}
                    </div>
                  </div>

                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/60">
                    <div className="text-slate-400 text-2xs flex items-center gap-1.5">
                      <Cpu size={13} className="text-green-400" />
                      نسخه Node.js:
                    </div>
                    <div className="font-bold text-slate-200 font-mono text-xs mt-1">
                      {gitStatus?.nodeVersion || 'v20.x'}
                    </div>
                  </div>

                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/60">
                    <div className="text-slate-400 text-2xs flex items-center gap-1.5">
                      <HardDrive size={13} className="text-yellow-400" />
                      پورت فعال (PORT):
                    </div>
                    <div className="font-bold text-slate-200 font-mono text-xs mt-1">
                      {gitStatus?.port || config.groupId || '3000'}
                    </div>
                  </div>

                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/60">
                    <div className="text-slate-400 text-2xs flex items-center gap-1.5">
                      <Activity size={13} className="text-purple-400" />
                      وضعیت سرویس ربات:
                    </div>
                    <div className="font-bold text-xs mt-1 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${state.isRunning ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></span>
                      <span className={state.isRunning ? 'text-green-400' : 'text-red-400'}>
                        {state.isRunning ? 'در حال اجرا (RUNNING)' : 'متوقف (STOPPED)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 1: GitHub Repository & Live 1-Click Updater */}
              <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-gray-900 text-white flex items-center justify-center shadow-xs">
                      <GitBranch size={19} />
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">تنظیم آدرس مخزن گیت‌هاب و بروزرسانی خودکار (GitHub Updater)</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        آدرس گیت‌هاب پروژه را وارد نمایید و با یک کلیک آخرین آپدیت‌ها را دریافت و کامپایل کنید
                      </p>
                    </div>
                  </div>

                  {gitStatus?.branch && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 text-xs font-mono font-bold rounded-lg border border-gray-200">
                      <GitPullRequest size={13} className="text-blue-600" />
                      Branch: {gitStatus.branch}
                    </span>
                  )}
                </div>

                {/* Git Repository URL Input */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-gray-700">
                    آدرس مخزن گیت‌هاب (GitHub Repository URL):
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={gitRepoInput}
                        onChange={(e) => setGitRepoInput(e.target.value)}
                        placeholder="https://github.com/username/repository.git"
                        className="w-full pl-3 pr-9 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-mono text-gray-900 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-hidden transition"
                        dir="ltr"
                      />
                      <div className="absolute right-3 top-3 text-gray-400">
                        <Globe size={15} />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveGitRepo}
                      disabled={isSavingGitRepo}
                      className="flex items-center justify-center gap-1.5 px-5 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer disabled:bg-gray-400"
                    >
                      <Save size={14} />
                      {isSavingGitRepo ? 'در حال ذخیره...' : 'ذخیره آدرس مخزن'}
                    </button>
                  </div>
                </div>

                {/* Git Commit Details Card */}
                {gitStatus && (
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">آخرین کامیت:</span>
                        <code className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded font-mono font-bold text-2xs">
                          {gitStatus.commitHash}
                        </code>
                        <span className="text-gray-700 font-medium truncate max-w-xs">{gitStatus.commitMessage}</span>
                      </div>
                      <span className="text-gray-400 text-2xs font-mono">{gitStatus.commitDate}</span>
                    </div>
                  </div>
                )}

                {/* Action: 1-Click Update Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRunGitUpdate}
                    disabled={isUpdatingGit}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-sm rounded-xl transition shadow-md cursor-pointer disabled:from-gray-400 disabled:to-gray-500"
                  >
                    <RefreshCw size={17} className={isUpdatingGit ? 'animate-spin' : ''} />
                    {isUpdatingGit 
                      ? 'در حال دریافت آخرین سورس کد از گیت‌هاب و کامپایل...' 
                      : '🚀 دریافت آخرین نسخه و بروزرسانی خودکار از گیت‌هاب (Update from GitHub)'
                    }
                  </button>
                </div>

                {/* Live Update Output Terminal */}
                {gitUpdateLogs.length > 0 && (
                  <div className="mt-4 bg-slate-950 text-slate-200 rounded-xl p-4 font-mono text-xs border border-slate-800 space-y-1.5 max-h-56 overflow-y-auto" dir="ltr">
                    <div className="text-slate-400 text-2xs border-b border-slate-800 pb-1 mb-2 flex items-center justify-between" dir="rtl">
                      <span className="flex items-center gap-1.5 text-slate-300 font-bold">
                        <Terminal size={12} />
                        لاگ خروجی فرآیند بروزرسانی (Live Update Console):
                      </span>
                      {gitUpdateSuccess !== null && (
                        <span className={`px-2 py-0.5 rounded text-2xs font-sans ${gitUpdateSuccess ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                          {gitUpdateSuccess ? 'موفقیت‌آمیز' : 'دارای خطا'}
                        </span>
                      )}
                    </div>
                    {gitUpdateLogs.map((log, idx) => (
                      <div key={idx} className="leading-relaxed">
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION 2: PC Command Menu (مشابه منوی لینوکس) */}
              <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                      <Laptop size={19} />
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">منوی تعاملی و هوشمند لینوکسی در محیط ویندوز (Windows CLI Menu)</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        دقیقاً همان منوی شماره‌دار لینوکس با اجرای فایل‌های <code className="font-mono text-blue-600 font-bold">menu.bat</code> یا <code className="font-mono text-blue-600 font-bold">install.bat</code> در ویندوز بالا می‌آید
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadScriptsZip}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition cursor-pointer"
                  >
                    <DownloadCloud size={14} />
                    دانلود فایل‌های منو (.bat)
                  </button>
                </div>

                {/* Terminal simulation card */}
                <div className="bg-slate-900 text-slate-200 rounded-xl p-5 font-mono text-xs border border-slate-800 space-y-2 shadow-inner" dir="ltr">
                  <div className="text-cyan-400 text-center font-bold pb-2 border-b border-slate-800">
                    === Telegram Inventory Bot - PC Manager ===
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 pt-2 text-2xs sm:text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-bold">1)</span>
                      <span>Full Install / Reinstall from GitHub</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-bold">2)</span>
                      <span>Update Bot from GitHub</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-bold">3)</span>
                      <span>Set/Change GitHub Repo URL</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-bold">4)</span>
                      <span>Restart Bot Service</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-bold">5)</span>
                      <span>Stop Bot Service</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-cyan-400 font-bold">6)</span>
                      <span>Check Service & System Status</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-cyan-400 font-bold">7)</span>
                      <span>View Live Server Logs</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-400 font-bold">8)</span>
                      <span>Change Port, Proxy & Config</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-400 font-bold">9)</span>
                      <span>Windows Auto-Start Background Service</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-red-400 font-bold">10)</span>
                      <span>Uninstall Bot & Clean up</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
                  <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200/80 space-y-1">
                    <span className="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
                      <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xs">1</span>
                      اجرای منو در ویندوز:
                    </span>
                    <p className="text-gray-500 text-2xs leading-relaxed">
                      روی فایل <code className="bg-white px-1.5 py-0.5 rounded border border-gray-300 font-mono text-blue-700">menu.bat</code> دوبار کلیک کنید تا منوی مدیریت فوری باز شود.
                    </p>
                  </div>

                  <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200/80 space-y-1">
                    <span className="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
                      <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xs">2</span>
                      شروع سریع در پس‌زمینه:
                    </span>
                    <p className="text-gray-500 text-2xs leading-relaxed">
                      با انتخاب گزینه 9 یا اجرای <code className="bg-white px-1.5 py-0.5 rounded border border-gray-300 font-mono text-blue-700">install-windows-service.bat</code> ربات همیشه در پس‌زمینه فعال می‌ماند.
                    </p>
                  </div>

                  <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200/80 space-y-1">
                    <span className="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
                      <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xs">3</span>
                      بروزرسانی مستقیم از گیت‌هاب:
                    </span>
                    <p className="text-gray-500 text-2xs leading-relaxed">
                      هم در ویندوز با زدن عدد 2 و هم در همین پنل با دکمه آبی بالا، کدها بدون نیاز به تایپ دستور بروز می‌شوند.
                    </p>
                  </div>
                </div>
              </div>

              {/* SECTION 3: Service Quick Actions & Health */}
              <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Wrench size={18} className="text-gray-700" />
                    <h4 className="font-bold text-gray-900 text-sm">عملیات سریع سرویس و سرور</h4>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleServiceAction('restart')}
                    disabled={isExecutingServiceAction}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer disabled:bg-gray-400"
                  >
                    <RefreshCw size={14} className={isExecutingServiceAction ? 'animate-spin' : ''} />
                    راه‌اندازی مجدد ربات و مانیتورینگ (Restart Service)
                  </button>

                  <button
                    type="button"
                    onClick={() => handleServiceAction('stop')}
                    disabled={isExecutingServiceAction || !state.isRunning}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer disabled:bg-gray-300"
                  >
                    <Square size={14} className="fill-current" />
                    توقف موقت سرویس ربات (Stop Service)
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/health');
                        const data = await res.json();
                        showMessage(`سرور فعال است (Uptime: ${Math.floor(data.uptime)} ثانیه)`, 'success');
                      } catch (e) {
                        showMessage('خطا در پاسخ‌دهی سرور', 'error');
                      }
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    <Activity size={14} className="text-green-600" />
                    تست سلامت پورت و سرور (Health Check)
                  </button>
                </div>
              </div>

              {/* SECTION 4: Live System Activity Logs */}
              <div className="bg-slate-900 text-slate-200 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Terminal size={17} className="text-cyan-400" />
                    <h4 className="font-bold text-white text-sm">مشاهده لاگ‌های زنده سیستم (System Live Logs)</h4>
                  </div>
                  <button
                    type="button"
                    onClick={fetchSystemLogs}
                    disabled={isRefreshingLogs}
                    className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg border border-slate-700 transition cursor-pointer"
                  >
                    <RefreshCw size={12} className={isRefreshingLogs ? 'animate-spin' : ''} />
                    بروزرسانی لاگ‌ها
                  </button>
                </div>

                <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs max-h-64 overflow-y-auto space-y-1 text-slate-300 border border-slate-800/80" dir="ltr">
                  {systemLogs.length === 0 ? (
                    <div className="text-slate-500 italic py-2 text-center">
                      هنوز لاگی ثبت نشده است یا سرور تازه راه‌اندازی شده است.
                    </div>
                  ) : (
                    systemLogs.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-slate-500 shrink-0 select-none">[{item.time}]</span>
                        <span className={item.type === 'error' ? 'text-red-400' : item.type === 'warn' ? 'text-yellow-400' : 'text-slate-300'}>
                          {item.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </main>
    </div>
  );
}

