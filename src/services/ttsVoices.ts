// 可选音色列表（edge-tts / 微软 Neural 语音，免费）
// 纯前端安全文件：不依赖任何 Node 模块，供浏览器端下拉框使用
export const TTS_VOICES: Array<{ id: string; name: string }> = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 · 女声温柔' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 · 女声活泼' },
  { id: 'zh-CN-YunxiNeural', name: '云希 · 男声磁性' },
  { id: 'zh-CN-YunjianNeural', name: '云健 · 男声沉稳' },
  { id: 'zh-CN-YunyangNeural', name: '云扬 · 男声新闻' },
  { id: 'en-US-AriaNeural', name: 'Aria · 英文女声' },
  { id: 'en-US-GuyNeural', name: 'Guy · 英文男声' },
];

// DashScope CosyVoice 回退音色列表（edge-tts 失败时自动切换，国内稳定）
// 用户在设置面板「语音（TTS）」中可选；不选时按 edge-tts 音色自动映射
export const DASHSCOPE_VOICES: Array<{ id: string; name: string }> = [
  { id: 'longxiaochun', name: '晓春 · 女声温柔' },
  { id: 'longxiaoxia', name: '晓夏 · 女声活泼' },
  { id: 'longshu', name: '硕 · 男声磁性' },
  { id: 'longcheng', name: '诚 · 男声沉稳' },
  { id: 'longhua', name: '华 · 男声新闻' },
  { id: 'longzhiyu', name: '之芋 · 女声甜美' },
  { id: 'longjing', name: '婧 · 女声清亮' },
  { id: 'longwan', name: '晚 · 女声柔美' },
  { id: 'longle', name: '乐 · 男声阳光' },
  { id: 'longlin', name: '霖 · 男声低沉' },
  { id: 'longqian', name: '茜 · 女声灵动' },
  { id: 'longduoduo', name: '多多 · 男童' },
];
