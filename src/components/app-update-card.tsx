import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { Download, RefreshCw, Rocket } from 'lucide-react-native';
import {
  type AppRelease,
  UPDATE_RELEASES_API,
  UPDATE_RELEASES_PAGE,
  findExpectedChecksum,
  formatBytes,
  isTrustedDownloadUrl,
  isUpdateAvailable,
  parseRelease,
  parseSha256Sums,
} from '../lib/app-update';
import { withNetworkTimeout } from '../lib/network';
import { computeFileSha256Hex } from '../lib/apk-verify';
import { AppButton, Surface } from './ui';
import { colors, spacing, typography } from '../theme';

/**
 * 应用内更新卡片：检查 → 下载 → 拉起系统安装器。
 *
 * Android 限制（务必知悉）：
 *   - 不能静默安装，最后一步必须由用户点系统确认框
 *   - 覆盖安装要求 versionCode 递增且签名一致
 *
 * 完整性链条：下载地址必须是 GitHub 官方域名（https）→ 发布必须附带
 * SHA256SUMS 且本地哈希比对通过 → 最后交给 Android 安装器做签名校验。
 */
type Phase = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'error';

const CURRENT_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** 下载完成后比对 SHA256SUMS；不匹配直接抛错，绝不给系统安装器 */
async function verifyDownloadedApk(fileUri: string, apkName: string, sumsUrl: string): Promise<void> {
  const sums = await withNetworkTimeout(async (signal) => {
    const response = await fetch(sumsUrl, { headers: { Accept: 'application/octet-stream' }, signal });
    if (!response.ok) throw new Error(`校验文件下载失败（HTTP ${response.status}）`);
    return response.text();
  });
  const expected = findExpectedChecksum(parseSha256Sums(sums), apkName);
  if (!expected) throw new Error(`SHA256SUMS 中没有 ${apkName} 的校验值，已中止安装`);
  const actual = await computeFileSha256Hex(fileUri);
  if (actual !== expected) throw new Error('安装包 SHA256 校验不匹配，可能与发布页上的不一致，已中止安装');
}

export function AppUpdateCard() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const check = useCallback(async () => {
    setPhase('checking');
    setMessage(null);
    setRelease(null);
    try {
      const payload = await withNetworkTimeout(async (signal) => {
        const response = await fetch(UPDATE_RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' }, signal,
        });
        if (response.status === 403 || response.status === 429) {
          throw new Error('检查过于频繁（GitHub 限流），请稍后再试');
        }
        if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`);
        return response.json();
      });
      const latest = parseRelease(payload);
      if (!latest) throw new Error('未找到可用的版本信息');
      if (!latest.apk) throw new Error('最新版本没有提供安装包');
      if (!isTrustedDownloadUrl(latest.apk.downloadUrl)) {
        throw new Error('安装包下载地址不是 GitHub 官方域名，已中止（防止下载链路被篡改）');
      }
      if (!latest.checksums || !isTrustedDownloadUrl(latest.checksums.downloadUrl)) {
        throw new Error('该版本未附带可用的 SHA256SUMS 校验文件，已中止下载（防止安装包被篡改）');
      }

      setRelease(latest);
      if (isUpdateAvailable(CURRENT_VERSION, latest.version)) {
        setPhase('available');
      } else {
        setPhase('upToDate');
      }
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!release?.apk) return;
    setPhase('downloading');
    setMessage(null);
    const target = `${FileSystem.cacheDirectory}facee-update-${release.version}.apk`;
    try {
      const info = await FileSystem.getInfoAsync(target);
      const needsDownload = !info.exists || (info.size ?? 0) !== release.apk.sizeBytes;
      if (needsDownload) {
        await FileSystem.deleteAsync(target, { idempotent: true });
        const result = await FileSystem.downloadAsync(release.apk.downloadUrl, target);
        if (result.status !== 200) throw new Error(`下载失败（HTTP ${result.status}）`);
      }
      if (!release.checksums) throw new Error('该版本没有校验文件，已中止安装');
      await verifyDownloadedApk(target, release.apk.name, release.checksums.downloadUrl);

      setPhase('ready');
      setInstalling(true);
      // 把 file:// 换成 content:// 才能跨应用交给系统安装器
      const contentUri = await FileSystem.getContentUriAsync(target);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/vnd.android.package-archive',
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
    } catch (error) {
      setPhase('error');
      setInstalling(false);
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(
        /Activity not found|no Activity/i.test(detail)
          ? '没有找到系统安装器；请在「设置 → 应用 → FaceE → 允许安装未知应用」中打开权限后重试'
          : detail,
      );
    }
  }, [release]);

  return (
    <Surface style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.icon}><Rocket size={21} color={colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.copy}>
          <Text style={styles.label}>应用更新</Text>
          <Text style={styles.value}>当前版本 {CURRENT_VERSION}</Text>
        </View>
      </View>

      {phase === 'checking' ? (
        <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={styles.hint}>正在检查更新…</Text></View>
      ) : null}

      {phase === 'upToDate' ? <Text style={styles.hint}>已是最新版本。</Text> : null}

      {phase === 'available' || phase === 'downloading' || phase === 'ready' ? (
        <View style={styles.releaseBox}>
          <Text style={styles.releaseTitle}>发现新版本 {release?.version}</Text>
          <Text style={styles.releaseMeta}>
            {release?.apk ? formatBytes(release.apk.sizeBytes) : ''}
            {release?.publishedAt ? ` · ${release.publishedAt.slice(0, 10)}` : ''}
          </Text>
          {release?.notes ? <Text style={styles.notes} numberOfLines={6}>{release.notes}</Text> : null}
          <Text style={styles.notice}>
            安装前会从发布页下载 SHA256SUMS 校验安装包；安装时系统会弹出确认框（Android 不允许应用静默安装）。首次使用需在系统设置里允许 FaceE 安装应用。
          </Text>
        </View>
      ) : null}

      {phase === 'downloading' ? (
        <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={styles.hint}>正在下载安装包…</Text></View>
      ) : null}

      {installing ? <Text style={styles.hint}>已拉起系统安装器，请在弹窗中确认安装。</Text> : null}

      {message ? <Text style={styles.error}>{message}</Text> : null}

      <View style={styles.actions}>
        {phase === 'available' || phase === 'downloading' || phase === 'ready' ? (
          <AppButton
            label={installing ? '重新拉起安装器' : '下载并安装'}
            icon={Download}
            loading={phase === 'downloading'}
            onPress={() => void downloadAndInstall()}
            accessibilityHint="下载新版安装包并打开系统安装界面"
            style={styles.button}
          />
        ) : (
          <AppButton
            label={phase === 'checking' ? '检查中…' : '检查更新'}
            icon={RefreshCw}
            loading={phase === 'checking'}
            onPress={() => void check()}
            accessibilityHint="从 GitHub 查询最新版本"
            style={styles.button}
          />
        )}
      </View>

      <Text style={styles.link} onPress={() => void Linking.openURL(UPDATE_RELEASES_PAGE)}>
        在浏览器中打开发布页
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg },
  heading: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, marginLeft: spacing.md },
  label: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.bodyStrong, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg },
  releaseBox: { marginTop: spacing.lg, padding: spacing.md, borderRadius: 8, backgroundColor: colors.surfaceMuted },
  releaseTitle: { ...typography.bodyStrong, color: colors.text },
  releaseMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  notes: { ...typography.caption, color: colors.text, marginTop: spacing.sm },
  notice: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  actions: { marginTop: spacing.lg },
  button: {},
  link: { ...typography.caption, color: colors.primary, marginTop: spacing.md, textAlign: 'center' },
});
