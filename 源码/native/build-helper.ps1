$ErrorActionPreference = 'Stop'

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "找不到 .NET Framework 编译器：$csc" }

$wpf = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF'
$refs = @(
  'System.dll',
  'System.Windows.Forms.dll',
  'System.Drawing.dll',
  "$wpf\UIAutomationClient.dll",
  "$wpf\UIAutomationTypes.dll",
  "$wpf\WindowsBase.dll"
)

$args = @('/nologo', '/target:exe', '/platform:anycpu', '/optimize+', "/out:$PSScriptRoot\ToolboxHelper.exe")
foreach ($r in $refs) { $args += "/r:$r" }
$args += "$PSScriptRoot\ToolboxHelper.cs"

& $csc @args
if ($LASTEXITCODE -ne 0) { throw "编译失败，退出码 $LASTEXITCODE" }

Write-Output "已生成：$PSScriptRoot\ToolboxHelper.exe"
