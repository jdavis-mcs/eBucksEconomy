@echo off
title E-BUCKS SYSTEM CONSOLE
color 0A

echo =================================================
echo        STARTING E-BUCKS ECONOMY SERVER
echo =================================================
echo.
echo [1/2] Booting Server Brain...
start /min cmd /k "node server.js"

echo [2/2] Waiting for connection...
timeout /t 2 >nul

echo.
echo SYSTEM ONLINE.
echo Opening Dashboard...
start http://localhost:3535/

echo.
echo =================================================
echo    DO NOT CLOSE THIS WINDOW WHILE CLASS IS ON
echo =================================================
pause