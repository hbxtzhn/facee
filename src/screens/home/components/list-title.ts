import type { ListParams } from '../../../navigation/AppNavigator';

/** 列表页标题：入口名；全局搜索为「搜索」；整库为「全部题目」 */
export function listTitle(params: ListParams | undefined): string {
  if (!params) return '全部题目';
  if (params.search) return '搜索';
  return (
    params.categoryName ??
    params.tagName ??
    params.collectionName ??
    params.sectionName ??
    (params.updatedOnly ? '内容已更新' : '全部题目')
  );
}
