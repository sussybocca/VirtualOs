@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [VIR/VOS] Windows build
set "CXX="

if exist "D:\C++\w64devkit\bin\g++.exe" set "CXX=D:\C++\w64devkit\bin\g++.exe"
if not defined CXX for /f "delims=" %%G in ('where g++.exe 2^>nul') do if not defined CXX set "CXX=%%G"
if not defined CXX for /f "delims=" %%G in ('where clang++.exe 2^>nul') do if not defined CXX set "CXX=%%G"

if not defined CXX (
  echo [ERROR] No C++20 compiler found.
  echo Install w64devkit/MinGW-w64 or LLVM, or place w64devkit at D:\C++\w64devkit.
  exit /b 1
)

echo [VIR/VOS] Compiler: %CXX%
if not exist build mkdir build
if not exist dist mkdir dist

"%CXX%" -std=c++20 -O1 -DNDEBUG -Wall -Wextra -Iinclude ^
 src\main.cpp src\lexer.cpp src\parser.cpp src\semantic.cpp src\ir.cpp src\backend.cpp src\container.cpp ^
 -o build\vosc.exe
if errorlevel 1 exit /b 1

copy /Y build\vosc.exe build\vos.exe >nul
copy /Y build\vosc.exe build\vosbuild.exe >nul

build\vos.exe check examples\VIR.vos
if errorlevel 1 exit /b 1
build\vos.exe build examples\VIR.vos -o dist\VIR --opt 3
if errorlevel 1 exit /b 1

copy /Y runtime\browser\vos-runtime.js dist\VIR\vos-runtime.js >nul
copy /Y runtime\browser\cpu-worker.js dist\VIR\cpu-worker.js >nul
copy /Y examples\VIR-boot.html dist\VIR\index.html >nul

echo.
echo [VIR/VOS] Build complete.
echo [VIR/VOS] Toolchain: build\vos.exe

echo [VIR/VOS] VIR OS:    dist\VIR\
echo [VIR/VOS] To run locally: py -m http.server 8787 -d dist\VIR
endlocal
