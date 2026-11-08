param(
  [string]$Task = 'dev'
)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.tools/node_modules/node/bin'
$npmCli = Join-Path $PSScriptRoot '.tools/node_modules/npm/bin/npm-cli.js'
$nodeExe = Join-Path $runtime 'node.exe'
if (!(Test-Path -LiteralPath $nodeExe) -or !(Test-Path -LiteralPath $npmCli)) {
  throw 'Brak lokalnego Node. Uruchom: npm install --prefix .tools --no-save --package-lock=false node@24 npm@11'
}
$previousPath = $env:PATH
try {
  $env:PATH = "$runtime;$(Join-Path $PSScriptRoot '.tools/node_modules/.bin');$previousPath"
  Push-Location $PSScriptRoot
  try {
    if ($Task -eq 'install') { & $nodeExe $npmCli ci }
    else { & $nodeExe $npmCli run $Task }
    $taskExitCode = $LASTEXITCODE
  } finally { Pop-Location }
} finally { $env:PATH = $previousPath }
exit $taskExitCode
