// Seedance 2.5 提示词契约（Prompt Contracts）
// 数据来源：字节跳动 Seedance 2.5 官方文档与社区最佳实践
// 这些是嵌入式的知识库，同时也可以通过 Context 7 MCP 实时刷新。

export const SD25_VERSION = '2.5';
export const SD25_LAST_UPDATED = '2026-01-15';

// 通用六要素公式（每个 Seedance 2.5 提示词的最小核心）
export const SIX_PART_FORMULA = {
  subject: '主体 - 主体与场景的稳定描述（年龄/材质/颜色/形态）',
  action: '动作 - 单一连续的变化弧线，有起点、过程和终点',
  camera: '镜头 - 景别、角度、运动方式',
  lighting: '光线 - 光源方向、强度、色温',
  style: '风格 - 单一主导的视觉语言',
  audio: '声音 - 环境音 / 音效 / 对白 / 静音 的明确意图',
};

// 全部可用的契约模板
export const CONTRACTS = {
  standard: {
    id: 'standard',
    name: '标准生成（4–30秒）',
    durationRange: '4s-30s',
    description: '最常用的单段镜头提示词模板，适合大部分短视频生成场景',
    template: `【素材说明】
{materials}

【一句话概述】
{overview}

【时间轴】
{timeline}

【全局补充】
{global}`,
    requiredSections: ['materials', 'overview', 'timeline', 'global'],
    placeholder: `【素材说明】
@图片1用于[身份/服装/场景/首帧]；@视频1仅用于[动作/运镜/节奏]；@音频1用于[音色/BGM]。

【一句话概述】
[主体]在[地点]完成[事件]，[题材/风格]，[核心镜头语言]。

【时间轴】
0-X秒：[画面、动作、镜头、对白、音效]。
X-N秒：[由上一段状态自然延续的画面、动作、镜头、对白、音效]。

【全局补充】
[角色/服装/道具/场景/光影/音频连续性]。不要[与任务相关的 unwanted elements]。`,
  },

  simple: {
    id: 'simple',
    name: '压缩版（4–15秒）',
    durationRange: '4s-15s',
    description: '用于单动作简单片段的压缩模板，一行公式',
    template: `[主体和场景]。[可见动作与终点]。镜头：[单一运动]。光线：[光源]。声音：[环境/音效/对白/静音]。保持[关键不变量]；不要[关键排除项]。`,
    requiredSections: ['subject', 'action', 'camera', 'lighting', 'audio', 'locks'],
    placeholder: '一位年轻女性走在雨后的东京街道上。她转身面向镜头微笑，雨水从伞尖滴落。镜头：中景、平视、缓慢推进。光线：傍晚侧逆光，暖橙色天空。声音：雨滴声与远处的车流。保持她的面部特征与服装不变；不要文字或字幕。',
  },

  complex_30s: {
    id: 'complex_30s',
    name: '复杂30秒生成',
    durationRange: '30s',
    description: '用于带多模态参考和多阶段剧情的30秒生成',
    template: `30秒{title}。

【多模态参考层】
{materials}

【全局设定】
环境与质感：{environment}
视觉风格：{visualStyle}
镜头语言：{cameraLanguage}
角色/主体：{characters}
表演核心：{performance}
全局限制：{globalLocks}

【时间戳剧本】
{timeline}`,
    requiredSections: ['title', 'materials', 'environment', 'visualStyle', 'cameraLanguage', 'characters', 'performance', 'globalLocks', 'timeline'],
    placeholder: '30秒「霓虹小巷的邂逅」\n\n【多模态参考层】\n@图片1仅用于女主身份与服装；@视频1仅用于步伐节奏；@音频1仅用于环境音参考。\n\n【全局设定】\n环境与质感：夜晚东京小巷，潮湿沥青路面，霓虹灯反射。\n视觉风格：35mm胶片，高对比，暖橙与冷青色霓虹。\n镜头语言：手持跟拍，浅景深。\n角色/主体：女主25岁，东亚面孔，齐肩黑发，驼色风衣。\n表演核心：低头看手机→抬头环顾→与镜头对视轻笑。\n全局限制：保持服装、面孔与光影一致性；不要硬切；不要背景音乐；仅保留环境音与脚步声。',
  },

  ultra_long: {
    id: 'ultra_long',
    name: '超长视频（30–180秒）',
    durationRange: '30s-180s',
    description: '用于完整短片级别的超长生成',
    template: `全片时长{duration}秒，画幅{aspectRatio}，分辨率{resolution}，{oneLineGenre}。

【素材与角色 Bible】
{characterBible}

【故事概述】
{storyOutline}

【全局连续性】
{continuity}

【时间戳剧本】
{timeline}`,
    requiredSections: ['duration', 'aspectRatio', 'resolution', 'oneLineGenre', 'characterBible', 'storyOutline', 'continuity', 'timeline'],
    placeholder: '全片时长60秒，画幅16:9，分辨率720p，悬疑短片。\n\n【素材与角色 Bible】\n侦探：35岁男性，短发，深灰风衣。\n嫌疑人：30岁女性，长发，黑裙。\n\n【故事概述】\n侦探在咖啡馆发现嫌疑人 → 跟踪至巷口 → 二人对峙。\n\n【全局连续性】\n阴天傍晚，固定地点，禁止穿帮，无BGM。',
  },

  extension: {
    id: 'extension',
    name: '视频延长',
    durationRange: 'N/A',
    description: '在不改变原视频的基础上向前/向后延长',
    template: `参考@视频1，向{forward}{extraSeconds}秒。提示词仅作用于新增部分，原视频保持不变。
交接状态：@视频1的{交接位置}帧中，{交接描述}。
0-X秒：[无切镜地延续动作与运镜]。
X-N秒：[新增事件和收束]。
保持@视频1的[身份、服装、场景地理、光照、色调、声音]一致；禁止生硬切镜、位置重置或物体凭空出现。`,
    requiredSections: ['forward', 'extraSeconds', '交接位置', '交接描述', 'timeline', 'globalLocks'],
    placeholder: '参考@视频1，向后延长5秒。提示词仅作用于新增部分，原视频保持不变。\n交接状态：@视频1的尾帧中，女主停在街角，路灯照亮她的侧脸。\n0-3秒：女主慢慢转头看向镜头。\n3-5秒：对视后嘴角轻扬。\n保持@视频1的身份、服装、场景、光照、色调一致；禁止切镜或位置重置。',
  },

  editing: {
    id: 'editing',
    name: '智能编辑',
    durationRange: 'N/A',
    description: '编辑已有视频的某个对象或属性',
    template: `编辑@视频1。
修改对象：{target}
变化：{stateA} → {stateB}
生效时段：{scope}
保持不变：{keepUnchanged}
{compensation}`,
    requiredSections: ['target', 'stateA', 'stateB', 'scope', 'keepUnchanged', 'compensation'],
    placeholder: '编辑@视频1。\n修改对象：桌上的花瓶。\n变化：白色陶瓷 → 古铜色金属花瓶。\n生效时段：全片。\n保持不变：人物、动作、镜头、背景、光影不变。\n匹配场景光影方向与材质反射。',
  },

  creative_transfer: {
    id: 'creative_transfer',
    name: '创意迁移',
    durationRange: 'N/A',
    description: '将原视频的创意形式迁移到新主体或新场景',
    template: `参考@视频1的[创意形式、镜头轨迹、节奏、情绪、喜剧机制、转场逻辑]，
将主体替换/重构为@图片1的[新主体]，场景为[新场景]。
必须保留：[选定的创意内核]。
不要迁移：[原人物、原背景、品牌、水印、无关道具或原音轨]。
保持新主体的身份、外形和场景逻辑稳定。`,
    requiredSections: ['creativeAspects', 'newSubject', 'newScene', 'keepAspects', 'excludeAspects'],
    placeholder: '参考@视频1的镜头轨迹与节奏，\n将主体替换为@图片1的机械狗，场景为太空站舱内。\n必须保留：环绕镜头与好奇情绪。\n不要迁移：原人物、咖啡馆背景、咖啡品牌、原音轨。',
  },

  voice_dialogue: {
    id: 'voice_dialogue',
    name: '语音与多语言对白',
    durationRange: 'N/A',
    description: '生成带特定语言和音色的对白',
    template: `角色[名称/@图片N]使用[目标语言]说："[exact line]"。
音色参考@音频1，仅参考[声线、年龄感、语流、情绪]，不要把参考音频当作BGM。
演绎：[低沉悬疑/克制悲伤/活泼带货等]；断句：[说明]；口型与目标语言发音同步。
字幕：[无字幕 / 仅显示目标语言字幕，准确文本为"…"]。`,
    requiredSections: ['character', 'language', 'line', 'voiceReference', 'delivery', 'subtitle'],
    placeholder: '角色@图片1使用日语说："雨は止みましたが、物語はまだ続いています。"。\n音色参考@音频1，仅参考声线与语速。\n演绎：克制悲伤；断句：每两句间留0.5秒。\n字幕：无字幕。',
  },

  green_screen: {
    id: 'green_screen',
    name: '绿幕合成',
    durationRange: 'N/A',
    description: '将绿幕主体合成到目标环境',
    template: `将@视频1的绿幕前景主体合成到@图片1/@视频2的[目标环境]。
保留前景主体的身份、动作和时序；移除全部绿色背景、绿色溢色和边缘残影。
匹配目标环境的透视、机位运动、光线方向、色温、接触阴影、景深和环境反射。
[新增交互与时间点]。禁止出现贴片感、边缘闪烁或背景漂移。`,
    requiredSections: ['foreground', 'targetEnvironment', 'matching', 'interactions'],
    placeholder: '将@视频1的绿幕前景合成到@图片1的火星表面。\n保留宇航员身份与动作；移除所有绿底与边缘残影。\n匹配火星光线的橙色色温与低角度阴影。\n宇航员在3-7秒蹲下采样岩石。禁止贴片感与背景漂移。',
  },

  white_model: {
    id: 'white_model',
    name: '白模渲染',
    durationRange: 'N/A',
    description: '将白模动画渲染为最终成片',
    template: `@视频1是{rough}白模，只参考[动作、动线、运镜、角色站位、遮挡、光影变化、切镜节奏]。
映射：[颜色/形状模型] → @图片1的[角色]；[...] → @图片2的[道具/场景]。
[按时间线描述剧情、完整肢体动作和互动因果]。
场景：[文字或@图片N]。最终风格/材质/光影：[要求]。
不要保留白模材质、灰色背景、辅助线或未指定模型。`,
    requiredSections: ['rough', 'mappings', 'scene', 'finalStyle'],
    placeholder: '@视频1是粗颗粒白模，只参考动作、运镜、角色站位与节奏。\n映射：人形模型 → @图片1的武士；环境 → @图片2的竹林。\n0-5秒：武士拔刀，竹叶飘落。\n5-10秒：刀光闪过，竹子倒地。\n场景：竹林黄昏。\n最终风格/材质/光影：日式水墨画风，柔和侧光。',
  },

  transition: {
    id: 'transition',
    name: '无缝转场',
    durationRange: 'N/A',
    description: '将两段视频无缝衔接',
    template: `将@视频1和@视频2无缝衔接，不修改两段原视频本身。
连接设计：@视频1尾帧的[锚点]以[方向/速度]运动并[遮挡/填满/变形]画面；过渡为@视频2首帧的[对应锚点]。
在连接点保持锚点的形状、位置、尺寸、运动方向、速度、光线或色彩连续。
情绪从[A]过渡到[B]。生成的桥接段不得出现黑屏、跳帧、硬切、闪烁、文字或主体突变。`,
    requiredSections: ['anchorA', 'motionType', 'anchorB', 'emotionFrom', 'emotionTo'],
    placeholder: '将@视频1和@视频2无缝衔接。\n连接设计：@视频1尾帧的雨伞以从右向左的速度划过画面；过渡为@视频2首帧的雨伞。\n情绪从宁静过渡到紧张。禁止黑屏与硬切。',
  },

  storyboard: {
    id: 'storyboard',
    name: '多格分镜',
    durationRange: 'N/A',
    description: '将一张多格分镜图渲染为连续视频',
    template: `@图片1是一张包含[N]个连续镜头的分镜图，每一格代表[完整镜头/人物/场景]，阅读顺序为[顺序]。
角色映射：分镜中的[A]对应@图片2的[角色]；[B]对应@图片3。
[按镜头描述时间线和动作因果]。
最终风格/材质：[要求]。
保持分镜的镜头构图、人物比例与镜头运动一致；不要改变分镜顺序。`,
    requiredSections: ['panelCount', 'panelMeaning', 'readingOrder', 'characterMappings', 'timeline', 'finalStyle'],
    placeholder: '@图片1是一张包含4个连续镜头的分镜图，每格代表一个完整镜头，阅读顺序从左到右、从上到下。\n角色映射：分镜中的男性角色对应@图片2；女性角色对应@图片3。\n镜头1：咖啡馆外景。\n镜头2：女主推门进入。\n镜头3：男主抬头。\n镜头4：二人对视。\n最终风格：胶片质感，温暖色调。',
  },
};

// 校验器规则
export const VALIDATION_RULES = {
  standard: [
    { field: 'overview', minLength: 20, message: '概述至少需要20个字符' },
    { field: 'timeline', minItems: 1, message: '时间轴至少需要1段' },
    { field: 'global', required: true, message: '全局补充不能为空' },
  ],
  simple: [
    { field: 'fullText', minLength: 30, message: '提示词至少30个字符' },
  ],
};

// 用于在UI中展示的契约摘要
export function listContracts() {
  return Object.values(CONTRACTS).map((c) => ({
    id: c.id,
    name: c.name,
    durationRange: c.durationRange,
    description: c.description,
  }));
}
