import {
  buildFeedbackUrl,
  buildMetaLine,
  formatPercent,
  isChoiceCorrect,
  keyPointWeightLabel,
  suggestFromChoice,
  suggestFromCoverage,
  weightedCoverage,
} from './detail-content';

describe('buildMetaLine', () => {
  it('分类 · 难度 · 类型 · 适用版本，缺项跳过', () => {
    expect(buildMetaLine({ difficulty: 'medium', type: 'concept', appliesTo: ['Redis >= 6'] }, 'Redis')).toBe(
      'Redis · 中等 · 概念 · Redis >= 6',
    );
    expect(buildMetaLine({ difficulty: 'hard', type: 'choice' }, null)).toBe('困难 · 选择题');
  });
});

describe('要点覆盖率与建议打标', () => {
  const keyPoints = [
    { id: 'kp1', text: 'a', weight: 3 as const },
    { id: 'kp2', text: 'b', weight: 1 as const },
    { id: 'kp3', text: 'c', weight: 1 as const },
  ];

  it('按权重计算覆盖率', () => {
    expect(weightedCoverage(keyPoints, { kp1: true })).toBeCloseTo(0.6);
    expect(weightedCoverage(keyPoints, { kp2: true, kp3: true })).toBeCloseTo(0.4);
    expect(weightedCoverage([], {})).toBe(0);
  });

  it('阈值：≥ 80 % 会了，40–80 % 模糊，< 40 % 不会', () => {
    expect(suggestFromCoverage(1)).toBe('known');
    expect(suggestFromCoverage(0.8)).toBe('known');
    expect(suggestFromCoverage(0.79)).toBe('fuzzy');
    expect(suggestFromCoverage(0.4)).toBe('fuzzy');
    expect(suggestFromCoverage(0.39)).toBe('unknown');
  });

  it('权重标注：核心 / 重要，加分项不标', () => {
    expect(keyPointWeightLabel(3)).toBe('核心');
    expect(keyPointWeightLabel(2)).toBe('重要');
    expect(keyPointWeightLabel(1)).toBeNull();
  });

  it('百分比夹紧并取整', () => {
    expect(formatPercent(0.666)).toBe('67%');
    expect(formatPercent(1.2)).toBe('100%');
  });
});

describe('选择题判分', () => {
  it('集合完全一致才算对（顺序无关，多选）', () => {
    expect(isChoiceCorrect(['b'], ['b'])).toBe(true);
    expect(isChoiceCorrect(['a'], ['b'])).toBe(false);
    expect(isChoiceCorrect(['c', 'a'], ['a', 'c'])).toBe(true);
    expect(isChoiceCorrect(['a'], ['a', 'c'])).toBe(false);
  });

  it('答对建议会了，答错建议不会', () => {
    expect(suggestFromChoice(true)).toBe('known');
    expect(suggestFromChoice(false)).toBe('unknown');
  });
});

describe('buildFeedbackUrl', () => {
  it('替换全部 {questionId} 占位符并 URL 编码', () => {
    expect(buildFeedbackUrl('https://x.dev/new?title={questionId}&id={questionId}', 'q_1 2')).toBe(
      'https://x.dev/new?title=q_1%202&id=q_1%202',
    );
  });

  it('无地址或非 http(s) 返回 null', () => {
    expect(buildFeedbackUrl(null, 'q')).toBeNull();
    expect(buildFeedbackUrl('javascript:alert(1)', 'q')).toBeNull();
  });
});
