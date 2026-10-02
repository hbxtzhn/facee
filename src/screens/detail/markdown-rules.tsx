import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text } from 'react-native';
import { useImageViewer } from '../../components/image-viewer';
import { isExternalHref, parseQuestionHref } from '../../lib/markdown';
import { colors, spacing } from '../../theme';
import { markdownStyles } from './markdown-styles';

/** 详情页 Markdown 的图片 / 表头 / 链接渲染规则，供各处 <Markdown rules={...}> 复用。 */

function MarkdownImage({ src, alt, style }: { src: string; alt?: string; style?: any }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const openViewer = useImageViewer();
  const MAX_HEIGHT = 360;

  useEffect(() => {
    let alive = true;
    if (!src) return undefined;
    Image.getSize(
      src,
      (width, height) => {
        if (alive && width > 0 && height > 0) setRatio(width / height);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [src]);

  const box = ratio
    ? { width: '100%' as const, aspectRatio: ratio, maxHeight: MAX_HEIGHT }
    : { width: '100%' as const, height: MAX_HEIGHT };

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={alt ? `${alt}，点击全屏查看` : '点击全屏查看图片'}
      onPress={() => openViewer(src, alt || undefined)}
      style={styles.imagePressable}
    >
      <Image
        source={{ uri: src }}
        style={[style, box]}
        resizeMode="contain"
        accessible={false}
      />
    </Pressable>
  );
}

export function renderImage(node: any, _children: any, _parent: any, styles: any) {
  const src: string = node.attributes?.src ?? '';
  const alt: string = node.attributes?.alt ?? '';
  if (!src) return null;
  return <MarkdownImage key={node.key} src={src} alt={alt} style={styles.image} />;
}

export function renderTableHeader(node: any, children: any, _parent: any, styles: any) {
  // th 容器是 View，表头文字的字重只能在 rule 里直接落在 Text 上
  return <Text key={node.key} style={[styles._VIEW_SAFE_th, markdownStyles.tableHeaderText]}>{children}</Text>;
}

/** 题目内链（facee://…）进 Detail，外链交给系统浏览器。 */
export function renderLink(nav: { push: (screen: 'Detail', params: { id: string }) => unknown }) {
  return (node: any, _children: any, _style: any, passProps: any) => {
    const href: string = node.attributes?.href ?? '';
    const label = (node.children ?? []).map((child: any) => child.content ?? '').join('');
    const questionId = parseQuestionHref(href);
    if (questionId) return <Text key={node.key} accessibilityRole="link" style={styles.link} onPress={() => nav.push('Detail', { id: questionId })} {...passProps}>{label}</Text>;
    if (!isExternalHref(href)) return <Text key={node.key} style={styles.link} {...passProps}>{label}</Text>;
    return <Text key={node.key} accessibilityRole="link" style={styles.link} onPress={() => void Linking.openURL(href)} {...passProps}>{label}</Text>;
  };
}

const styles = {
  imagePressable: { width: '100%' as const, marginVertical: spacing.sm },
  link: { color: colors.primary, textDecorationLine: 'underline' as const, fontWeight: '500' as const },
};
