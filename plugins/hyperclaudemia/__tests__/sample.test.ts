/**
 * 简单的格式化工具测试
 */
import { describe, expect, it } from 'vitest';

function add(a: number, b: number): number {
  return a + b;
}

describe('sample', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
