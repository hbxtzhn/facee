import { inspectImageBase64, MAX_IMPORT_IMAGE_BYTES, readImportedImage } from './import-image';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

it.each([
  [PNG, 'image/png'],
  [Buffer.from([255, 216, 255, 224]).toString('base64'), 'image/jpeg'],
  [Buffer.from('RIFF1234WEBPVP8 ').toString('base64'), 'image/webp'],
])('从内容识别图片类型而不是扩展名：%s', (base64, mime) => {
  expect(inspectImageBase64(base64)).toBe(mime);
});

it.each(['', '%%%%', 'abc', 'Zg===', Buffer.from('GIF89a').toString('base64'), Buffer.from('not an image').toString('base64')])(
  '拒绝无效、损坏或不支持的格式：%s', base64 => {
    expect(() => inspectImageBase64(base64)).toThrow();
  },
);

it('大文件在读入前被拒绝，未知声明大小仍检查实际数据', async () => {
  const read = jest.fn(async () => PNG);
  await expect(readImportedImage({ uri: 'file:///photo.png', size: MAX_IMPORT_IMAGE_BYTES + 1 }, read)).rejects.toThrow('8 MB');
  expect(read).not.toHaveBeenCalled();
  await expect(readImportedImage({ uri: 'file:///photo.png' }, read)).resolves.toEqual({ uri: 'file:///photo.png', base64: PNG, mimeType: 'image/png' });
  const oversized = 'A'.repeat(Math.ceil(MAX_IMPORT_IMAGE_BYTES / 3) * 4 + 4);
  expect(() => inspectImageBase64(oversized)).toThrow('8 MB');
});

it('相册 fileSize 同样受限制，不信任只改小元数据的输入', async () => {
  const read = jest.fn(async () => PNG);
  await expect(readImportedImage({ uri: 'file:///photo.png', fileSize: MAX_IMPORT_IMAGE_BYTES + 1 }, read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  await expect(readImportedImage({ uri: '' }, read)).rejects.toThrow();
});

it('默认读取器拒绝网络 URI，不把远程地址自动下载为图片', async () => {
  await expect(readImportedImage({ uri: 'https://example.com/private.png' })).rejects.toThrow('本地图片');
});
