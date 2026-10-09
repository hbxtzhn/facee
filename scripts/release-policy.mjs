/** 公共证书指纹，不含密钥；更换必须作为显式签名迁移审查。 */
export const RELEASE_CERTIFICATE_SHA256 = '3c4b61bba990ed07255d5ff354b993d8f4b98ea9787aa8fb0b4e309b34734251';

export function assertReleaseCertificate(output) {
  const fingerprints = [...output.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f]{64})/gi)]
    .map((match) => match[1].toLowerCase());
  if (fingerprints.length !== 1 || fingerprints[0] !== RELEASE_CERTIFICATE_SHA256) {
    throw new Error('APK 签名证书与项目发布证书不一致，禁止发布（包括 debug 证书）');
  }
}

export function assertTagTarget(tagCommit, headCommit) {
  if (tagCommit.trim() !== headCommit.trim()) throw new Error('已有 tag 不指向当前 HEAD，禁止复用');
}
