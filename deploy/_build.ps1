# Construction du dossier de deploiement gp8-web (appele par deploy.bat).
# Meme structure que dcc-sheet\deploy\_build.ps1.
#
# Tout est copie SAUF ce que le navigateur ne demande jamais :
#   excludeDirs  -> .git, deploy (evite la recursion dans la sortie),
#                   tools (test de chargement local), node_modules, .opencode
#   excludeFiles -> *.md (BUG.md, promp.md, RESPONSIVE.md), .gitignore,
#                   gen-samples.bat (outil local), ordures Windows
# Reste : index.html, css/, js/, samples/ (14 .gp + list.json), favicon*.

$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$src = Split-Path -Parent $deployDir

$excludeDirs = @('.git', 'deploy', 'tools', 'node_modules', '.opencode')
$excludeFiles = @('*.md', '.gitignore', '.DS_Store', 'Thumbs.db', '*.log', 'gen-samples.bat')

function Test-Excluded($rel) {
  $parts = $rel.Replace('/', '\').Split('\')
  foreach ($d in $excludeDirs) { if ($parts -contains $d) { return $true } }
  $name = Split-Path -Leaf $rel
  foreach ($p in $excludeFiles) { if ($name -like $p) { return $true } }
  return $false
}

# --- Build complet ---
$outDir = Join-Path $deployDir 'gp8-web'
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir | Out-Null

$allFiles = Get-ChildItem -Path $src -Recurse -File | Where-Object {
  $full = $_.FullName
  $afterSrc = $full.Substring($src.Length + 1)
  -not (Test-Excluded $afterSrc)
}

$count = 0
foreach ($file in $allFiles) {
  $rel = $file.FullName.Substring($src.Length + 1)
  $dest = Join-Path $outDir $rel
  $destDir = Split-Path -Parent $dest
  if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  Copy-Item $file.FullName $dest
  Write-Host ('  + ' + $rel)
  $count++
}
Write-Host ''
Write-Host ('Dossier cree : ' + $outDir)
Write-Host ('Fichiers copies : ' + $count)
