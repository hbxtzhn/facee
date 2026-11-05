// SemVer 2.0.0 解析与比较（bank.version / release.minAppVersion）。

export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isSemver(v) {
  return typeof v === 'string' && SEMVER_RE.test(v);
}

/** a < b → -1；相等 → 0；a > b → 1（忽略 build 元数据） */
export function compareSemver(a, b) {
  const ma = SEMVER_RE.exec(a);
  const mb = SEMVER_RE.exec(b);
  if (!ma || !mb) throw new Error(`compareSemver: invalid version ${!ma ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = BigInt(ma[i]) - BigInt(mb[i]);
    if (d !== 0n) return d < 0n ? -1 : 1;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const xa = pa.split('.');
  const xb = pb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = BigInt(xa[i]) - BigInt(xb[i]);
      if (d !== 0n) return d < 0n ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1;
    }
  }
  return 0;
}
