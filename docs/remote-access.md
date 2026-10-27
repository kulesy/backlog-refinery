# Running it all the time, and reaching it from a phone

This is how the original team runs Backlog Refinery on a Mac that stays on. None of it is needed to try the app.

## Keep the server up with launchd (macOS)

Save this as `~/Library/LaunchAgents/com.example.backlog-refinery.plist`, fix the two paths, then run
`launchctl load ~/Library/LaunchAgents/com.example.backlog-refinery.plist`:

    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict>
      <key>Label</key><string>com.example.backlog-refinery</string>
      <key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>server.mjs</string></array>
      <key>WorkingDirectory</key><string>/path/to/backlog-refinery</string>
      <key>EnvironmentVariables</key><dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
      </dict>
      <key>RunAtLoad</key><true/>
      <key>KeepAlive</key><true/>
      <key>StandardOutPath</key><string>/tmp/backlog-refinery.log</string>
      <key>StandardErrorPath</key><string>/tmp/backlog-refinery.log</string>
    </dict></plist>

`gh` must be authenticated for the user that runs the agent. On a machine you reach over SSH, store the token with
`gh auth login --insecure-storage`, because the login keychain is not available there.

## Reach it from a phone with Tailscale

The server binds loopback and the machine's Tailscale address (from `tailscale ip -4`), so any device on your tailnet can open
`http://<tailscale-ip>:4380`. A 100.x address only routes inside the tailnet, so the app is not exposed on the wifi the machine joins.
It rechecks that address every minute, so it comes up on the phone even if it started before Tailscale connected.
`GET /healthz` returns `ok` for a quick check. Set `TAILSCALE_BIN` if the `tailscale` binary is not on the PATH, or point it at
`/usr/bin/false` to skip the Tailscale bind (useful for a test instance).

To give it a name, mount it with Tailscale serve. The server accepts and strips a `/backlog-refinery` prefix:

    tailscale serve --http=80 --set-path=/backlog-refinery http://localhost:4380

Then open `http://<machine-name>/backlog-refinery/`. Remove only this mount with
`tailscale serve --http=80 --set-path=/backlog-refinery off`. Plain `--http=80 off` drops every port 80 route.

MagicDNS names do not always resolve on the machine that hosts the app. If yours does not, use `http://localhost:4380` there and the
name on the phone.
