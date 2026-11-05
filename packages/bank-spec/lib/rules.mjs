// 规范常量：docs/题库规范-v2-草案.md 的可执行形式。
// 正则与 src/bank/types.ts 保持一致（test/schema.test.mjs 会逐条比对）。

export const BANK_SCHEMA_VERSION = 2;

export const BANK_ID_PATTERN = /^[a-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const QUESTION_ID_PATTERN = /^q_[0-9A-HJKMNP-TV-Z]{26}$/;
export const KEY_POINT_ID_PATTERN = /^kp[1-9][0-9]{0,2}$/;
export const FOLLOWUP_ID_PATTERN = /^f[1-9][0-9]{0,2}$/;
export const SLUG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ASSET_REF_PATTERN = /^asset:[0-9a-f]{64}\.(png|jpe?g|webp)$/;
export const CHOICE_OPTION_ID_PATTERN = /^[a-z]$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const QUESTION_TYPES = ['concept', 'scenario', 'coding', 'design', 'behavioral', 'choice'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const DEFAULT_IMPORTANCE = 2;
export const DEFAULT_KEYPOINT_WEIGHT = 1;

export const LIMITS = {
  summaryChars: 80,
  summarySentences: 2,
  keyPointsMin: 3,
  keyPointsMax: 5,
  keyPointChars: 40,
  detailCharsWarn: 1500,
  followupAnswerChars: 150,
  codeBlockLines: 40,
  assetBytes: 1024 * 1024,
  choiceOptionsMin: 2,
};

export const FRONT_MATTER_KEYS = [
  'id', 'title', 'type', 'difficulty', 'importance', 'category', 'tags', 'appliesTo',
  'prerequisites', 'related', 'source', 'references', 'reviewedAt', 'estimatedMinutes', 'retired',
];
