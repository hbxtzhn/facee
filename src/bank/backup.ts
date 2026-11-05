import { BankError } from './errors';
import { installBundle } from './install';
import { exportBundle } from './local';
import { joinUri } from './platform';
import type { SqlValue } from './db/types';
import type { BankRuntime } from './runtime-types';
import type { Bundle } from './types';
import { compareSemver, validateBundle, validationError } from './validate';

/**
 * 备份 / 恢复（§6.2）：一个 JSON 文件 = 全部题库的学习数据 + 本地自建题库的 bundle + 已安装题库清单。
 *
 * - 不含在线题库内容（恢复后可按 `banks[].manifestUrl` 重新添加）；
 * - 本地题库不支持图片资源，因此备份始终是纯 JSON（无需 ZIP）；
 * - 恢复 = 合并：按主键合并，较新（updated_at 较大）的记录胜出；收藏与要点自评取并集；
 *   本地题库仅在不存在或备份中的版本更高时导入。
 */

export const BACKUP_FORMAT = 'facee-bank-backup';
export const BACKUP_VERSION = 1;

type Row = Record<string, SqlValue>;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  appVersion: string;
  banks: Array<{ id: string; origin: string; name: string; version: string; manifestUrl: string | null }>;
  localBanks: Bundle[];
  learning: {
    progress: Row[];
    keypointChecks: Row[];
    followupProgress: Row[];
    favorites: Row[];
    sessions: Row[];
    sections: Row[];
    sectionCategories: Row[];
  };
}

export interface BackupImportResult {
  /** 导入或更新的本地题库 id */
  importedLocalBanks: string[];
  /** 已有更新版本而跳过的本地题库 id */
  skippedLocalBanks: string[];
  /** 备份里有、本机未安装的在线题库（UI 可提示重新添加） */
  missingRemoteBanks: Array<{ id: string; name: string; manifestUrl: string }>;
  /** 各学习数据表写入（新增或覆盖）的行数 */
  merged: Record<keyof BackupFile['learning'], number>;
}

const TABLES: Record<keyof BackupFile['learning'], { table: string; columns: string[]; key: string[]; merge: 'newer' | 'union' }> = {
  progress: {
    table: 'progress',
    columns: ['bank_id', 'question_id', 'mastery', 'streak', 'due_at', 'marked_at', 'seen_hash', 'viewed_at', 'archived_at', 'updated_at'],
    key: ['bank_id', 'question_id'],
    merge: 'newer',
  },
  keypointChecks: {
    table: 'keypoint_checks',
    columns: ['bank_id', 'question_id', 'keypoint_id', 'checked_at', 'covered'],
    key: ['bank_id', 'question_id', 'keypoint_id', 'checked_at'],
    merge: 'union',
  },
  followupProgress: {
    table: 'followup_progress',
    columns: ['bank_id', 'question_id', 'followup_id', 'mastery', 'updated_at'],
    key: ['bank_id', 'question_id', 'followup_id'],
    merge: 'newer',
  },
  favorites: {
    table: 'favorites',
    columns: ['bank_id', 'question_id', 'created_at', 'archived_at'],
    key: ['bank_id', 'question_id'],
    merge: 'union',
  },
  sessions: {
    table: 'sessions',
    columns: ['bank_id', 'queue', 'idx', 'mode', 'title', 'updated_at'],
    key: ['bank_id'],
    merge: 'newer',
  },
  sections: {
    table: 'user_sections',
    columns: ['bank_id', 'id', 'name', 'sort', 'created_at', 'updated_at'],
    key: ['bank_id', 'id'],
    merge: 'newer',
  },
  sectionCategories: {
    table: 'user_section_categories',
    columns: ['bank_id', 'section_id', 'category_id', 'sort'],
    key: ['bank_id', 'section_id', 'category_id'],
    merge: 'union',
  },
};

/** NOT NULL 列（其余可为 null）；用于恢复前的逐行校验 */
const REQUIRED: Record<string, string[]> = {
  progress: ['bank_id', 'question_id', 'streak', 'updated_at'],
  keypoint_checks: ['bank_id', 'question_id', 'keypoint_id', 'checked_at', 'covered'],
  followup_progress: ['bank_id', 'question_id', 'followup_id', 'mastery', 'updated_at'],
  favorites: ['bank_id', 'question_id', 'created_at'],
  sessions: ['bank_id', 'queue', 'idx', 'mode', 'updated_at'],
  user_sections: ['bank_id', 'id', 'name', 'sort', 'created_at', 'updated_at'],
  user_section_categories: ['bank_id', 'section_id', 'category_id', 'sort'],
};

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

/** 生成备份对象 */
export async function createBackup(rt: BankRuntime): Promise<BackupFile> {
  const banks = await rt.db.getAllAsync<{ id: string; origin: string; name: string; version: string; manifest_url: string | null }>(
    'SELECT id, origin, name, version, manifest_url FROM banks ORDER BY installed_at, id',
  );
  const localBanks: Bundle[] = [];
  for (const bank of banks) if (bank.origin === 'local') localBanks.push(await exportBundle(rt, bank.id));
  const learning = {} as BackupFile['learning'];
  for (const [name, spec] of Object.entries(TABLES) as Array<[keyof BackupFile['learning'], (typeof TABLES)[keyof typeof TABLES]]>) {
    learning[name] = await rt.db.getAllAsync<Row>(
      `SELECT ${spec.columns.join(', ')} FROM ${spec.table} ORDER BY ${spec.key.join(', ')}`,
    );
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now(rt),
    appVersion: rt.platform.appVersion,
    banks: banks.map((b) => ({ id: b.id, origin: b.origin, name: b.name, version: b.version, manifestUrl: b.manifest_url })),
    localBanks,
    learning,
  };
}

/** 导出备份到缓存目录，返回文件 URI（UI 再交给系统分享 / 保存） */
export async function exportBackupFile(rt: BankRuntime): Promise<string> {
  const backup = await createBackup(rt);
  const dir = joinUri(rt.platform.cacheDirectory, 'bank-exports/');
  await rt.platform.makeDirectory(dir);
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const uri = joinUri(dir, `facee-backup-${stamp}.json`);
  await rt.platform.writeText(uri, JSON.stringify(backup));
  return uri;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验备份结构并返回规整后的对象；问题列表带路径 */
export function parseBackup(value: unknown): BackupFile {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) throw new BankError('invalid', '不是 FaceE 题库备份文件');
  if (value.version !== BACKUP_VERSION) {
    throw new BankError('schema-version', `备份格式版本 ${String(value.version)} 不受支持，请升级 App 后再恢复`);
  }
  const errors: string[] = [];
  if (!Array.isArray(value.banks)) errors.push('banks：应为数组');
  if (!Array.isArray(value.localBanks)) errors.push('localBanks：应为数组');
  if (!isRecord(value.learning)) errors.push('learning：应为对象');
  const learning = (isRecord(value.learning) ? value.learning : {}) as Record<string, unknown>;
  for (const [name, spec] of Object.entries(TABLES)) {
    const rows = learning[name];
    if (rows === undefined) {
      learning[name] = [];
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`learning.${name}：应为数组`);
      continue;
    }
    rows.forEach((row, index) => {
      if (!isRecord(row)) return void errors.push(`learning.${name}[${index}]：应为对象`);
      for (const column of spec.columns) {
        const cell = row[column];
        const required = REQUIRED[spec.table].includes(column);
        if (cell === undefined || cell === null) {
          if (required) errors.push(`learning.${name}[${index}].${column}：必填`);
        } else if (typeof cell !== 'string' && typeof cell !== 'number') {
          errors.push(`learning.${name}[${index}].${column}：类型不正确`);
        }
      }
    });
  }
  if (errors.length > 0) throw validationError('备份文件', errors);
  return value as unknown as BackupFile;
}

/** 从备份对象恢复（合并） */
export async function restoreBackup(rt: BankRuntime, input: unknown): Promise<BackupImportResult> {
  const backup = parseBackup(input);
  const result: BackupImportResult = {
    importedLocalBanks: [],
    skippedLocalBanks: [],
    missingRemoteBanks: [],
    merged: { progress: 0, keypointChecks: 0, followupProgress: 0, favorites: 0, sessions: 0, sections: 0, sectionCategories: 0 },
  };

  // 1. 先校验全部本地题库，任何一个不合规则整体不动
  const bundles: Bundle[] = [];
  backup.localBanks.forEach((bundle, index) => {
    const validation = validateBundle(bundle);
    if (!validation.ok) throw validationError(`备份中的第 ${index + 1} 个本地题库`, validation.errors);
    bundles.push(validation.value);
  });
  for (const bundle of bundles) {
    const existing = await rt.db.getFirstAsync<{ version: string; origin: string }>('SELECT version, origin FROM banks WHERE id = ?', [bundle.bank.id]);
    if (existing && (existing.origin !== 'local' || compareSemver(bundle.bank.version, existing.version) <= 0)) {
      result.skippedLocalBanks.push(bundle.bank.id);
      continue;
    }
    await installBundle(rt, bundle);
    result.importedLocalBanks.push(bundle.bank.id);
  }

  // 2. 学习数据：单事务合并
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    const winningSections = new Set<string>();
    for (const [name, spec] of Object.entries(TABLES) as Array<[keyof BackupFile['learning'], (typeof TABLES)[keyof typeof TABLES]]>) {
      if (name === 'sectionCategories') continue;
      for (const row of backup.learning[name]) {
        const values = spec.columns.map((column) => (row[column] ?? null) as SqlValue);
        const placeholders = spec.columns.map(() => '?').join(', ');
        let sql: string;
        if (spec.merge === 'union') {
          sql = `INSERT OR IGNORE INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${placeholders})`;
        } else {
          const updates = spec.columns.filter((c) => !spec.key.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
          sql = `INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${placeholders})
                 ON CONFLICT(${spec.key.join(', ')}) DO UPDATE SET ${updates} WHERE excluded.updated_at > ${spec.table}.updated_at`;
        }
        const { changes } = await tx.runAsync(sql, values);
        result.merged[name] += changes;
        if (name === 'sections' && changes > 0) winningSections.add(`${row.bank_id}\u0000${row.id}`);
      }
    }
    // 分区内容跟随分区本身：备份中的分区胜出时，用备份里的分类列表替换
    for (const key of winningSections) {
      const [bankId, sectionId] = key.split('\u0000');
      await tx.runAsync('DELETE FROM user_section_categories WHERE bank_id = ? AND section_id = ?', [bankId, sectionId]);
    }
    const spec = TABLES.sectionCategories;
    for (const row of backup.learning.sectionCategories) {
      const key = `${row.bank_id}\u0000${row.section_id}`;
      const sectionExists = await tx.getFirstAsync<{ id: string }>('SELECT id FROM user_sections WHERE bank_id = ? AND id = ?', [row.bank_id, row.section_id]);
      if (!sectionExists || !winningSections.has(key)) continue;
      const { changes } = await tx.runAsync(
        `INSERT OR IGNORE INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (?, ?, ?, ?)`,
        spec.columns.map((column) => (row[column] ?? null) as SqlValue),
      );
      result.merged.sectionCategories += changes;
    }
  });

  const installed = new Set((await rt.db.getAllAsync<{ id: string }>('SELECT id FROM banks')).map((b) => b.id));
  for (const bank of backup.banks) {
    if (bank.origin !== 'local' && bank.manifestUrl && !installed.has(bank.id)) {
      result.missingRemoteBanks.push({ id: bank.id, name: bank.name, manifestUrl: bank.manifestUrl });
    }
  }
  return result;
}

/** 读取备份文件并恢复 */
export async function importBackupFile(rt: BankRuntime, uri: string): Promise<BackupImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await rt.platform.readText(uri));
  } catch {
    throw new BankError('invalid', '备份文件无法读取或不是合法的 JSON');
  }
  return restoreBackup(rt, parsed);
}
