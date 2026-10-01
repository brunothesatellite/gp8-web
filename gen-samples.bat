@echo off
rem  ===================================================================
rem  GP8 PLAYER - gen-samples.bat
rem  -------------------------------------------------------------------
rem  Genere samples\list.json : le manifeste des fichiers d'exemple.
rem  A lancer AVANT le deploiement, apres avoir ajoute / renomme un .gp
rem  (il n'est pas necessaire sur un serveur qui autorise le listage du
rem  dossier samples\, mais il est toujours pris en priorite).
rem
rem  Aucun nom de fichier n'est ecrit en dur dans l'application : c'est
rem  ce manifeste, ou le listage dynamique du serveur, qui fait foi.
rem
rem  Remarque technique : ce fichier reste volontairement 100%% ASCII et
rem  ne contient AUCUNE double quote, car cmd bascule son mode citation
rem  a la moindre " et casserait le ^
rem  ===================================================================
setlocal
cd /d "%~dp0"

if not exist "samples\" (
  echo ERREUR : le dossier samples\ est introuvable a cote de ce script.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$dir=Join-Path (Get-Location).Path 'samples';" ^
  "$names=@(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -match '\.(gp|gpx|gp5)$' } | Sort-Object Name | ForEach-Object { $_.Name });" ^
  "$o=[ordered]@{generated=(Get-Date).ToString('s');count=$names.Count;files=@($names)};" ^
  "[IO.File]::WriteAllText((Join-Path $dir 'list.json'),($o | ConvertTo-Json -Depth 3),[Text.UTF8Encoding]::new($false));" ^
  "Write-Output ('  ' + $names.Count + ' fichier(s) ecrits dans samples\list.json')"

if errorlevel 1 (
  echo.
  echo ECHEC : impossible de generer samples\list.json.
  pause
  exit /b 1
)

echo.
echo Termine. Relancez ce script apres chaque ajout / renommage dans samples\.
pause
exit /b 0
