import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
const mockGallery = jest.fn();
const mockDocument = jest.fn();
const mockReadImage = jest.fn();
const mockExtract = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockGallery(...args) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockDocument(...args) }));
jest.mock('../../lib/import-image', () => ({ ...jest.requireActual('../../lib/import-image'), readImportedImage: (...args: unknown[]) => mockReadImage(...args) }));
jest.mock('../../lib/llm', () => ({ ...jest.requireActual('../../lib/llm'), extractQuestionsFromImage: (...args: unknown[]) => mockExtract(...args) }));
import { ImportTextModal } from './ImportTextModal';
import { useLlmConfigStore } from '../../store/llm-config-store';

const IMAGE = { uri: 'file:///test.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' };
const DRAFTS = ['图中第一题', '图中第二题'].map(title => ({ title, questionMd: '题干', answerMd: null, difficulty: 1, tags: [] }));
const props = { visible: true, onClose: jest.fn(), onConfirm: jest.fn(), onOpenAiSettings: jest.fn() };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useLlmConfigStore.setState({ loaded: true, presetId: 'custom', baseUrl: 'https://example.com/v1', apiKey: 'dummy-test-key', model: 'vision-test', extractionPrompt: '' });
  mockReadImage.mockResolvedValue(IMAGE);
  mockExtract.mockResolvedValue(DRAFTS);
  mockGallery.mockResolvedValue({ canceled: false, assets: [{ uri: IMAGE.uri, width: 1, height: 1 }] });
  mockDocument.mockResolvedValue({ canceled: false, assets: [{ uri: IMAGE.uri, name: 'test.png', size: 100 }] });
});

async function openImageMode() {
  const view = await render(<ImportTextModal {...props} />);
  await act(async () => { fireEvent.press(view.getByLabelText('图片来源')); });
  return view;
}

it('相册单张选择只显示预览，用户发送后才生成草稿，并只导入勾选项', async () => {
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('从相册选择图片')); });
  expect(mockGallery).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false }));
  expect(view.getByLabelText('所选图片预览')).toBeTruthy();
  expect(mockExtract).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByText('发送图片并抽取')); });
  await waitFor(() => expect(view.getByText('图中第一题')).toBeTruthy());
  expect(mockExtract).toHaveBeenCalledWith(expect.objectContaining({ model: 'vision-test' }), IMAGE, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await act(async () => { fireEvent.press(view.getByText('图中第二题')); });
  await act(async () => { fireEvent.press(view.getByText('导入 1 题')); });
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(props.onConfirm.mock.calls[0][0]).toEqual([expect.objectContaining({ title: '图中第一题' })]);
});

it('图片文件选择使用图片类型过滤且不自动上传', async () => {
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('选择图片文件')); });
  expect(mockDocument).toHaveBeenCalledWith({ type: ['image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true, multiple: false });
  expect(view.getByLabelText('所选图片预览')).toBeTruthy();
  expect(mockExtract).not.toHaveBeenCalled();
});

it('取消选择不读取、不上传；无图时无法开始', async () => {
  mockGallery.mockResolvedValue({ canceled: true, assets: null });
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('从相册选择图片')); });
  expect(mockReadImage).not.toHaveBeenCalled();
  expect(mockExtract).not.toHaveBeenCalled();
  expect(view.queryByLabelText('所选图片预览')).toBeNull();
  expect(view.getByLabelText('发送图片并抽取').props.accessibilityState.disabled).toBe(true);
});

it('不支持/超限的图片给出错误且不上传', async () => {
  mockReadImage.mockRejectedValue(new Error('图片不能超过 8 MB，请先缩小图片'));
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('选择图片文件')); });
  expect(view.getByText('图片不能超过 8 MB，请先缩小图片')).toBeTruthy();
  expect(mockExtract).not.toHaveBeenCalled();
});

it('未配置 AI 时引导设置，不发起视觉请求', async () => {
  useLlmConfigStore.setState({ apiKey: '' });
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('选择图片文件')); });
  await act(async () => { fireEvent.press(view.getByText('发送图片并抽取')); });
  expect(view.getByText('去 AI 设置')).toBeTruthy();
  expect(mockExtract).not.toHaveBeenCalled();
});

it('抽取失败保留本地预览，空结果不导入', async () => {
  mockExtract.mockResolvedValue([]);
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('选择图片文件')); });
  await act(async () => { fireEvent.press(view.getByText('发送图片并抽取')); });
  expect(view.getByText('没有从图片中提取到题目，请选择更清晰、包含完整题干的图片。')).toBeTruthy();
  expect(view.getByLabelText('所选图片预览')).toBeTruthy();
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('取消抽取后中止 signal，迟到结果不能回到草稿页面', async () => {
  let resolve!: (value: typeof DRAFTS) => void;
  mockExtract.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('选择图片文件')); });
  await act(async () => { fireEvent.press(view.getByText('发送图片并抽取')); });
  const signal = mockExtract.mock.calls[0][2].signal as AbortSignal;
  await act(async () => { fireEvent.press(view.getByText('取消抽取')); resolve(DRAFTS); });
  expect(signal.aborted).toBe(true);
  expect(view.queryByText('图中第一题')).toBeNull();
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('关闭并重开后，旧选择器返回不能恢复旧图或触发网络', async () => {
  let resolve!: (value: unknown) => void;
  mockGallery.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = await openImageMode();
  await act(async () => { fireEvent.press(view.getByText('从相册选择图片')); });
  await act(async () => { await view.rerender(<ImportTextModal {...props} visible={false} />); });
  await act(async () => { await view.rerender(<ImportTextModal {...props} />); });
  await act(async () => { resolve({ canceled: false, assets: [{ uri: IMAGE.uri }] }); });
  expect(mockReadImage).not.toHaveBeenCalled();
  expect(mockExtract).not.toHaveBeenCalled();
  expect(view.queryByLabelText('所选图片预览')).toBeNull();
});
