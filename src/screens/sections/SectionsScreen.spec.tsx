import { Alert } from 'react-native';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TestRuntime } from '../../bank/__fixtures__/node-runtime';

/**
 * 自定义分区（issue #3）UI：真实 useBankStore + Node SQLite。
 * 管理页：新建 / 重命名 / 排序 / 删除（确认后，分类不受影响）；
 * 分区页：多选添加分类、浏览进入列表、编辑模式排序与移除、「已不在题库中」的分类可移除。
 */

jest.mock('../../bank/runtime', () => ({ createDefaultRuntime: async () => null }));

const mockNav = { push: jest.fn(), navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
let mockParams: { sectionId: string; sectionName?: string } = { sectionId: '' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => undefined,
}));

// eslint-disable-next-line import/first
import { SectionsScreen } from './SectionsScreen';
// eslint-disable-next-line import/first
import { SectionScreen } from './SectionScreen';
// eslint-disable-next-line import/first
import { moveItem } from './components';
// eslint-disable-next-line import/first
import { QID, bankStore, sampleBundle, startSampleBank, stopBank, unwrap, updateSampleBank } from '../home/__fixtures__/bank-screen';
// eslint-disable-next-line import/first
import { resetBankStoreForTests } from '../../bank/store';

/** 让 Alert.alert 直接点「删除」（破坏性按钮） */
function autoConfirm() {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
}

const sectionNames = () => bankStore().sections.map((section) => section.name);

describe('moveItem', () => {
  it('交换相邻项，越界返回 null', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toBeNull();
    expect(moveItem(['a', 'b'], 1, 1)).toBeNull();
  });
});

describe('SectionsScreen 分区管理', () => {
  let t: TestRuntime | null = null;
  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
    await stopBank(t);
    t = null;
  });

  it('新建分区后出现在列表，点按进入分区页', async () => {
    t = await startSampleBank();
    await render(<SectionsScreen />);
    expect(await screen.findByText('还没有分区。')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('新分区名称'), '一面必刷');
    await fireEvent.press(screen.getByLabelText('新建「一面必刷」'));
    await waitFor(() => expect(sectionNames()).toEqual(['一面必刷']));

    await fireEvent.press(await screen.findByLabelText('打开分区 一面必刷'));
    expect(mockNav.push).toHaveBeenCalledWith('Section', { sectionId: bankStore().sections[0].id, sectionName: '一面必刷' });
  });

  it('重命名、上移 / 下移排序', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().createSection('A'));
    await unwrap(bankStore().createSection('B'));
    await render(<SectionsScreen />);
    await screen.findByLabelText('打开分区 A');

    expect(screen.getByLabelText('上移分区 A')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('下移分区 A'));
    await waitFor(() => expect(sectionNames()).toEqual(['B', 'A']));

    await fireEvent.press(screen.getByLabelText('重命名分区 B'));
    const input = screen.getByDisplayValue('B');
    await fireEvent.changeText(input, '二面');
    await fireEvent.press(screen.getByLabelText('保存「二面」'));
    await waitFor(() => expect(sectionNames()).toEqual(['二面', 'A']));
    expect(await screen.findByLabelText('打开分区 二面')).toBeTruthy();
  });

  it('删除分区需确认；分类与题库不受影响', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('临时'));
    await unwrap(bankStore().addCategoryToSection(id, 'redis'));
    const alert = autoConfirm();
    await render(<SectionsScreen />);

    await fireEvent.press(await screen.findByLabelText('删除分区 临时'));
    expect(alert).toHaveBeenCalledWith('删除分区「临时」？', expect.stringContaining('不受影响'), expect.any(Array));
    await waitFor(() => expect(bankStore().sections).toEqual([]));
    expect(bankStore().categories.map((category) => category.id)).toEqual(['mysql', 'network', 'redis']);
    expect(await screen.findByText('还没有分区。')).toBeTruthy();
  });

  it('Web（unsupported）显示不支持说明', async () => {
    await resetBankStoreForTests();
    await render(<SectionsScreen />);
    expect(await screen.findByText('Web 预览不支持本地题库')).toBeTruthy();
  });
});

describe('SectionScreen 单个分区', () => {
  let t: TestRuntime | null = null;
  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
    await stopBank(t);
    t = null;
  });

  const categoryIds = () => bankStore().sections[0].categories.map((category) => category.id);

  it('多选添加分类，浏览进入分类列表与整个分区', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('存储'));
    mockParams = { sectionId: id, sectionName: '存储' };
    await render(<SectionScreen />);
    expect(await screen.findByText(/分区还是空的/)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('添加分类'));
    await fireEvent.press(screen.getByLabelText('选择分类 Redis'));
    await fireEvent.press(screen.getByLabelText('选择分类 MySQL'));
    await fireEvent.press(screen.getByLabelText('加入 2 个分类'));
    await waitFor(() => expect(categoryIds()).toEqual(['redis', 'mysql']));

    expect(await screen.findByLabelText('Redis，2 道题')).toBeTruthy();
    expect(screen.getByText('2 个分类 · 4 题')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Redis，2 道题'));
    expect(mockNav.push).toHaveBeenLastCalledWith('List', { categoryId: 'redis', categoryName: 'Redis' });
    await fireEvent.press(screen.getByLabelText('练习整个分区 存储'));
    expect(mockNav.push).toHaveBeenLastCalledWith('List', { sectionId: id, sectionName: '存储' });

    // 剩下的候选只有「网络」
    await fireEvent.press(screen.getByLabelText('添加分类'));
    expect(screen.getByLabelText('选择分类 网络')).toBeTruthy();
    expect(screen.queryByLabelText('选择分类 Redis')).toBeNull();
  });

  it('编辑模式：排序、移除分类、重命名分区', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('存储'));
    await unwrap(bankStore().addCategoryToSection(id, 'redis'));
    await unwrap(bankStore().addCategoryToSection(id, 'mysql'));
    mockParams = { sectionId: id, sectionName: '存储' };
    await render(<SectionScreen />);

    await fireEvent.press(await screen.findByLabelText('编辑分区'));
    await fireEvent.press(screen.getByLabelText('下移分类 Redis'));
    await waitFor(() => expect(categoryIds()).toEqual(['mysql', 'redis']));

    await fireEvent.press(screen.getByLabelText('从分区移除 MySQL'));
    await waitFor(() => expect(categoryIds()).toEqual(['redis']));
    // 只是移出分区，分类仍在题库
    expect(bankStore().categories.some((category) => category.id === 'mysql')).toBe(true);

    await fireEvent.press(screen.getByLabelText('重命名分区'));
    await fireEvent.changeText(screen.getByDisplayValue('存储'), '缓存');
    await fireEvent.press(screen.getByLabelText('保存「缓存」'));
    await waitFor(() => expect(bankStore().sections[0].name).toBe('缓存'));
    expect(mockNav.setOptions).toHaveBeenLastCalledWith({ title: '缓存' });
  });

  it('题库更新后消失的分类显示「已不在题库中」，可移除', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('混合'));
    await unwrap(bankStore().addCategoryToSection(id, 'network'));
    await unwrap(bankStore().addCategoryToSection(id, 'redis'));
    const v2 = sampleBundle('1.1.0');
    v2.categories = v2.categories.filter((category) => category.id !== 'network');
    v2.questions = v2.questions.filter((question) => question.id !== QID.tcpHandshake);
    v2.lifecycle.removed.push(QID.tcpHandshake);
    await updateSampleBank(t, v2);

    mockParams = { sectionId: id, sectionName: '混合' };
    await render(<SectionScreen />);
    expect(await screen.findByLabelText('network，已不在题库中')).toBeTruthy();
    expect(screen.getByText('1 个分类 · 2 题 · 1 个已不在题库中')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('从分区移除 network'));
    await waitFor(() => expect(categoryIds()).toEqual(['redis']));
    expect(screen.queryByLabelText('network，已不在题库中')).toBeNull();
  });

  it('删除分区：确认后返回，分类不受影响', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('临时'));
    await unwrap(bankStore().addCategoryToSection(id, 'redis'));
    autoConfirm();
    mockParams = { sectionId: id, sectionName: '临时' };
    await render(<SectionScreen />);

    await fireEvent.press(await screen.findByLabelText('编辑分区'));
    await fireEvent.press(screen.getByLabelText('删除分区 临时'));
    await waitFor(() => expect(mockNav.goBack).toHaveBeenCalled());
    expect(bankStore().sections).toEqual([]);
    expect(bankStore().categories.find((category) => category.id === 'redis')?.questionCount).toBe(2);
  });

  it('分区不存在时给返回入口', async () => {
    t = await startSampleBank();
    mockParams = { sectionId: 's_missing' };
    await render(<SectionScreen />);
    expect(await screen.findByText('分区不存在')).toBeTruthy();
  });
});
