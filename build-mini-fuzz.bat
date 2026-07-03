@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
cd /d E:\projetos\circuit-exploration
if not exist mini-fuzz\build mkdir mini-fuzz\build
cd mini-fuzz\build
cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
echo EXIT_CODE=%ERRORLEVEL%
