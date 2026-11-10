import { OFFICIAL_MANIFEST_URL, isOfficialManifestUrl } from './bank-helpers';

describe('官方题库地址', () => {
  it('统一为小写 hbxtzhn', () => {
    expect(OFFICIAL_MANIFEST_URL).toBe('https://github.com/hbxtzhn/facee-bank/releases/latest/download/latest.json');
  });

  it('按大小写不敏感识别：兼容测试版保存的混写地址', () => {
    expect(isOfficialManifestUrl(OFFICIAL_MANIFEST_URL)).toBe(true);
    expect(isOfficialManifestUrl('https://github.com/HBxtzhn/facee-bank/releases/latest/download/latest.json')).toBe(true);
    expect(isOfficialManifestUrl(' https://github.com/hbxtzhn/facee-bank/releases/latest/download/latest.json ')).toBe(true);
    expect(isOfficialManifestUrl('https://github.com/other/facee-bank/releases/latest/download/latest.json')).toBe(false);
    expect(isOfficialManifestUrl(null)).toBe(false);
    expect(isOfficialManifestUrl(undefined)).toBe(false);
  });
});
