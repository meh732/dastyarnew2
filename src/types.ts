export interface InventoryItem {
  code: string;
  name: string;
  stock: number;
}

export interface UserRule {
  id: string;
  target: string; // numeric User ID (e.g. 123456789) or @username
  name?: string; // Optional label/note e.g. "همکار مهم", "رقیب", "اسپمر"
  action: 'ALWAYS_NOTIFY' | 'NEVER_NOTIFY'; // ALWAYS_NOTIFY = notify even if not in inventory, NEVER_NOTIFY = ignore even if item matches
  enabled: boolean;
  forwardMessage?: boolean;
  notes?: string;
  createdAt?: string;
}

export interface BotConfig {
  token: string;
  adminId: string;
  groupId?: string;
  customerMessage?: string;
  groupAccess?: 'all' | 'admin' | 'group_admins';
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

export interface CustomerRequest {
  userId: string;
  username: string;
  chatId: string;
  chatTitle: string;
  itemCode: string;
  itemName: string;
  date: string;
}

export interface DetectedGroup {
  id: string;
  title: string;
  username?: string;
  lastActive: string;
}

export interface AppState {
  config: BotConfig;
  inventory: InventoryItem[];
  customers: CustomerRequest[];
  isRunning: boolean;
  groups?: DetectedGroup[];
}

export interface FullBackupData {
  app: string;
  version: string;
  backupTimestamp: string;
  backupDatePersian?: string;
  summary: {
    inventoryCount: number;
    userRulesCount: number;
    customersCount: number;
    groupsCount: number;
  };
  inventory: InventoryItem[];
  userRules: UserRule[];
  config: Partial<BotConfig>;
  customers?: CustomerRequest[];
  groups?: DetectedGroup[];
}

export interface GitStatusInfo {
  isGitRepo: boolean;
  repoUrl: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  commitAuthor: string;
  commitDate: string;
  nodeVersion: string;
  platform: string;
  port: string | number;
  botRunning: boolean;
  userbotActive: boolean;
}

export interface SystemLogEntry {
  time: string;
  message: string;
  type: 'info' | 'error' | 'warn';
}


