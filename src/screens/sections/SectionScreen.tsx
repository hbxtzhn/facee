import { useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type CompositeNavigationProp, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check } from 'lucide-react-native';
import { useBankStore, type BankResult, type SectionCategory } from '../../bank';
import type { HomeStackParamList, RootStackParamList } from '../../navigation/AppNavigator';
import { EmptyState } from '../../components/ui';
import { colors, layout, spacing, typography } from '../../theme';
import { BankGateEmpty, useBankGateState, useEnsureBankInitialized } from '../home/components/bank-gate';
import { ReadingRow, SectionLabel, TextAction } from '../home/components/reading';
import { ManageRow, NameInput, describeSection, moveItem } from './components';
import { confirmDeleteSection } from './SectionsScreen';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'Section'>,
  NativeStackNavigationProp<RootStackParamList>
>;
type SectionRoute = RouteProp<HomeStackParamList, 'Section'>;

export const DANGLING_LABEL = '已不在题库中';

/**
 * 单个分区：浏览其中的分类 → 列表；「编辑」模式下可排序、移除分类、重命名、删除分区；
 * 「添加分类」多选当前题库中尚未加入的分类。题库更新后消失的分类显示「已不在题库中」，只能移除。
 */
export function SectionScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<SectionRoute>();
  useEnsureBankInitialized();
  const gate = useBankGateState();
  const section = useBankStore((state) => state.sections.find((item) => item.id === params.sectionId) ?? null);
  const bankCategories = useBankStore((state) => state.categories);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const title = section?.name ?? params.sectionName ?? '分区';
  useLayoutEffect(() => {
    if (typeof nav.setOptions === 'function') nav.setOptions({ title });
  }, [nav, title]);

  async function run<T>(action: () => Promise<BankResult<T>>): Promise<boolean> {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) setError(result.error.message);
    return result.ok;
  }

  if (gate !== 'ready') {
    return (
      <View style={[styles.container, styles.content]}>
        {gate === 'loading' ? null : (
          <BankGateEmpty
            state={gate}
            onOnlineBanks={() => nav.navigate('OnlineBanks')}
            onCreateLocal={() => nav.navigate('BankManager')}
          />
        )}
      </View>
    );
  }

  if (!section) {
    return (
      <View style={[styles.container, styles.content]}>
        <EmptyState
          title="分区不存在"
          description="这个分区可能已被删除，或属于其它题库。"
          actionLabel="返回"
          onAction={() => nav.goBack()}
        />
      </View>
    );
  }

  const sectionId = section.id;
  const memberIds = new Set(section.categories.map((category) => category.id));
  const candidates = bankCategories.filter((category) => !memberIds.has(category.id));
  const existingCount = section.categories.filter((category) => category.exists).length;

  async function addPicked() {
    // 按用户勾选顺序逐个追加到分区末尾（数据层每次一个分类）
    for (const categoryId of picked) {
      const ok = await run(() => useBankStore.getState().addCategoryToSection(sectionId, categoryId));
      if (!ok) return;
    }
    setPicked([]);
    setPicking(false);
  }

  function move(index: number, delta: -1 | 1) {
    const next = moveItem(section!.categories.map((category) => category.id), index, delta);
    if (next) void run(() => useBankStore.getState().reorderSectionCategories(sectionId, next));
  }

  function removeCategory(category: SectionCategory) {
    void run(() => useBankStore.getState().removeCategoryFromSection(sectionId, category.id));
  }

  function deleteSection() {
    confirmDeleteSection(section!.name, () => {
      void (async () => {
        const ok = await run(() => useBankStore.getState().deleteSection(sectionId));
        if (ok) nav.goBack();
      })();
    });
  }

  function renderCategory(category: SectionCategory, index: number) {
    const label = category.name ?? category.id;
    if (!category.exists) {
      // 已不在题库中：不可进入，只能移除（编辑与浏览模式都给入口）
      return (
        <ManageRow
          key={category.id}
          first={index === 0}
          title={label}
          muted
          badge={DANGLING_LABEL}
          meta="题库更新后这个分类已被删除或改名"
          accessibilityLabel={`${label}，${DANGLING_LABEL}`}
          actions={[
            ...(editing
              ? [
                  { label: '上移', accessibilityLabel: `上移分类 ${label}`, disabled: pending || index === 0, onPress: () => move(index, -1) },
                  {
                    label: '下移',
                    accessibilityLabel: `下移分类 ${label}`,
                    disabled: pending || index === section!.categories.length - 1,
                    onPress: () => move(index, 1),
                  },
                ]
              : []),
            { label: '移除', accessibilityLabel: `从分区移除 ${label}`, danger: true, disabled: pending, onPress: () => removeCategory(category) },
          ]}
        />
      );
    }
    if (editing) {
      return (
        <ManageRow
          key={category.id}
          first={index === 0}
          title={label}
          meta={`${category.questionCount} 题`}
          accessibilityLabel={`${label}，${category.questionCount} 道题`}
          actions={[
            { label: '上移', accessibilityLabel: `上移分类 ${label}`, disabled: pending || index === 0, onPress: () => move(index, -1) },
            {
              label: '下移',
              accessibilityLabel: `下移分类 ${label}`,
              disabled: pending || index === section!.categories.length - 1,
              onPress: () => move(index, 1),
            },
            { label: '移除', accessibilityLabel: `从分区移除 ${label}`, danger: true, disabled: pending, onPress: () => removeCategory(category) },
          ]}
        />
      );
    }
    const info = bankCategories.find((item) => item.id === category.id);
    return (
      <ReadingRow
        key={category.id}
        first={index === 0}
        title={label}
        titleLines={1}
        meta={info && info.knownCount > 0 ? `已掌握 ${info.knownCount} 题` : null}
        trailing={String(category.questionCount)}
        accessibilityLabel={`${label}，${category.questionCount} 道题`}
        onPress={() => nav.push('List', { categoryId: category.id, categoryName: label })}
      />
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {renaming ? (
        <NameInput
          initialValue={section.name}
          placeholder="分区名称"
          submitLabel="保存"
          accessibilityLabel={`重命名分区 ${section.name}`}
          autoFocus
          onSubmit={async (name) => {
            const ok = await run(() => useBankStore.getState().renameSection(sectionId, name));
            if (ok) setRenaming(false);
            return ok;
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <Text style={styles.summary}>{describeSection(section)}</Text>
      )}

      <View style={styles.toolbar}>
        {existingCount > 0 && !editing ? (
          <TextAction
            label="练习整个分区"
            accessibilityLabel={`练习整个分区 ${section.name}`}
            onPress={() => nav.push('List', { sectionId, sectionName: section.name })}
          />
        ) : null}
        <TextAction
          label={editing ? '完成' : '编辑'}
          muted={!editing}
          accessibilityLabel={editing ? '完成编辑' : '编辑分区'}
          onPress={() => {
            setEditing((value) => !value);
            setRenaming(false);
          }}
        />
        {editing ? (
          <>
            <TextAction label="重命名" muted accessibilityLabel="重命名分区" onPress={() => setRenaming(true)} />
            <TextAction label="删除分区" muted accessibilityLabel={`删除分区 ${section.name}`} onPress={deleteSection} />
          </>
        ) : null}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <SectionLabel
        trailing={
          candidates.length > 0 ? (
            <TextAction
              label={picking ? '收起' : '添加分类'}
              accessibilityLabel={picking ? '收起添加分类' : '添加分类'}
              onPress={() => {
                setPicking((value) => !value);
                setPicked([]);
              }}
            />
          ) : undefined
        }
      >
        分类
      </SectionLabel>

      {picking ? (
        <View style={styles.picker}>
          {candidates.map((category) => {
            const selected = picked.includes(category.id);
            return (
              <Pressable
                key={category.id}
                accessibilityRole="checkbox"
                accessibilityLabel={`选择分类 ${category.name}`}
                accessibilityState={{ checked: selected }}
                onPress={() =>
                  setPicked((list) => (selected ? list.filter((id) => id !== category.id) : [...list, category.id]))
                }
                style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
              >
                <Text style={[styles.pickText, selected && styles.pickTextSelected]} numberOfLines={1}>
                  {category.name}
                </Text>
                <Text style={styles.pickCount}>{category.questionCount}</Text>
                <View style={styles.check}>
                  {selected ? <Check size={16} color={colors.primary} strokeWidth={2} /> : null}
                </View>
              </Pressable>
            );
          })}
          <View style={styles.pickFooter}>
            <TextAction
              label={picked.length > 0 ? `加入 ${picked.length} 个分类` : '先勾选分类'}
              muted={picked.length === 0}
              accessibilityLabel={`加入 ${picked.length} 个分类`}
              onPress={() => {
                if (picked.length > 0 && !pending) void addPicked();
              }}
            />
          </View>
        </View>
      ) : null}

      {section.categories.length === 0 ? (
        <Text style={styles.empty}>
          {candidates.length > 0 ? '分区还是空的，点「添加分类」把常练的分类放进来。' : '分区还是空的。'}
        </Text>
      ) : (
        section.categories.map(renderCategory)
      )}
    </ScrollView>
  );
}

const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
  },
  summary: { ...typography.caption, color: colors.textMuted },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xl, marginTop: spacing.md },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  empty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md, lineHeight: 18 },
  picker: { borderTopWidth: hairline, borderTopColor: colors.border, marginBottom: spacing.lg },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  pickText: { ...typography.body, color: colors.textSecondary, flex: 1 },
  pickTextSelected: { color: colors.text, fontWeight: '600' },
  pickCount: { ...typography.caption, color: colors.textMuted },
  check: { width: 18, alignItems: 'center' },
  pickFooter: { alignItems: 'flex-end', paddingTop: spacing.sm },
  pressed: { opacity: 0.6 },
});
