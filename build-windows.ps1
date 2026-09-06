Set-StrictMode -Version Latest
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $root
try {
    Write-Output "Installing npm dependencies..."
    npm install

    Write-Output "Running build script (if any)..."
    if (npm run | Out-String -Stream | Select-String -Pattern "build") {
        Write-Output "Setting SKIP_DB=1 for build to avoid requiring MySQL"
        $env:SKIP_DB = '1'
        npm run build
        Remove-Item Env:SKIP_DB -ErrorAction SilentlyContinue
    }

    Write-Output "Packaging exe with pkg (npx pkg)..."
    npx pkg --targets node20-win-x64 . --out-path dist

    $exe = Get-ChildItem -Path (Join-Path $root 'dist') -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) {
        Write-Error "No .exe found in dist folder. Packaging likely failed."
        exit 1
    }

    Write-Output "Found exe: $($exe.Name)"

    $makensis = Get-Command makensis -ErrorAction SilentlyContinue
    if ($makensis) {
        Write-Output "Generating NSIS script and building installer..."
        $nsisDir = Join-Path $root 'nsis'
        if (-not (Test-Path $nsisDir)) { New-Item -ItemType Directory -Path $nsisDir | Out-Null }

        $generated = Join-Path $nsisDir 'installer.generated.nsi'
        $exeRel = "dist\\$($exe.Name)"
        $nsisContent = @"
!define PRODUCT "exam-browser-online"
!define EXE_FILE "$exeRel"
Name "${PRODUCT}"
OutFile "dist\\${PRODUCT}_installer.exe"
InstallDir "$PROGRAMFILES\\${PRODUCT}"

Section "Install"
  SetOutPath "$INSTDIR"
  File "${EXE_FILE}"
  
  SetOutPath "$INSTDIR\APP"
  File /r "dist\APP\*"
  
  CreateShortCut "$DESKTOP\\${PRODUCT}.lnk" "$INSTDIR\\$($exe.Name)"
SectionEnd
"@

        $nsisContent | Out-File -FilePath $generated -Encoding ASCII
        & $makensis.Path $generated
        Write-Output "Installer build finished. See dist\${PRODUCT}_installer.exe"
    } else {
        Write-Warning "NSIS (makensis) not found in PATH. Generated NSIS example is at nsis/installer.nsi."
        Write-Output "You can run NSIS manually after installing it."
    }
} finally {
    Pop-Location
}
