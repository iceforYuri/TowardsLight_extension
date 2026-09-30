import type { Node } from 'ts-morph';

/**
 * 在对象/数组字面量的收尾(} 或 ])前文本级插入一项:
 * AST 只负责定位,插入走纯文本拼接,保证缩进与仓库风格完全一致。
 * 自动补前一项缺失的逗号。
 */
export function insertIntoLiteral(text: string, node: Node, insert: string): string {
  const end = node.getEnd() - 1;
  let p = end;
  while (p > 0 && /\s/.test(text[p - 1])) p--;
  const prevChar = text[p - 1];
  const needsComma = prevChar !== ',' && prevChar !== '{' && prevChar !== '[';
  return text.slice(0, p) + (needsComma ? ',' : '') + '\n' + insert + ',' + text.slice(p);
}
