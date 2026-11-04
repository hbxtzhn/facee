import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CheckSquare, FileText, Square } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { readImportedImage, type ImportedImage } from '../../lib/import-image';
import { useLlmConfigStore, hasUsableLlmConfig } from '../../store/llm-config-store';
import {
  DEFAULT_EXTRACTION_REQUIREMENTS,
  extractQuestionsFromChunks,
  extractQuestionsFromImage,
  type GeneratedQuestionDraft,
} from '../../lib/llm';
import {
  isSupportedImportFileName,
  readImportedText,
  splitTextIntoChunks,
} from '../../lib/import-text';
import { colors, radii, spacing, typography } from '../../theme';
import { AppButton } from '../../components/ui';
import { FieldLabel, ModalSheet, SheetActions, SheetError } from './ModalSheet';

type ImportPhase = 'input' | 'extracting' | 'review';

interface DraftWithKey extends GeneratedQuestionDraft {
  key: string;
}

const DIFFICULTY_LABEL: Record<number, string> = { 1: '简单', 2: '中等', 3: '困难' };

/**
 * AI 导入题目：文本按块抽取，或用户确认后发送单张图片给视觉模型
 * → 预览勾选 → 交给编辑器并入本地题库。依赖「AI 设置」中的 OpenAI 兼容配置。
 * 「抽取要求」可由用户整段修改（对生成结果不满意时自行调整），
 * 题目 JSON 格式段由 App 写死追加，保证解析不被改坏。
 */
export function ImportTextModal({
  visible,
  onClose,
  onConfirm,
  onOpenAiSettings,
}: {
  visible: boolean;
  onClose: () => void;
  /** 确认导入：把勾选的题目草稿交给编辑器 */
  onConfirm: (drafts: GeneratedQuestionDraft[]) => void;
  onOpenAiSettings: () => void;
}) {
  const [phase, setPhase] = useState<ImportPhase>('input');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!visible) reset();
    return () => { request.current?.abort(); };
  }, [visible]);
  const [pastedText, setPastedText] = useState('');
  const [source, setSource] = useState<'text' | 'image'>('text');
  const [image, setImage] = useState<ImportedImage | null>(null);
  const [picking, setPicking] = useState(false);
  const [requirements, setRequirements] = useState(DEFAULT_EXTRACTION_REQUIREMENTS);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [drafts, setDrafts] = useState<DraftWithKey[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [truncatedNotice, setTruncatedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 缺 AI 配置时报错附带「去 AI 设置」直达入口
  const [needsAiSetup, setNeedsAiSetup] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const llmConfig = useLlmConfigStore.getState();
    void (async () => {
      if (!llmConfig.loaded) await llmConfig.load();
      const stored = useLlmConfigStore.getState().extractionPrompt;
      if (active) setRequirements(stored.trim() ? stored : DEFAULT_EXTRACTION_REQUIREMENTS);
    })().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => { active = false; };
  }, [visible]);

  function reset() {
    request.current?.abort();
    request.current = null;
    setPhase('input');
    setPastedText('');
    setSource('text');
    setImage(null);
    setPicking(false);
    setProgress(null);
    setDrafts([]);
    setSelectedKeys(new Set());
    setTruncatedNotice(false);
    setError(null);
    setNeedsAiSetup(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function pickSource(kind: 'text' | 'gallery' | 'image-file') {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPicking(true);
    setError(null);
    try {
      const result = kind === 'gallery'
        ? await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1, exif: false,
        })
        : await DocumentPicker.getDocumentAsync({
          // .md 没有统一 MIME 映射；图片另按内容签名验证，不能只信任文件名。
          type: kind === 'text' ? '*/*' : ['image/jpeg', 'image/png', 'image/webp'],
          copyToCacheDirectory: true, multiple: false,
        });
      if (controller.signal.aborted || result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (kind === 'text') {
        if (!('name' in asset) || !isSupportedImportFileName(asset.name)) {
          setError('只支持 .md / .markdown / .txt 纯文本文件');
          return;
        }
        const text = await readImportedText(asset.uri);
        if (controller.signal.aborted) return;
        request.current = null;
        setPicking(false);
        await startExtraction(text);
      } else {
        const selected = await readImportedImage(asset);
        if (!controller.signal.aborted) setImage(selected);
      }
    } catch (pickError) {
      if (!controller.signal.aborted) setError(pickError instanceof Error ? pickError.message : String(pickError));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPicking(false);
      }
    }
  }

  async function startExtraction(text: string) {
    if (request.current) return;
    if (source === 'image' && !image) { setError('请先选择一张图片'); return; }
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    setNeedsAiSetup(false);
    setPhase('extracting');
    try {
      const llmConfig = useLlmConfigStore.getState();
      if (!llmConfig.loaded) await llmConfig.load();
      if (controller.signal.aborted) return;
      const config = useLlmConfigStore.getState();
      if (!hasUsableLlmConfig(config)) {
        setNeedsAiSetup(true);
        throw new Error('还没有配置 AI 服务：请先在「AI 设置」中填写服务地址、Key 与模型名。');
      }
      const { chunks, truncated } = splitTextIntoChunks(source === 'text' ? text : '');
      if (source === 'text' && chunks.length === 0) throw new Error('文本内容为空');
      setTruncatedNotice(truncated);
      setProgress({ completed: 0, total: source === 'image' ? 1 : chunks.length });
      const trimmedRequirements = requirements.trim();
      await config.saveExtractionPrompt(
        !trimmedRequirements || trimmedRequirements === DEFAULT_EXTRACTION_REQUIREMENTS ? '' : trimmedRequirements,
      );
      if (controller.signal.aborted) return;
      const extractionConfig = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model };
      const options = {
        onProgress: (completed: number, total: number) => { if (!controller.signal.aborted) setProgress({ completed, total }); },
        requirements, signal: controller.signal,
      };
      const extracted = source === 'image' && image
        ? await extractQuestionsFromImage(extractionConfig, image, options)
        : await extractQuestionsFromChunks(extractionConfig, chunks, options);
      if (controller.signal.aborted) return;
      if (extracted.length === 0) throw new Error(source === 'image'
        ? '没有从图片中提取到题目，请选择更清晰、包含完整题干的图片。'
        : '没有从文本中提取到题目，试试换一段更完整的资料。');
      setDrafts(extracted.map((draft, index) => ({ ...draft, key: `draft-${index}` })));
      setSelectedKeys(new Set(extracted.map((_, index) => `draft-${index}`)));
      setPhase('review');
    } catch (extractError) {
      if (controller.signal.aborted) return;
      setError(extractError instanceof Error ? extractError.message : String(extractError));
      setPhase('input');
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function toggleSelect(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <ModalSheet
      visible={visible}
      title="AI 导入题目"
      hint={phase === 'input' ? '从文本或单张图片提取题目，先预览筛选，再导入题库。' : undefined}
      onClose={handleClose}
      footer={
        phase === 'input' ? (
          <SheetActions
            confirmLabel={source === 'image' ? '发送图片并抽取' : '开始抽取'}
            onCancel={() => {
              reset();
              onClose();
            }}
            onConfirm={() => void startExtraction(pastedText)}
            confirmDisabled={picking || (source === 'image' ? !image : !pastedText.trim())}
          />
        ) : phase === 'review' ? (
          <SheetActions
            confirmLabel={`导入 ${selectedKeys.size} 题`}
            confirmDisabled={selectedKeys.size === 0}
            onCancel={() => setPhase('input')}
            onConfirm={() => {
              onConfirm(drafts.filter((draft) => selectedKeys.has(draft.key)));
              reset();
            }}
          />
        ) : null
      }
    >
      <SheetError message={error} />
      {needsAiSetup && phase === 'input' ? (
        <AppButton label="去 AI 设置" variant="ghost" onPress={onOpenAiSettings} style={styles.aiSetupButton} />
      ) : null}
      {truncatedNotice ? (
        <Text style={styles.truncatedText}>文本过长，仅处理前 30 段；建议拆分后分次导入。</Text>
      ) : null}

      {phase === 'input' ? (
        <>
          <View style={styles.sourceTabs}>
            {(['text', 'image'] as const).map((kind) => (
              <Pressable key={kind} accessibilityRole="tab" accessibilityState={{ selected: source === kind }}
                accessibilityLabel={kind === 'text' ? '文本来源' : '图片来源'} disabled={picking}
                onPress={() => { setSource(kind); setError(null); setNeedsAiSetup(false); setTruncatedNotice(false); }}
                style={[styles.sourceTab, source === kind && styles.sourceTabActive]}>
                <Text style={styles.pickTitle}>{kind === 'text' ? '文本' : '图片'}</Text>
              </Pressable>
            ))}
          </View>
          {source === 'text' ? <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择文本文件"
            disabled={picking}
            onPress={() => void pickSource('text')}
            style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]}
          >
            <FileText size={18} color={colors.textSecondary} strokeWidth={1.6} />
            <View style={styles.pickCopy}>
              <Text style={styles.pickTitle}>选择文本文件</Text>
              <Text style={styles.pickHint}>.md / .markdown / .txt</Text>
            </View>
          </Pressable>
          <FieldLabel text="或直接粘贴文本" />
          <TextInput
            value={pastedText}
            onChangeText={setPastedText}
            placeholder="粘贴面经、笔记、课程资料……"
            placeholderTextColor={colors.textSubtle}
            multiline
            style={[styles.input, styles.multiline]}
            accessibilityLabel="粘贴文本内容"
          />
          </> : <>
            <AppButton label="从相册选择图片" variant="ghost" disabled={picking} onPress={() => void pickSource('gallery')} />
            <AppButton label="选择图片文件" variant="ghost" disabled={picking} onPress={() => void pickSource('image-file')} />
            {picking ? <Text style={styles.pickHint}>正在读取图片…</Text> : null}
            {image ? <Image source={{ uri: image.uri }} resizeMode="contain" style={styles.imagePreview} accessibilityLabel="所选图片预览" /> : null}
            <Text style={styles.imageNotice}>
              单张 JPEG / PNG / WebP，最大 8 MB。仅点击「发送图片并抽取」后上传到你配置的 AI 服务，可能产生费用；请避免上传隐私资料。
              模型必须支持图片输入，普通文本模型不可用。图片只用于识别，不会作为附件保存到题库；识别结果请核对后导入。
            </Text>
          </>}
          <FieldLabel text="抽取要求（可修改）" />
          <TextInput
            value={requirements}
            onChangeText={setRequirements}
            placeholder="告诉 AI 怎么抽题，例如：只抽 HTTP 与网络相关的题"
            placeholderTextColor={colors.textSubtle}
            multiline
            maxLength={2000}
            style={[styles.input, styles.requirementsInput]}
            accessibilityLabel="抽取要求提示词"
          />
          <View style={styles.requirementsMeta}>
            <Text style={styles.requirementsHint}>
              题目 JSON 格式由 App 固定，这里只调整 AI 怎么抽题（≤2000 字）。
            </Text>
            {requirements.trim() !== DEFAULT_EXTRACTION_REQUIREMENTS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="恢复默认抽取要求"
                onPress={() => setRequirements(DEFAULT_EXTRACTION_REQUIREMENTS)}
                hitSlop={8}
              >
                <Text style={styles.restoreDefault}>恢复默认</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      {phase === 'extracting' ? (
        <View style={styles.extractingBox}>
          <Text style={styles.extractingTitle}>{source === 'image' ? 'AI 正在识别图片…' : 'AI 正在扫描文本…'}</Text>
          {progress ? (
            <Text style={styles.extractingMeta}>
              {progress.completed}/{progress.total} {source === 'image' ? '张' : '段'}完成
            </Text>
          ) : null}
          <Text style={styles.extractingHint}>长资料可能需要一些时间，请保持网络畅通。</Text>
          <AppButton label="取消抽取" variant="ghost" onPress={() => reset()} />
        </View>
      ) : null}

      {phase === 'review' ? (
        <>
          <Text style={styles.reviewHint}>已识别 {drafts.length} 道题，点按取消不需要的，再点「导入」。</Text>
          {drafts.map((draft) => {
            const selected = selectedKeys.has(draft.key);
            return (
              <Pressable
                key={draft.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${draft.title}，${DIFFICULTY_LABEL[draft.difficulty]}${selected ? '，已选中' : '，未选中'}`}
                onPress={() => toggleSelect(draft.key)}
                style={({ pressed }) => [styles.draftRow, selected && styles.draftRowSelected, pressed && styles.pressed]}
              >
                {selected ? (
                  <CheckSquare size={18} color={colors.primary} strokeWidth={1.6} />
                ) : (
                  <Square size={18} color={colors.textSubtle} strokeWidth={1.6} />
                )}
                <View style={styles.draftInfo}>
                  <Text style={styles.draftTitle} numberOfLines={2}>{draft.title}</Text>
                  <Text style={styles.draftMeta}>
                    {DIFFICULTY_LABEL[draft.difficulty]}
                    {draft.tags.length > 0 ? ` · ${draft.tags.join(' / ')}` : ''}
                    {draft.answerMd ? '' : ' · 无答案'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </>
      ) : null}
    </ModalSheet>
  );
}

// 极简阅读风：分段切换是带下划线的文字，输入为发丝下划线，草稿是纯列表
const styles = StyleSheet.create({
  sourceTabs: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sourceTab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  sourceTabActive: { borderBottomColor: colors.primary },
  imagePreview: { width: '100%', height: 180, marginVertical: spacing.sm, borderRadius: radii.xs },
  imageNotice: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginVertical: spacing.sm },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pickCopy: { flex: 1 },
  pickTitle: { ...typography.body, color: colors.text },
  pickHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  input: {
    ...typography.body,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  requirementsInput: { minHeight: 76, lineHeight: 20 },
  requirementsMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  requirementsHint: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },
  restoreDefault: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  aiSetupButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  truncatedText: { ...typography.caption, color: colors.warning, marginBottom: spacing.sm, lineHeight: 18 },
  extractingBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  extractingTitle: { ...typography.body, color: colors.text },
  extractingMeta: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  extractingHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  reviewHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  draftRowSelected: {},
  draftInfo: { flex: 1 },
  draftTitle: { ...typography.body, color: colors.text, lineHeight: 22 },
  draftMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  pressed: { opacity: 0.6 },
});
