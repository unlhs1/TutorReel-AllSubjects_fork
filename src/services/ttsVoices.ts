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
