@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set APP_NAME=幻灯片研习台
set DIST=%~dp0dist\win
set NODE_VERSION=20.18.0

echo === 构建 Windows .exe 安装包 ===

:: 清理旧产物
if exist "%DIST%" rmdir /s /q "%DIST%"
mkdir "%DIST%\backend" "%DIST%\frontend" "%DIST%\runtime" "%DIST%\storage"

:: 1. 构建前端 standalone
echo ^> 构建 Next.js standalone...
cd frontend
call npm ci --silent
set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
call npm run build
xcopy /e /i /q ".next\standalone" "%DIST%\frontend\"
xcopy /e /i /q ".next\static" "%DIST%\frontend\.next\static\"
xcopy /e /i /q "public" "%DIST%\frontend\public\"
cd ..

:: 2. 构建后端 venv
echo ^> 构建 Python 环境...
cd backend
python -m venv "%DIST%\backend\.venv"
call "%DIST%\backend\.venv\Scripts\activate.bat"
python -m pip install --quiet --upgrade pip
python -m pip install --quiet .
call deactivate
xcopy /e /i /q "app" "%DIST%\backend\app\"
copy pyproject.toml "%DIST%\backend\"
cd ..

:: 3. 下载 Node.js Windows 二进制
echo ^> 下载 Node.js 二进制...
curl -L "https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip" -o "%TEMP%\node.zip"
powershell -command "Expand-Archive -Path '%TEMP%\node.zip' -DestinationPath '%TEMP%\nodebin' -Force"
copy "%TEMP%\nodebin\node-v%NODE_VERSION%-win-x64\node.exe" "%DIST%\runtime\node.exe"

:: 4. 复制配置文件
copy ".env.example" "%DIST%\"
copy "installer\setup.iss" "%DIST%\.."

:: 5. 创建 Windows 启动脚本（嵌入安装包）
(
echo @echo off
echo cd /d "%%~dp0"
echo if not exist ".env" ^(
echo   copy ".env.example" ".env"
echo   notepad ".env"
echo   echo 填写完 API_KEY 后，请重新双击启动图标
echo   pause
echo   exit /b 0
echo ^)
echo if not exist "storage" mkdir storage
echo echo 正在启动后端...
echo start "后端" /min cmd /c "backend\.venv\Scripts\activate ^&^& cd backend ^&^& uvicorn app.main:app --host 127.0.0.1 --port 8000"
echo timeout /t 6 /nobreak ^>nul
echo echo 正在启动前端...
echo set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
echo start "前端" /min cmd /c "cd frontend ^&^& "..\runtime\node.exe" server.js"
echo timeout /t 3 /nobreak ^>nul
echo start http://localhost:3000
echo echo 应用已在浏览器中打开，关闭此窗口将停止所有服务。
echo pause
echo taskkill /FI "WINDOWTITLE eq 后端*" /T /F ^>nul 2^>^&1
echo taskkill /FI "WINDOWTITLE eq 前端*" /T /F ^>nul 2^>^&1
) > "%DIST%\启动.bat"

:: 6. 运行 Inno Setup
echo ^> 编译安装包...
"C:\Program Files (x86)\Inno Setup 6\iscc.exe" "dist\setup.iss"

echo.
echo 构建完成: dist\%APP_NAME%_Setup.exe
pause
