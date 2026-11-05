import * as fs from 'node:fs';
import { createTestRuntime, publish, sha256Hex, type TestRuntime } from '../__fixtures__/node-runtime';
import { finalize, QID, SAMPLE_ASSET_CONTENT, SAMPLE_ASSET_NAME, SAMPLE_BANK_ID, sampleBundle } from '../__fixtures__/sample-bank';
import {
  addBankFromBundleFile,
  addBankFromManifestUrl,
  checkForUpdate,
  getAssetBaseUri,
  resolveAssetRef,
  resolveAssetUri,
  rewriteMarkdownAssets,
  updateBank,
} from '../install';
import { getQuestion, getBank, listQuestions } from '../repository';
import { setMastery } from '../learning';
import type { BankDatabase, SqlExecutor } from '../db/types';
import type { BankError } from '../errors';

const ASSETS = { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT };

async function counts(db: SqlExecutor, bankId = SAMPLE_BANK_ID) {
  const q = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM questions WHERE bank_id = ?', [bankId]);
  const f = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM question_fts WHERE bank_id = ?', [bankId]);
  const t = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM question_tags WHERE bank_id = ?', [bankId]);
  return { questions: q?.n, fts: f?.n, tags: t?.n };
}

async function expectBankError(promise: Promise<unknown>, code: string, message?: string | RegExp): Promise<BankError> {
  try {
    await promise;
  } catch (error) {
    const bankError = error as BankError;
    expect(bankError.code).toBe(code);
    if (message) expect(bankError.message).toMatch(message);
    return bankError;
  }
  throw new Error('expected rejection');
}

describe('安装器', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    t = await createTestRuntime();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it('从 latest.json 安装：校验、导入、FTS、资源解压到 bank-assets/<hash>/', async () => {
    const url = publish(t, sampleBundle(), { assets: ASSETS });
    const stages: string[] = [];
    const result = await addBankFromManifestUrl(t.rt, url, { onProgress: (p) => stages.push(p.stage) });
    expect(result).toMatchObject({ bankId: SAMPLE_BANK_ID, version: '1.0.0', previousVersion: null, questionCount: 5, origin: 'remote' });
    expect(stages).toEqual(['manifest', 'bundle', 'assets', 'import', 'cleanup']);
    expect(await counts(t.db)).toEqual({ questions: 5, fts: 5, tags: 5 });

    const bank = await getBank(t.rt, SAMPLE_BANK_ID);
    expect(bank).toMatchObject({ origin: 'remote', manifestUrl: url, name: '测试题库', homepage: 'https://example.com/sample' });

    const base = await getAssetBaseUri(t.rt, SAMPLE_BANK_ID);
    expect(base).toMatch(/\/documents\/bank-assets\/[0-9a-f]{16}-[^/]+\/$/);
    const assetUri = await resolveAssetUri(t.rt, SAMPLE_BANK_ID, `asset:${SAMPLE_ASSET_NAME}`);
    expect(assetUri).toBe(`${base}${SAMPLE_ASSET_NAME}`);
    expect(fs.readFileSync(assetUri as string, 'utf8')).toBe(SAMPLE_ASSET_CONTENT);
    expect(await resolveAssetUri(t.rt, SAMPLE_BANK_ID, 'asset:not-a-hash.png')).toBeNull();

    const detail = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.redisExpire);
    expect(detail?.question.answer.detail).toContain(`](${base}${SAMPLE_ASSET_NAME})`);
    expect(detail?.raw.answer.detail).toContain(`](asset:${SAMPLE_ASSET_NAME})`);
    // 暂存目录已清理
    expect(fs.readdirSync(`${t.root}/cache/bank-staging`)).toEqual([]);
  });

  it('Markdown 资源改写与同步解析', () => {
    const md = `a ![x](asset:${SAMPLE_ASSET_NAME}) b [y]( asset:${SAMPLE_ASSET_NAME})`;
    expect(rewriteMarkdownAssets(md, 'file:///d/')).toBe(`a ![x](file:///d/${SAMPLE_ASSET_NAME}) b [y](file:///d/${SAMPLE_ASSET_NAME})`);
    expect(rewriteMarkdownAssets(md, null)).toBe(md);
    expect(rewriteMarkdownAssets(null, 'file:///d/')).toBeNull();
    expect(resolveAssetRef('file:///d/', `asset:${SAMPLE_ASSET_NAME}`)).toBe(`file:///d/${SAMPLE_ASSET_NAME}`);
    expect(resolveAssetRef(null, `asset:${SAMPLE_ASSET_NAME}`)).toBeNull();
  });

  it('bundle 的 sha256 或大小不符时拒绝，且不写入任何数据', async () => {
    const url = publish(t, sampleBundle(), { tweak: (m) => (m.bundle.sha256 = 'f'.repeat(64)) });
    await expectBankError(addBankFromManifestUrl(t.rt, url), 'integrity', /sha256/);
    const url2 = publish(t, sampleBundle(), { base: 'https://example.com/other', tweak: (m) => (m.bundle.size += 1) });
    await expectBankError(addBankFromManifestUrl(t.rt, url2), 'integrity', /大小不符/);
    expect(await counts(t.db)).toEqual({ questions: 0, fts: 0, tags: 0 });
    expect(await getBank(t.rt, SAMPLE_BANK_ID)).toBeNull();
  });

  it('主地址失败时按顺序尝试 mirrors', async () => {
    const url = publish(t, sampleBundle(), {
      assets: ASSETS,
      tweak: (m) => {
        const real = m.bundle.url;
        m.bundle.mirrors = [real];
        m.bundle.url = 'https://down.example.com/bundle.json';
      },
    });
    await addBankFromManifestUrl(t.rt, url);
    expect(t.requests.get('https://down.example.com/bundle.json')).toBe(1);
    expect((await counts(t.db)).questions).toBe(5);
  });

  it('资源文件内容与文件名哈希不符时拒绝；资源包缺少被引用文件时拒绝', async () => {
    const wrong = { [SAMPLE_ASSET_NAME]: 'tampered' };
    await expectBankError(addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: wrong })), 'integrity', /哈希不符/);
    const other = `${sha256Hex('other')}.png`;
    await expectBankError(
      addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: { [other]: 'other' } })),
      'integrity',
      /缺少/,
    );
    await expectBankError(addBankFromManifestUrl(t.rt, publish(t, sampleBundle())), 'integrity', /没有提供资源包/);
    expect(fs.existsSync(`${t.root}/documents/bank-assets`) ? fs.readdirSync(`${t.root}/documents/bank-assets`) : []).toEqual([]);
  });

  it('minAppVersion 高于 App 版本时提示先升级 App；schemaVersion 3 提示升级', async () => {
    const url = publish(t, sampleBundle(), { assets: ASSETS, tweak: (m) => (m.minAppVersion = '9.0.0') });
    await expectBankError(addBankFromManifestUrl(t.rt, url), 'app-too-old', /9\.0\.0.*请先升级 App/);
    const url2 = publish(t, sampleBundle(), { base: 'https://example.com/v3', tweak: (m) => ((m as unknown as { schemaVersion: number }).schemaVersion = 3) });
    await expectBankError(addBankFromManifestUrl(t.rt, url2), 'schema-version', /升级 FaceE App/);
  });

  it('网络失败映射为 network 错误', async () => {
    await expectBankError(addBankFromManifestUrl(t.rt, 'https://nowhere.example.com/latest.json'), 'network');
    await expectBankError(addBankFromManifestUrl(t.rt, 'ftp://x'), 'invalid');
  });

  it('导入中途失败时（事务内）旧版本完整保留，新资源目录被删除', async () => {
    await addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: ASSETS }));
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
    const before = await counts(t.db);
    const oldBase = await getAssetBaseUri(t.rt, SAMPLE_BANK_ID);

    // 包装数据库：事务内第 3 条 FTS 批量插入时抛错
    const realDb = t.db;
    let ftsInserts = 0;
    const failing: BankDatabase = {
      ...realDb,
      withExclusiveTransactionAsync: (task) =>
        realDb.withExclusiveTransactionAsync((tx) =>
          task({
            ...tx,
            runAsync: async (sql, params) => {
              if (sql.startsWith('INSERT INTO question_fts')) {
                ftsInserts += 1;
                throw new Error('disk I/O error');
              }
              return tx.runAsync(sql, params);
            },
          }),
        ),
    };
    const v2 = sampleBundle('1.1.0');
    v2.questions[1].answer.summary = '改过的一句话。';
    v2.questions[1] = finalize(v2.questions[1]);
    const url = publish(t, v2, { assets: { ...ASSETS, [`${sha256Hex('new')}.png`]: 'new' } });
    await expectBankError(addBankFromManifestUrl({ ...t.rt, db: failing }, url), 'unknown', /已保留原有数据/);
    expect(ftsInserts).toBe(1);

    expect(await counts(t.db)).toEqual(before);
    expect((await getBank(t.rt, SAMPLE_BANK_ID))?.version).toBe('1.0.0');
    expect(await getAssetBaseUri(t.rt, SAMPLE_BANK_ID)).toBe(oldBase);
    expect(fs.readdirSync(`${t.root}/documents/bank-assets`)).toHaveLength(1);
    const list = await listQuestions(t.rt, SAMPLE_BANK_ID, { mastery: ['known'] });
    expect(list.map((q) => q.id)).toEqual([QID.redisExpire]);
  });

  it('检查更新只拉清单：按 contentHash 得出新增 / 修改 / 删除；updateBank 安装新版并清理旧资源', async () => {
    await addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: ASSETS }));
    const oldBase = (await getAssetBaseUri(t.rt, SAMPLE_BANK_ID)) as string;

    const v2 = sampleBundle('1.1.0');
    v2.questions[1].answer.summary = 'RDB 快照与 AOF 日志。';
    v2.questions[1] = finalize(v2.questions[1]);
    v2.questions = v2.questions.filter((q) => q.id !== QID.tcpHandshake);
    v2.lifecycle.removed.push(QID.tcpHandshake);
    v2.questions.push(finalize({ ...v2.questions[1], id: QID.kafkaNew, title: 'Kafka 如何保证顺序？' }));
    const newAsset = `${sha256Hex('v2-image')}.png`;
    publish(t, v2, { assets: { ...ASSETS, [newAsset]: 'v2-image' }, changes: '新增 Kafka 题' });
    const bundleUrl = 'https://example.com/sample/bundle-1.1.0.json';
    const bundleRequestsBefore = t.requests.get(bundleUrl) ?? 0;

    const check = await checkForUpdate(t.rt, SAMPLE_BANK_ID);
    expect(check).toMatchObject({
      hasUpdate: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
      changes: '新增 Kafka 题',
      added: [QID.kafkaNew],
      changed: [QID.redisPersist],
      removed: [QID.tcpHandshake],
      appTooOld: false,
    });
    expect(t.requests.get(bundleUrl) ?? 0).toBe(bundleRequestsBefore);
    expect((await getBank(t.rt, SAMPLE_BANK_ID))?.lastCheck?.version).toBe('1.1.0');

    const result = await updateBank(t.rt, SAMPLE_BANK_ID);
    expect(result).toMatchObject({ version: '1.1.0', previousVersion: '1.0.0', questionCount: 5 });
    const newBase = (await getAssetBaseUri(t.rt, SAMPLE_BANK_ID)) as string;
    expect(newBase).not.toBe(oldBase);
    expect(fs.existsSync(oldBase)).toBe(false);
    expect(fs.existsSync(`${newBase}${newAsset}`)).toBe(true);
    expect((await getBank(t.rt, SAMPLE_BANK_ID))?.lastCheck).toBeNull();
    expect((await checkForUpdate(t.rt, SAMPLE_BANK_ID)).hasUpdate).toBe(false);
  });

  it('资源包 sha256 未变时复用旧资源目录、不重复下载', async () => {
    await addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: ASSETS }));
    const base = await getAssetBaseUri(t.rt, SAMPLE_BANK_ID);
    const v2 = sampleBundle('1.0.1');
    publish(t, v2, { assets: ASSETS });
    const zipUrl = 'https://example.com/sample/assets-1.0.1.zip';
    await updateBank(t.rt, SAMPLE_BANK_ID);
    expect(t.requests.get(zipUrl) ?? 0).toBe(0);
    expect(await getAssetBaseUri(t.rt, SAMPLE_BANK_ID)).toBe(base);
    expect(fs.existsSync(`${base}${SAMPLE_ASSET_NAME}`)).toBe(true);
  });

  it('更新时清单 bankId 不符则拒绝', async () => {
    await addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: ASSETS }));
    const other = sampleBundle();
    other.bank.id = 'github.com/other/bank';
    publish(t, other, { assets: ASSETS });
    await expectBankError(updateBank(t.rt, SAMPLE_BANK_ID), 'invalid', /不一致/);
  });

  it('从本地 bundle 文件导入：带 update.manifest 视为在线题库，否则为文件题库', async () => {
    const withManifest = t.writeLocalFile('a.json', JSON.stringify(sampleBundle()));
    const result = await addBankFromBundleFile(t.rt, withManifest);
    expect(result.origin).toBe('remote');
    expect((await getBank(t.rt, SAMPLE_BANK_ID))?.manifestUrl).toBe('https://example.com/sample/latest.json');

    const plain = sampleBundle();
    plain.bank.id = 'example.com/someone/shared';
    delete plain.bank.update;
    const result2 = await addBankFromBundleFile(t.rt, t.writeLocalFile('b.json', JSON.stringify(plain)));
    expect(result2.origin).toBe('file');
    await expectBankError(checkForUpdate(t.rt, 'example.com/someone/shared'), 'forbidden');

    await expectBankError(addBankFromBundleFile(t.rt, t.writeLocalFile('c.json', '{oops')), 'invalid', /JSON/);
    await expectBankError(addBankFromBundleFile(t.rt, `${t.root}/missing.json`), 'not-found');
  });
});
