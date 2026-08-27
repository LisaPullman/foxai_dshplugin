// Quick test of the prompt generation logic
import { generatePrompt } from '../src/generator.js';
import { validatePromptText, validateStructuredInput } from '../src/validator.js';
import { CONTRACTS, listContracts } from '../src/contracts.js';

console.log('=== Available Contracts ===');
for (const c of listContracts()) {
  console.log(`  - ${c.id}: ${c.name} (${c.durationRange})`);
}

console.log('\n=== Simple Prompt Test ===');
const simple = generatePrompt('simple', {
  subject: '一位年轻女性走在雨后的东京街道上',
  action: '她转身面向镜头微笑，雨水从伞尖滴落',
  camera: '中景、平视、缓慢推进',
  lighting: '傍晚侧逆光，暖橙色天空',
  audio: '雨滴声与远处的车流',
  locks: '她的面部特征与服装',
  exclusions: '文字或字幕'
});
console.log(simple.prompt);
console.log('\nValidation:', JSON.stringify(validatePromptText(simple.prompt, 'simple').summary));

console.log('\n=== Standard Prompt Test ===');
const standard = generatePrompt('standard', {
  materials: {
    images: [{ id: '图片1', role: '身份、服装、场景、首帧' }],
  },
  overview: '一位25岁的东亚女性走在雨后的东京街头，浪漫短片，35mm胶片质感',
  timeline: [
    { start: '0', end: '5', description: '女主撑伞走过霓虹招牌，脚步缓慢' },
    { start: '5', end: '10', description: '她停步，转身面向镜头，雨水从伞尖滴落，微笑' }
  ],
  global: {
    continuity: ['保持服装、面孔与光影一致性'],
    exclusions: ['硬切', '字幕', '背景音乐']
  }
});
console.log(standard.prompt);
console.log('\nValidation:', JSON.stringify(validatePromptText(standard.prompt, 'standard').summary));

console.log('\n=== Complex 30s Test ===');
const complex = generatePrompt('complex_30s', {
  title: '霓虹小巷的邂逅',
  materials: { images: [{ id: '图片1', role: '女主身份与服装' }] },
  environment: '夜晚东京小巷，潮湿沥青路面，霓虹灯反射',
  visualStyle: '35mm胶片，高对比，暖橙与冷青色霓虹',
  cameraLanguage: '手持跟拍，浅景深',
  characters: '女主25岁，东亚面孔，齐肩黑发，驼色风衣',
  performance: '低头看手机→抬头环顾→与镜头对视轻笑',
  globalLocks: '保持服装、面孔与光影一致性；不要硬切；不要背景音乐；仅保留环境音与脚步声',
  timeline: [
    { start: '00:00', end: '00:10', description: '女主低头看手机走过巷口，霓虹招牌反射在湿地面' },
    { start: '00:10', end: '00:20', description: '她抬头环顾，脚步放缓，与镜头短暂对视' },
    { start: '00:20', end: '00:30', description: '轻笑后继续走向巷子深处，镜头跟拍至背影消失' }
  ]
});
console.log(complex.prompt);

console.log('\n=== Validation Test (bad prompt) ===');
const badPrompt = 'make a beautiful video with stunning visuals';
const validation = validatePromptText(badPrompt, 'standard');
console.log('Result:', JSON.stringify(validation, null, 2));
