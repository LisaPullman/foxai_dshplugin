

import { CONTRACTS, VALIDATION_RULES } from './contracts.js';

const GENERIC_BOOSTERS = [
  'stunning', 'epic', 'masterpiece', '8K', 'amazing',
  'cinematic', 'beautiful', 'incredible', 'perfect',
  '震撼', '极致', '完美', '史诗级', '惊艳', '大师级',
];

export function validateStructuredInput(contractId, input) {
  const issues = [];
  const warnings = [];

  const contract = CONTRACTS[contractId];
  if (!contract) {
    issues.push({ level: 'error', field: 'contract', message: `未知契约: ${contractId}` });
    return { valid: false, issues, warnings };
  }

  const rules = VALIDATION_RULES[contractId] || [];

  for (const section of contract.requiredSections) {
    if (!input[section] && !hasNestedField(input, section)) {
      issues.push({ level: 'error', field: section, message: `缺少必需字段: ${section}` });
    }
  }

  for (const rule of rules) {
    const value = input[rule.field];
    if (rule.minLength && (!value || String(value).length < rule.minLength)) {
      issues.push({ level: 'error', field: rule.field, message: rule.message });
    }
    if (rule.minItems && (!Array.isArray(value) || value.length < rule.minItems)) {
      issues.push({ level: 'error', field: rule.field, message: rule.message });
    }
    if (rule.required && !value) {
      issues.push({ level: 'error', field: rule.field, message: rule.message });
    }
  }

  const fullText = JSON.stringify(input);
  for (const booster of GENERIC_BOOSTERS) {
    if (fullText.toLowerCase().includes(booster.toLowerCase())) {
      warnings.push({
        level: 'warning',
        field: 'global',
        message: `建议移除泛化美化词 "${booster}"，改为具体的视觉指令`,
      });
    }
  }

  if (Array.isArray(input.timeline) && input.timeline.length > 0) {
    let lastEnd = '0';
    for (let i = 0; i < input.timeline.length; i++) {
      const seg = input.timeline[i];
      if (seg.start && lastEnd !== seg.start) {
        warnings.push({
          level: 'warning',
          field: `timeline[${i}].start`,
          message: `时间轴分段 ${i} 的起点 ${seg.start} 与上一段终点 ${lastEnd} 不连续`,
        });
      }
      lastEnd = seg.end || lastEnd;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    summary: {
      errors: issues.length,
      warnings: warnings.length,
      contractName: contract.name,
    },
  };
}

export function validatePromptText(promptText, contractId) {
  const issues = [];
  const warnings = [];

  if (!promptText || promptText.trim().length === 0) {
    issues.push({ level: 'error', field: 'prompt', message: '提示词为空' });
    return { valid: false, issues, warnings };
  }

  for (const booster of GENERIC_BOOSTERS) {
    const regex = new RegExp(booster, 'i');
    if (regex.test(promptText)) {
      warnings.push({
        level: 'warning',
        field: 'text',
        message: `检测到泛化美化词 "${booster}"，建议改为具体视觉指令`,
      });
    }
  }

  const contract = CONTRACTS[contractId];
  if (contract && contract.id === 'standard') {
    const expectedSections = ['素材说明', '一句话概述', '时间轴', '全局补充'];
    for (const section of expectedSections) {
      if (!promptText.includes(section)) {
        issues.push({
          level: 'error',
          field: 'structure',
          message: `标准生成缺少段落: ${section}`,
        });
      }
    }
  }

  if (promptText.length < 30) {
    issues.push({ level: 'error', field: 'length', message: '提示词过短，至少需要30个字符' });
  } else if (promptText.length > 3000) {
    warnings.push({
      level: 'warning',
      field: 'length',
      message: '提示词过长（>3000字符），可能影响 Seedance 2.5 的执行效果',
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    summary: {
      errors: issues.length,
      warnings: warnings.length,
      length: promptText.length,
    },
  };
}

function hasNestedField(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return false;
    current = current[part];
  }
  return current !== null && current !== undefined;
}
