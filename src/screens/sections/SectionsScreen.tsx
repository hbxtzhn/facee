import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBankStore, type BankResult, type SectionInfo } from '../../bank';
import type { HomeStackParamList, RootStackParamList } from '../../navigation/AppNavigator';
import { colors, layout, spacing, typography } from '../../theme';
import { BankGateEmpty, useBankGateState, useEnsureBankInitialized } from '../home/components/bank-gate';
import { SectionLabel } from '../home/components/reading';
import { ManageRow, NameInput, describeSection, moveItem } from './components';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'Sections'>,
  NativeStackNavigationProp<RootStackParamList>
>;

/** 删除分区前确认：分区只是个人目录，删除不影响分类、题目与学习记录 */
export function confirmDeleteSection(name: string, onConfirm: () => void): void {
  Alert.alert(
    `删除分区「${name}」？`,
    '只删除这个分区本身；里面的分类、题目和学习记录都不受影响。',
    [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: onConfirm },
    ],
  );
}

/**
 * 自定义分区管理（issue #3）：新建、重命名、上移 / 下移排序、删除。
 * 分区是用户自己的数据（学习数据层），永远不改题库；点分区名进入分区详情添加分类。
 */
export function SectionsScreen() {
  const nav = useNavigation<Nav>();
  useEnsureBankInitialized();
  const gate = useBankGateState();
  const sections = useBankStore((state) => state.sections);
  const bankName = useBankStore((state) => state.activeBank?.name ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run<T>(action: () => Promise<BankResult<T>>): Promise<BankResult<T>> {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) setError(result.error.message);
    return result;
  }

  async function create(name: string): Promise<boolean> {
    const result = await run(() => useBankStore.getState().createSection(name));
    return result.ok;
  }

  async function rename(section: SectionInfo, name: string): Promise<boolean> {
    const result = await run(() => useBankStore.getState().renameSection(section.id, name));
    if (result.ok) setRenamingId(null);
    return result.ok;
  }

  function move(index: number, delta: -1 | 1) {
    const next = moveItem(sections.map((section) => section.id), index, delta);
    if (next) void run(() => useBankStore.getState().reorderSections(next));
  }

  function remove(section: SectionInfo) {
    confirmDeleteSection(section.name, () => {
      void run(() => useBankStore.getState().deleteSection(section.id));
    });
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>
        分区是你自己的目录：把常练的分类归到一起。它只保存在本机{bankName ? `「${bankName}」` : '当前题库'}下，
        不会改动题库；题库更新后消失的分类会标为「已不在题库中」。
      </Text>

      <SectionLabel>新建分区</SectionLabel>
      <NameInput
        placeholder="分区名称，如「一面必刷」"
        submitLabel="新建"
        accessibilityLabel="新分区名称"
        onSubmit={create}
      />

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <SectionLabel trailing={<Text style={styles.count}>{sections.length}</Text>}>我的分区</SectionLabel>
      {sections.length === 0 ? <Text style={styles.empty}>还没有分区。</Text> : null}
      {sections.map((section, index) =>
        renamingId === section.id ? (
          <View key={section.id} style={styles.renameRow}>
            <NameInput
              initialValue={section.name}
              placeholder="分区名称"
              submitLabel="保存"
              accessibilityLabel={`重命名分区 ${section.name}`}
              autoFocus
              onSubmit={(name) => rename(section, name)}
              onCancel={() => setRenamingId(null)}
            />
          </View>
        ) : (
          <ManageRow
            key={section.id}
            first={index === 0}
            title={section.name}
            meta={describeSection(section)}
            accessibilityLabel={`打开分区 ${section.name}`}
            onPress={() => nav.push('Section', { sectionId: section.id, sectionName: section.name })}
            actions={[
              { label: '上移', accessibilityLabel: `上移分区 ${section.name}`, disabled: pending || index === 0, onPress: () => move(index, -1) },
              {
                label: '下移',
                accessibilityLabel: `下移分区 ${section.name}`,
                disabled: pending || index === sections.length - 1,
                onPress: () => move(index, 1),
              },
              { label: '重命名', accessibilityLabel: `重命名分区 ${section.name}`, disabled: pending, onPress: () => setRenamingId(section.id) },
              { label: '删除', accessibilityLabel: `删除分区 ${section.name}`, danger: true, disabled: pending, onPress: () => remove(section) },
            ]}
          />
        ),
      )}
    </ScrollView>
  );
}

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
  intro: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  count: { ...typography.caption, color: colors.textSubtle },
  empty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md },
  renameRow: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
