$commitMessage = Read-Host "Commit message"

if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    Write-Host "Commit message cannot be empty. Aborting."
    exit 1
}

git add -A
git commit -m "$commitMessage"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed. Aborting push/pull steps."
    exit 1
}

git push origin HEAD:main

git checkout main
git pull

Write-Host ""
Write-Host "Last 3 commits:"
git log --oneline -3