// state.test.js —— 事件总线 / AIRCRAFT 重导出 / state 默认值
// 锁定 P2-1（AIRCRAFT 重导出）、P2-2（off/try-catch）修复
import { describe, it, expect } from 'vitest';
import { S, AIRCRAFT, on, off, emit } from '../src/state.js';

describe('AIRCRAFT 重导出（修复 P2-1）', () => {
  it('state.AIRCRAFT 与 aircraft.AIRCRAFT 是同一对象', async () => {
    const ac = await import('../src/aircraft.js');
    expect(AIRCRAFT).toBe(ac.AIRCRAFT);
  });
  it('AIRCRAFT.name = "J-35"', () => {
    expect(AIRCRAFT.name).toBe('J-35');
  });
  it('AIRCRAFT.MAC = 4.0 m（参考弦长）', () => {
    expect(AIRCRAFT.MAC).toBe(4.0);
  });
  it('AIRCRAFT.alphaStall = 33°（与 AERO.VORTEX_ALPHA_FULL 一致）', async () => {
    const { AERO } = await import('../src/physics.js');
    expect(AIRCRAFT.alphaStall).toBe(AERO.VORTEX_ALPHA_FULL);
  });
});

describe('S 默认值', () => {
  it('U=230, alpha=3, beta=0, deltaE=0', () => {
    expect(S.U).toBe(230);
    expect(S.alpha).toBe(3);
    expect(S.beta).toBe(0);
    expect(S.deltaE).toBe(0);
  });
  it('atmoLinked=true, altitude=0, temperature=288.15', () => {
    expect(S.atmoLinked).toBe(true);
    expect(S.altitude).toBe(0);
    expect(S.temperature).toBe(288.15);
  });
});

describe('事件总线（修复 P2-2）', () => {
  it('on() 返回 unsub 函数', () => {
    let cnt = 0;
    const fn = () => cnt++;
    const unsub = on('test1', fn);
    emit('test1');
    expect(cnt).toBe(1);
    unsub();
    emit('test1');
    expect(cnt).toBe(1);  // 已解绑
  });

  it('off() 直接解绑', () => {
    let cnt = 0;
    const fn = () => cnt++;
    on('test2', fn);
    emit('test2');
    expect(cnt).toBe(1);
    off('test2', fn);
    emit('test2');
    expect(cnt).toBe(1);
  });

  it('emit 单个订阅者 throw 不影响其他订阅者（try/catch）', () => {
    let cnt = 0;
    on('test3', () => { throw new Error('订阅者1 崩溃'); });
    on('test3', () => { cnt++; });
    // 不应抛错（订阅者2 仍执行）
    expect(() => emit('test3')).not.toThrow();
    expect(cnt).toBe(1);
    off('test3', () => {});   // 清不掉已 throw 的（匿名）但 emit 时已重置
  });

  it('off 未注册事件不报错', () => {
    expect(() => off('nonexistent', () => {})).not.toThrow();
  });
});
