@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8000
echo ============================================================
echo  LLM Tokenizer Simulator - local server
echo  URL: http://localhost:%PORT%/llm_tokenizer_simulator.html
echo  (Press Ctrl+C to stop)
echo ============================================================

where python >nul 2>nul
if %errorlevel%==0 (
    python -m http.server %PORT%
    goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
    py -m http.server %PORT%
    goto :eof
)
where npx >nul 2>nul
if %errorlevel%==0 (
    npx --yes serve -l %PORT% .
    goto :eof
)
echo [!] Python / Node.js not found. Install one of them and retry.
pause
