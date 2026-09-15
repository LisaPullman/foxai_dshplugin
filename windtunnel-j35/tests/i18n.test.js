// i18n.test.js —— 中英文案 / 缺失 key 兜底
// 锁定 P2-3 修复
import { describe, it, expect } from 'vitest';
import { i18n, I18N } from '../src/i18n.js';

describe('i18n 正常 key', () => {
  it('zh 默认 title', () => {
    i18n.lang = 'zh';
    expect(i18n.t('title')).toBe('数字风洞 · 歼-35 舰载机');
  });
  it('en title', () => {
    i18n.lang = 'en';
    expect(i18n.t('title')).toBe('Digital Wind Tunnel · J-35 Carrier Fighter');
  });
  it('zh 嵌套 key', () => {
    i18n.lang = 'zh';
    expect(i18n.t('parts.canopy')).toBe('座舱盖');
  });
});

describe('i18n 缺失 key 兜底（修复 P2-3）', () => {
  it('不存在 key 返回 key 字符串', () => {
    i18n.lang = 'zh';
    expect(i18n.t('nonexistent.deep.key')).toBe('nonexistent.deep.key');
  });
  it('部分路径不存在也返回 key', () => {
    i18n.lang = 'en';
    expect(i18n.t('parts.nope')).toBe('parts.nope');
  });
  it('未设置 lang 时回退 zh', () => {
    i18n.lang = 'fr';  // 不支持
    expect(i18n.t('title')).toBe('数字风洞 · 歼-35 舰载机');
  });
});

describe('i18n.lang 读写', () => {
  it('lang = "zh" / "en"', () => {
    i18n.lang = 'zh';
    expect(i18n.lang).toBe('zh');
    i18n.lang = 'en';
    expect(i18n.lang).toBe('en');
  });
});
