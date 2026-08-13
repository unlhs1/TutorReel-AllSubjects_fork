@echo off
chcp 65001 >nul
echo ============================================
echo    TutorReel dev 环境清理与重启
echo ============================================
echo [1/2] 正在停止所有旧 dev 进程（concurrently / tsx / vite）...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*TutorReel*' -and ($_.CommandLine -like '*concurrently*' -or $_.CommandLine -like '*tsx*' -or $_.CommandLine -like '*vite*')} | ForEach-Object {Write-Host ('   已终止 PID=' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}"
echo.
timeout /t 1 /nobreak >nul
echo [2/2] 正在启动 npm run dev ...
cd /d E:\Applications\Claude_Code\logs\TutorReel
start "TutorReel Dev" cmd /k "npm run dev"
echo.
echo 完成！新窗口已启动，浏览器打开 http://localhost:5173
echo 若未自动打开，请手动刷新页面
timeout /t 3 >nul
