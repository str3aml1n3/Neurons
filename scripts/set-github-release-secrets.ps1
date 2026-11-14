<#
.SYNOPSIS
Verifies and uploads the Android release-signing secrets required by the distribution workflow.

.EXAMPLE
.\scripts\set-github-release-secrets.ps1

.EXAMPLE
.\scripts\set-github-release-secrets.ps1 `
    -KeystorePath 'C:\Users\you\Desktop\my-release-key.jks'
#>
[CmdletBinding()]
param(
    [string]$Repository = 'str3aml1n3/neuron-sim',

    [string]$KeystorePath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'my-release-key.jks')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-PlainText {
    param(
        [Parameter(Mandatory)]
        [Security.SecureString]$Value
    )

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Set-RepositorySecret {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$Value
    )

    $Value | & $gh.Source secret set $Name --repo $Repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set $Name."
    }

    Write-Host "Uploaded $Name."
}

function Get-JavaTool {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $tool = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue
    if ($tool) {
        return $tool.Source
    }

    $extension = if ($env:OS -eq 'Windows_NT') { '.exe' } else { '' }
    if ($env:JAVA_HOME) {
        $candidate = Join-Path (Join-Path $env:JAVA_HOME 'bin') "$Name$extension"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "Java JDK tool '$Name' was not found. Install a JDK or set JAVA_HOME, then rerun this script."
}

function Get-PrivateKeyAlias {
    param(
        [Parameter(Mandatory)]
        [string]$KeystorePath,

        [Parameter(Mandatory)]
        [string]$StorePassword
    )

    $keytool = Get-JavaTool -Name 'keytool'
    $previousStorePassword = [Environment]::GetEnvironmentVariable('NEURON_VERIFY_STORE_PASSWORD', 'Process')

    try {
        [Environment]::SetEnvironmentVariable('NEURON_VERIFY_STORE_PASSWORD', $StorePassword, 'Process')
        $entries = & $keytool -list -v -keystore $KeystorePath -storepass:env NEURON_VERIFY_STORE_PASSWORD
        if ($LASTEXITCODE -ne 0) {
            throw 'The keystore password is incorrect or the keystore cannot be read.'
        }

        $currentAlias = $null
        $privateKeyAliases = [System.Collections.Generic.List[string]]::new()
        foreach ($entry in $entries) {
            if ($entry -match '^\s*Alias name:\s*(?<alias>.+?)\s*$') {
                $currentAlias = $Matches.alias
            }
            elseif ($entry -match '^\s*Entry type:\s*PrivateKeyEntry\s*$' -and $currentAlias) {
                $privateKeyAliases.Add($currentAlias)
            }
        }

        if ($privateKeyAliases.Count -eq 0) {
            throw 'No private-key entry was found in the keystore.'
        }
        if ($privateKeyAliases.Count -gt 1) {
            throw "The keystore contains multiple private-key aliases: $($privateKeyAliases -join ', ')."
        }

        return $privateKeyAliases[0]
    }
    finally {
        [Environment]::SetEnvironmentVariable('NEURON_VERIFY_STORE_PASSWORD', $previousStorePassword, 'Process')
    }
}

function Test-SigningCredentials {
    param(
        [Parameter(Mandatory)]
        [string]$KeystorePath,

        [Parameter(Mandatory)]
        [string]$KeyAlias,

        [Parameter(Mandatory)]
        [string]$StorePassword,

        [Parameter(Mandatory)]
        [string]$KeyPassword
    )

    $jar = Get-JavaTool -Name 'jar'
    $jarsigner = Get-JavaTool -Name 'jarsigner'
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("neuron-key-test-" + [guid]::NewGuid().ToString('N'))
    $temporaryTextFile = Join-Path $temporaryDirectory 'verification.txt'
    $temporaryJar = Join-Path $temporaryDirectory 'verification.jar'
    $previousStorePassword = [Environment]::GetEnvironmentVariable('NEURON_VERIFY_STORE_PASSWORD', 'Process')
    $previousKeyPassword = [Environment]::GetEnvironmentVariable('NEURON_VERIFY_KEY_PASSWORD', 'Process')

    try {
        New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
        [IO.File]::WriteAllText($temporaryTextFile, 'verification')
        & $jar --create --file $temporaryJar -C $temporaryDirectory 'verification.txt'
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not create the temporary JAR used to verify signing credentials.'
        }

        [Environment]::SetEnvironmentVariable('NEURON_VERIFY_STORE_PASSWORD', $StorePassword, 'Process')
        [Environment]::SetEnvironmentVariable('NEURON_VERIFY_KEY_PASSWORD', $KeyPassword, 'Process')
        & $jarsigner -keystore $KeystorePath -storepass:env NEURON_VERIFY_STORE_PASSWORD `
            -keypass:env NEURON_VERIFY_KEY_PASSWORD $temporaryJar $KeyAlias
        if ($LASTEXITCODE -ne 0) {
            throw 'The keystore and alias were found, but the private-key password did not unlock that alias. Changing the keystore password does not change the private-key password.'
        }

        Write-Host 'Signing credentials verified.'
    }
    finally {
        [Environment]::SetEnvironmentVariable('NEURON_VERIFY_STORE_PASSWORD', $previousStorePassword, 'Process')
        [Environment]::SetEnvironmentVariable('NEURON_VERIFY_KEY_PASSWORD', $previousKeyPassword, 'Process')
        if (Test-Path -LiteralPath $temporaryJar -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryJar -Force
        }
        if (Test-Path -LiteralPath $temporaryTextFile -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryTextFile -Force
        }
        if (Test-Path -LiteralPath $temporaryDirectory -PathType Container) {
            Remove-Item -LiteralPath $temporaryDirectory -Force
        }
    }
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    throw 'GitHub CLI (gh) is required. Install it, authenticate with "gh auth login --web", then rerun this script.'
}

& $gh.Source auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated for GitHub.com. Run "gh auth login --web", then rerun this script.'
}

if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "Keystore not found: $KeystorePath"
}

$storePassword = Read-Host 'Keystore password' -AsSecureString
$keyPassword = Read-Host 'Private-key password' -AsSecureString
$keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($KeystorePath))
$storePasswordText = $null
$keyPasswordText = $null

try {
    $storePasswordText = ConvertTo-PlainText $storePassword
    $keyPasswordText = ConvertTo-PlainText $keyPassword
    $keyAlias = Get-PrivateKeyAlias -KeystorePath $KeystorePath -StorePassword $storePasswordText
    Write-Host "Using private-key alias: $keyAlias"

    Test-SigningCredentials -KeystorePath $KeystorePath -KeyAlias $keyAlias `
        -StorePassword $storePasswordText -KeyPassword $keyPasswordText

    Set-RepositorySecret -Name 'ANDROID_KEYSTORE_BASE64' -Value $keystoreBase64
    Set-RepositorySecret -Name 'ANDROID_STORE_PASSWORD' -Value $storePasswordText
    Set-RepositorySecret -Name 'ANDROID_KEY_ALIAS' -Value $keyAlias
    Set-RepositorySecret -Name 'ANDROID_KEY_PASSWORD' -Value $keyPasswordText
}
finally {
    $storePasswordText = $null
    $keyPasswordText = $null
    $keystoreBase64 = $null
}
