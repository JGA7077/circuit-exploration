@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d E:\projetos\circuit-exploration
if not exist vst3-template\build mkdir vst3-template\build
cd vst3-template\build
cmake .. -G "Visual Studio 18 2026" -DCMAKE_BUILD_TYPE=Release
echo EXIT_CODE=%ERRORLEVEL%
