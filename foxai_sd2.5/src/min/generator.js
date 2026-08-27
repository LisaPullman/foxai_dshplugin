

import { CONTRACTS } from './contracts.js';

function formatMaterials(materials) {
  if (!materials) return '（无外部素材）';
  const parts = [];
  if (materials.images && materials.images.length > 0) {
    materials.images.forEach((img) => {
      const role = img.role || '未指定';
      const restrictions = img.restrictions ? `；${img.restrictions}` : '';
      parts.push(`@${img.id || '图片1'}用于${role}${restrictions}`);
    });
  }
  if (materials.videos && materials.videos.length > 0) {
    materials.videos.forEach((vid) => {
      const role = vid.role || '未指定';
      const restrictions = vid.restrictions ? `；${vid.restrictions}` : '';
      parts.push(`@${vid.id || '视频1'}用于${role}${restrictions}`);
    });
  }
  if (materials.audios && materials.audios.length > 0) {
    materials.audios.forEach((aud) => {
      const role = aud.role || '未指定';
      const restrictions = aud.restrictions ? `；${aud.restrictions}` : '';
      parts.push(`@${aud.id || '音频1'}用于${role}${restrictions}`);
    });
  }
  return parts.length > 0 ? parts.join('；') + '。' : '（无外部素材）';
}

function formatTimeline(timeline) {
  if (!timeline || timeline.length === 0) return '0-N秒：[待补充画面、动作、镜头、对白、音效]。';
  return timeline
    .map((seg) => {
      const start = seg.start || '0';
      const end = seg.end || 'N';
      const desc = seg.description || '[待补充画面、动作、镜头、对白、音效]';
      return `${start}-${end}秒：${desc}。`;
    })
    .join('\n');
}

function formatGlobal(global) {
  if (!global) return '[角色/服装/道具/场景/光影/音频连续性]。';
  const parts = [];
  if (global.continuity && global.continuity.length > 0) {
    parts.push(global.continuity.join('、'));
  } else {
    parts.push('角色/服装/道具/场景/光影/音频连续性');
  }
  if (global.exclusions && global.exclusions.length > 0) {
    parts.push(`不要${global.exclusions.join('、')}`);
  }
  return parts.join('；') + '。';
}

function formatGlobalSettings(settings) {
  if (!settings) return '';
  const sections = [];
  if (settings.environment) sections.push(`环境与质感：${settings.environment}`);
  if (settings.visualStyle) sections.push(`视觉风格：${settings.visualStyle}`);
  if (settings.cameraLanguage) sections.push(`镜头语言：${settings.cameraLanguage}`);
  if (settings.characters) sections.push(`角色/主体：${settings.characters}`);
  if (settings.performance) sections.push(`表演核心：${settings.performance}`);
  if (settings.globalLocks) sections.push(`全局限制：${settings.globalLocks}`);
  return sections.join('\n');
}

export function generatePrompt(contractId, input) {
  const contract = CONTRACTS[contractId];
  if (!contract) {
    return {
      success: false,
      error: `未知契约: ${contractId}`,
      availableContracts: Object.keys(CONTRACTS),
    };
  }

  try {
    let result;
    switch (contractId) {
      case 'simple':
        result = generateSimple(input);
        break;
      case 'standard':
        result = generateStandard(input);
        break;
      case 'complex_30s':
        result = generateComplex30s(input);
        break;
      case 'ultra_long':
        result = generateUltraLong(input);
        break;
      case 'extension':
        result = generateExtension(input);
        break;
      case 'editing':
        result = generateEditing(input);
        break;
      case 'creative_transfer':
        result = generateCreativeTransfer(input);
        break;
      case 'voice_dialogue':
        result = generateVoiceDialogue(input);
        break;
      case 'green_screen':
        result = generateGreenScreen(input);
        break;
      case 'white_model':
        result = generateWhiteModel(input);
        break;
      case 'transition':
        result = generateTransition(input);
        break;
      case 'storyboard':
        result = generateStoryboard(input);
        break;
      default:
        result = generateStandard(input);
    }
    return {
      success: true,
      contract: contractId,
      contractName: contract.name,
      prompt: result,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      error: `生成失败: ${err.message}`,
      contract: contractId,
    };
  }
}

function generateSimple(input) {
  const subject = input.subject || '[主体和场景]';
  const action = input.action || '[可见动作与终点]';
  const camera = input.camera || '[单一运动]';
  const lighting = input.lighting || '[光源]';
  const audio = input.audio || '[环境/音效/对白/静音]';
  const locks = input.locks || '[关键不变量]';
  const exclusions = input.exclusions || '[关键排除项]';
  return `${subject}。${action}。镜头：${camera}。光线：${lighting}。声音：${audio}。保持${locks}；不要${exclusions}。`;
}

function generateStandard(input) {
  const template = CONTRACTS.standard.template;
  return template
    .replace('{materials}', formatMaterials(input.materials))
    .replace('{overview}', input.overview || '[主体]在[地点]完成[事件]，[题材/风格]，[核心镜头语言]。')
    .replace('{timeline}', formatTimeline(input.timeline))
    .replace('{global}', formatGlobal(input.global));
}

function generateComplex30s(input) {
  const template = CONTRACTS.complex_30s.template;
  return template
    .replace('{title}', input.title || '[一句话基调]')
    .replace('{materials}', formatMaterials(input.materials))
    .replace('{environment}', input.environment || '[时间、地点、氛围、物理质感]')
    .replace('{visualStyle}', input.visualStyle || '[媒介、色彩、景深、光线]')
    .replace('{cameraLanguage}', input.cameraLanguage || '[全片机位逻辑和运动能量]')
    .replace('{characters}', input.characters || '[身份、辨识特征、服装、道具、比例]')
    .replace('{performance}', input.performance || '[可见动作 + 可选潜台词]')
    .replace('{globalLocks}', input.globalLocks || '[声音、字幕、连续性、不要出现的内容]')
    .replace('{timeline}', formatTimeline(input.timeline));
}

function generateUltraLong(input) {
  const template = CONTRACTS.ultra_long.template;
  return template
    .replace('{duration}', input.duration || '60')
    .replace('{aspectRatio}', input.aspectRatio || '16:9')
    .replace('{resolution}', input.resolution || '720p')
    .replace('{oneLineGenre}', input.oneLineGenre || '[一句话类型与基调]')
    .replace('{characterBible}', input.characterBible || '[角色身份、面孔、发型、服装、道具所有权、声音和参考范围]')
    .replace('{storyOutline}', input.storyOutline || '[开端 → 发展 → 转折 → 高潮 → 结尾]')
    .replace('{continuity}', input.continuity || '[风格、时间/天气、场景地理、角色不变量、音频设计、禁止项]')
    .replace('{timeline}', formatTimeline(input.timeline));
}

function generateExtension(input) {
  const template = CONTRACTS.extension.template;
  return template
    .replace('{forward}', input.forward || '后')
    .replace('{extraSeconds}', input.extraSeconds || '5')
    .replace('{交接位置}', input.handoffFrame || '尾')
    .replace('{交接描述}', input.handoffDescription || '[角色位置、朝向、动作动量、镜头运动、光线、声音]')
    .replace('{timeline}', formatTimeline(input.timeline))
    .replace('{globalLocks}', input.globalLocks || '保持原视频身份、服装、场景地理、光照、色调、声音一致；禁止生硬切镜、位置重置或物体凭空出现。');
}

function generateEditing(input) {
  const template = CONTRACTS.editing.template;
  return template
    .replace('{target}', input.target || '[具体对象]')
    .replace('{stateA}', input.stateA || '[原状态A]')
    .replace('{stateB}', input.stateB || '[目标状态B]')
    .replace('{scope}', input.scope || '全片')
    .replace('{keepUnchanged}', input.keepUnchanged || '[人物、动作、镜头、背景、字幕、声音、构图、光影中不应被改动的部分]')
    .replace('{compensation}', input.compensation || '[被删除区域如何补全 / 新元素如何匹配透视、光照和材质]');
}

function generateCreativeTransfer(input) {
  const template = CONTRACTS.creative_transfer.template;
  return template
    .replace('{creativeAspects}', input.creativeAspects || '[创意形式、镜头轨迹、节奏、情绪、喜剧机制、转场逻辑]')
    .replace('{newSubject}', input.newSubject || '[新主体]')
    .replace('{newScene}', input.newScene || '[新场景]')
    .replace('{keepAspects}', input.keepAspects || '[选定的创意内核]')
    .replace('{excludeAspects}', input.excludeAspects || '[原人物、原背景、品牌、水印、无关道具或原音轨]');
}

function generateVoiceDialogue(input) {
  const template = CONTRACTS.voice_dialogue.template;
  return template
    .replace('{character}', input.character || '@图片1')
    .replace('{language}', input.language || '中文')
    .replace('{exactLine}', input.exactLine || input.line || '[exact line]')
    .replace('{voiceReference}', input.voiceReference || '音色参考@音频1，仅参考声线与情绪')
    .replace('{delivery}', input.delivery || '自然演绎')
    .replace('{subtitle}', input.subtitle || '无字幕');
}

function generateGreenScreen(input) {
  const template = CONTRACTS.green_screen.template;
  return template
    .replace('{foreground}', input.foreground || '@视频1的绿幕前景主体')
    .replace('{targetEnvironment}', input.targetEnvironment || '[目标环境]')
    .replace('{matching}', input.matching || '匹配目标环境的透视、机位运动、光线方向、色温、接触阴影、景深和环境反射')
    .replace('{interactions}', input.interactions || '[新增交互与时间点]');
}

function generateWhiteModel(input) {
  const template = CONTRACTS.white_model.template;
  return template
    .replace('{rough}', input.rough || '细颗粒')
    .replace('{mappings}', input.mappings || '[颜色/形状模型] → @图片1的[角色]')
    .replace('{scene}', input.scene || '[文字或@图片N]')
    .replace('{finalStyle}', input.finalStyle || '[要求]');
}

function generateTransition(input) {
  const template = CONTRACTS.transition.template;
  return template
    .replace('{anchorA}', input.anchorA || '@视频1尾帧的[锚点]')
    .replace('{motionType}', input.motionType || '[方向/速度]')
    .replace('{anchorB}', input.anchorB || '@视频2首帧的[对应锚点]')
    .replace('{emotionFrom}', input.emotionFrom || 'A')
    .replace('{emotionTo}', input.emotionTo || 'B');
}

function generateStoryboard(input) {
  const template = CONTRACTS.storyboard.template;
  return template
    .replace('{panelCount}', input.panelCount || '[N]')
    .replace('{panelMeaning}', input.panelMeaning || '[完整镜头/人物/场景]')
    .replace('{readingOrder}', input.readingOrder || '[顺序]')
    .replace('{characterMappings}', input.characterMappings || '分镜中的[A]对应@图片2的[角色]')
    .replace('{timeline}', formatTimeline(input.timeline))
    .replace('{finalStyle}', input.finalStyle || '[要求]');
}
