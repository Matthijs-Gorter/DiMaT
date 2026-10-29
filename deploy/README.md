# Fedora deployment notes

## Podman or Docker Compose

From the repository root, build and start the app with `podman compose up --build -d` (or `docker compose up --build -d`). The browser endpoint is `http://localhost:8080`; SQLite data is kept in the `dimat_data` volume. Back up that volume before upgrades.

To expose it only on the host, keep the published port bound to localhost by changing the web mapping to `127.0.0.1:8080:80`. For LAN access, allow TCP 8080 with `sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload`. For remote play, prefer Tailscale: install and sign into Tailscale on the Fedora host and player devices, then use the host's Tailscale IP on port 8080. Do not forward the port on the public router.

## systemd example

`dimat.service.example` documents a direct Node service. Create a dedicated `dimat` user, install the workspace and Node.js/pnpm under `/opt/DiMaT`, copy the example to `/etc/systemd/system/dimat.service`, then run `sudo systemctl daemon-reload && sudo systemctl enable --now dimat`. Put a reverse proxy in front for browser delivery and WebSocket upgrades; the sample unit runs only the API server.

## Current deployment limits

The sample Compose deployment is single-instance and intended for trusted private networks. It has no TLS termination, user authentication, rate limiting, or multi-process room coordination. SQLite is the sole durable store. Do not expose it directly to the public internet.
