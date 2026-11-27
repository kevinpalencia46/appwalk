---
name: Pi health
projects: [ren2]
description: What "healthy" means for the Pi running Ren 2.
---
- Warn at RAM ≥ 90%, swap ≥ 50%, temperature ≥ 75°C, disk ≥ 90%, Ren 2 RSS > 800 MB.
- Ren 2's own fixes only: requeue its jammed tasks. Never restart side-project services.
