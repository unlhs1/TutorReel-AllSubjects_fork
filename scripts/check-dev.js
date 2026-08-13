// 启动前端口检查：防止重复启动 npm run dev 导致多套 dev 实例（concurrently/tsx/vite）并发
// 若 3001（后端）或 5173（前端）已被占用，说明可能已有 dev 环境在运行，直接报错退出
const net = require('net');

function portInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

async function main() {
  const ports = [3001, 5173];
  const busy = [];
  for (const p of ports) {
    if (await portInUse(p)) busy.push(p);
  }
  if (busy.length > 0) {
    console.error('');
    console.error('⚠️  检测到端口 ' + busy.join('、') + ' 已被占用。');
    console.error('    可能已有 dev 环境在运行（重复 npm run dev 会造成多套实例、vite 抢 CPU）。');
    console.error('    请先停止旧实例：关闭对应终端窗口，或在任务管理器中结束 node.exe 进程，再重新启动。');
    console.error('');
    process.exit(1);
  }
  console.log('✓ 端口检查通过（3001/5173 空闲），启动 dev 环境...');
}

main();
