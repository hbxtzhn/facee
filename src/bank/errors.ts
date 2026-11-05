/**
 * 题库数据层统一错误类型。`code` 供 UI 分支处理，`message` 是可直接展示的中文。
 */
export type BankErrorCode =
  /** 平台不支持（Web 预览） */
  | 'unsupported'
  /** 尚未 initialize */
  | 'not-ready'
  /** 已有独占操作在进行（安装 / 更新 / 删除 / 备份导入等） */
  | 'busy'
  /** 网络失败 / 超时 / HTTP 非 2xx */
  | 'network'
  /** 下载文件大小或 sha256 不符 */
  | 'integrity'
  /** bundle / manifest / 输入数据不满足规范 */
  | 'invalid'
  /** 题库格式版本不受支持（需升级 App） */
  | 'schema-version'
  /** App 版本低于 minAppVersion */
  | 'app-too-old'
  /** 目标不存在 */
  | 'not-found'
  /** 操作不允许（如编辑非本地题库） */
  | 'forbidden'
  /** 其它意外错误 */
  | 'unknown';

export class BankError extends Error {
  readonly code: BankErrorCode;
  /** 校验失败时的具体问题列表（路径 + 说明） */
  readonly details?: string[];

  constructor(code: BankErrorCode, message: string, details?: string[]) {
    super(message);
    this.name = 'BankError';
    this.code = code;
    this.details = details;
  }
}

export function toBankError(error: unknown): BankError {
  if (error instanceof BankError) return error;
  const message = error instanceof Error && error.message ? error.message : String(error);
  return new BankError('unknown', message || '未知错误');
}
