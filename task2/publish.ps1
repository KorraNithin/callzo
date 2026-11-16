# Builds the frontend image for Intel/AMD and ARM machines, pushes it to Docker Hub,
# and writes your username into docker-compose.yml.
#
# Usage (PowerShell, from the task2 folder, after `docker login`):
#   .\publish.ps1 -DockerHubUser yourname
param(
  [Parameter(Mandatory = $true)][string]$DockerHubUser,
  [string]$Tag = "1.0.0"
)

$image = "$DockerHubUser/callzo-task2-frontend:$Tag"

docker buildx inspect callzo-builder *> $null
if ($LASTEXITCODE -ne 0) { docker buildx create --name callzo-builder --use } else { docker buildx use callzo-builder }

docker buildx build --platform linux/amd64,linux/arm64 -t $image --push .
if ($LASTEXITCODE -ne 0) { Write-Error "Build or push failed. Are you logged in? Run: docker login"; exit 1 }

(Get-Content docker-compose.yml) -replace "image: .*callzo-task2-frontend.*", "image: $image" | Set-Content docker-compose.yml
Write-Host "Pushed $image and updated docker-compose.yml."
Write-Host "Next: make the repository public on hub.docker.com, then test with a clean pull:"
Write-Host "  docker rmi $image; docker compose up"
